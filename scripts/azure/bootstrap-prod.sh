#!/usr/bin/env bash
set -euo pipefail

# Tower production bootstrap script for a fresh Ubuntu VM.
# Run this on the target VM after SSH login.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERR]${NC} $1" >&2; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    error "Required command not found: $1"
    exit 1
  }
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  python3 - "$file" "$key" "$value" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
text = path.read_text() if path.exists() else ''
line = f'{key}={value}'
patterns = [
    rf'(?m)^{re.escape(key)}=.*$',
    rf'(?m)^#\s*{re.escape(key)}=.*$'
]
for pattern in patterns:
    if re.search(pattern, text):
        text = re.sub(pattern, line, text, count=1)
        path.write_text(text)
        sys.exit(0)
if text and not text.endswith('\n'):
    text += '\n'
text += line + '\n'
path.write_text(text)
PY
}

ensure_prod_public_url() {
  local file="$1"
  local public_url="$2"
  python3 - "$file" "$public_url" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
public_url = sys.argv[2]
text = path.read_text()
pattern = r'(name:\s*"tower-prod",\s*env:\s*\{[^\n]*PUBLIC_URL:\s*")[^"]+("\s*\},)'
new_text, count = re.subn(pattern, rf'\1{public_url}\2', text, count=1)
if count != 1:
    raise SystemExit('Failed to update tower-prod PUBLIC_URL in ecosystem.config.cjs')
path.write_text(new_text)
PY
}

PORT="32364"
APP_DIR="$HOME/apps/tower"
WORKSPACE_ROOT="$HOME/workspace"
REPO_URL=""
DOMAIN=""
SSL_MODE="cloudflare"
CERTBOT_EMAIL=""
SKIP_NGINX="false"
SKIP_BUILD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-url) REPO_URL="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --workspace-root) WORKSPACE_ROOT="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --ssl-mode) SSL_MODE="$2"; shift 2 ;;
    --certbot-email) CERTBOT_EMAIL="$2"; shift 2 ;;
    --skip-nginx) SKIP_NGINX="true"; shift ;;
    --skip-build) SKIP_BUILD="true"; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: bash scripts/azure/bootstrap-prod.sh [options]

Required:
  --repo-url <git-url>
  --domain <fqdn>

Optional:
  --app-dir <path>               Default: ~/apps/tower
  --workspace-root <path>        Default: ~/workspace
  --port <port>                  Default: 32364
  --ssl-mode <cloudflare|certbot|none>  Default: cloudflare
  --certbot-email <email>        Required when --ssl-mode certbot
  --skip-nginx                   Skip nginx configuration
  --skip-build                   Skip npm build + prod-start

Secrets / optional env vars:
  ANTHROPIC_API_KEY
  OPENROUTER_API_KEY
  OPENAI_API_KEY
  PI_ENABLED=true
  DEFAULT_ENGINE=claude|pi
EOF
      exit 0
      ;;
    *)
      error "Unknown argument: $1"
      exit 1
      ;;
  esac
done

if [[ -z "$REPO_URL" ]]; then
  error "--repo-url is required"
  exit 1
fi

if [[ -z "$DOMAIN" ]]; then
  error "--domain is required"
  exit 1
fi

if [[ "$SSL_MODE" == "certbot" && -z "$CERTBOT_EMAIL" ]]; then
  error "--certbot-email is required when --ssl-mode certbot"
  exit 1
fi

require_cmd sudo
require_cmd python3
require_cmd curl
require_cmd git

info "Installing base packages"
sudo apt update
sudo apt install -y curl ca-certificates gnupg lsb-release unzip jq build-essential python3 git nginx

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE '^v2[0-9]\.'; then
  info "Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
else
  info "Node.js already installed: $(node -v)"
fi

if ! command -v pm2 >/dev/null 2>&1; then
  info "Installing PM2"
  sudo npm install -g pm2
else
  info "PM2 already installed: $(pm2 -v)"
fi

if ! command -v claude >/dev/null 2>&1; then
  info "Installing Claude Code CLI"
  sudo npm install -g @anthropic-ai/claude-code
else
  info "Claude Code CLI already installed: $(claude --version)"
fi

mkdir -p "$(dirname "$APP_DIR")"
if [[ ! -d "$APP_DIR/.git" ]]; then
  info "Cloning repository into $APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
else
  info "Repository already exists — pulling latest changes"
  git -C "$APP_DIR" fetch --all --tags
  git -C "$APP_DIR" pull --ff-only
fi

cd "$APP_DIR"
info "Installing npm dependencies"
npm install

if [[ ! -f .env ]]; then
  cp .env.example .env
  info "Created .env from .env.example"
else
  info ".env already exists — updating required values"
fi

JWT_SECRET_VALUE=$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)

set_env_value .env HOST 0.0.0.0
set_env_value .env PORT "$PORT"
set_env_value .env WORKSPACE_ROOT "$WORKSPACE_ROOT"
set_env_value .env DEFAULT_CWD "$WORKSPACE_ROOT"
set_env_value .env DB_PATH data/tower.db
set_env_value .env GIT_AUTO_COMMIT true
set_env_value .env PERMISSION_MODE bypassPermissions
set_env_value .env PUBLIC_URL "https://$DOMAIN"

CURRENT_JWT=$(python3 - <<'PY'
import pathlib, re
text = pathlib.Path('.env').read_text()
m = re.search(r'(?m)^JWT_SECRET=(.*)$', text)
print((m.group(1).strip() if m else ''))
PY
)
if [[ -z "$CURRENT_JWT" || "$CURRENT_JWT" == "change-me-to-a-random-secret" || "$CURRENT_JWT" == "tower-secret-change-me" ]]; then
  set_env_value .env JWT_SECRET "$JWT_SECRET_VALUE"
  info "Generated JWT_SECRET"
else
  info "Keeping existing JWT_SECRET"
fi

if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  set_env_value .env ANTHROPIC_API_KEY "$ANTHROPIC_API_KEY"
  info "Configured ANTHROPIC_API_KEY from environment"
else
  warn "ANTHROPIC_API_KEY not provided — Claude auth login may still be required"
fi

if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
  set_env_value .env PI_ENABLED "${PI_ENABLED:-true}"
  set_env_value .env OPENROUTER_API_KEY "$OPENROUTER_API_KEY"
  set_env_value .env DEFAULT_ENGINE "${DEFAULT_ENGINE:-claude}"
  info "Configured PI/OpenRouter settings from environment"
fi

if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  set_env_value .env OPENAI_API_KEY "$OPENAI_API_KEY"
  info "Configured OPENAI_API_KEY from environment"
fi

ensure_prod_public_url ecosystem.config.cjs "https://$DOMAIN"
info "Updated tower-prod PUBLIC_URL in ecosystem.config.cjs"

mkdir -p "$WORKSPACE_ROOT"
if [[ -d templates/workspace ]]; then
  cp -rn templates/workspace/* "$WORKSPACE_ROOT"/ || true
  info "Workspace prepared at $WORKSPACE_ROOT"
fi

if [[ "$SKIP_BUILD" != "true" ]]; then
  info "Building Tower"
  npm run build

  info "Starting production instance"
  ./start.sh prod-start
  ./start.sh prod-status || true
fi

if [[ "$SKIP_NGINX" != "true" ]]; then
  info "Writing nginx site for $DOMAIN"
  sudo tee "/etc/nginx/sites-available/$DOMAIN" >/dev/null <<EOF
server {
    client_max_body_size 50m;
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

  sudo ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
  if [[ -L /etc/nginx/sites-enabled/default ]]; then
    sudo rm -f /etc/nginx/sites-enabled/default
  fi
  sudo nginx -t
  sudo systemctl reload nginx
  info "nginx reloaded"
fi

if [[ "$SSL_MODE" == "certbot" ]]; then
  info "Installing certbot"
  sudo apt install -y certbot python3-certbot-nginx
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
  info "certbot configured HTTPS"
elif [[ "$SSL_MODE" == "cloudflare" ]]; then
  warn "Cloudflare mode selected — create DNS A record to this VM and enable proxy/SSL there"
else
  warn "SSL mode is 'none' — HTTP only until you add HTTPS"
fi

if [[ "$SKIP_BUILD" != "true" ]]; then
  info "Running prod verification"
  ./start.sh prod-verify
fi

pm2 save >/dev/null 2>&1 || true
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" >/tmp/pm2-startup.log 2>&1 || true

echo ""
info "Bootstrap complete"
echo "  App dir      : $APP_DIR"
echo "  Workspace    : $WORKSPACE_ROOT"
echo "  Domain       : https://$DOMAIN"
echo "  Prod port    : $PORT"
echo ""
echo "Next manual checks:"
echo "  1) DNS A record for $DOMAIN -> this VM public IP"
echo "  2) claude auth status"
echo "  3) Open https://$DOMAIN and create the first admin account"
echo "  4) Send a test chat message"
