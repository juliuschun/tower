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
TIER="recommended"  # essential | recommended | full | managed

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
    --tier) TIER="$2"; shift 2 ;;
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
  --tier <essential|recommended|full|managed>   Default: recommended
  --skip-nginx                   Skip nginx configuration
  --skip-build                   Skip npm build + prod-start

Tiers:
  essential    — Node, PM2, Claude CLI, nginx (minimum to run Tower)
  recommended  — + Chromium, Playwright, Python3 pip, cron jobs (default)
  full         — + Docker, yq, htop, all monitoring tools
  managed      — = full + Neko remote browser (our-operated customer VMs)

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

# =========================================================================
# Tier 2: Recommended — browser automation, python, cron jobs
# =========================================================================
if [[ "$TIER" == "recommended" || "$TIER" == "full" ]]; then
  info "=== Tier 2: Recommended extras ==="

  # --- Chromium (snap) ---
  if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
    info "Installing Chromium via snap"
    sudo snap install chromium 2>/dev/null || warn "snap not available — skipping Chromium"
  else
    info "Chromium already installed"
  fi

  # --- Playwright browsers (for Claude Code browser automation) ---
  if [[ ! -d "$HOME/.cache/ms-playwright" ]]; then
    info "Installing Playwright browsers + system deps"
    npx playwright install chromium --with-deps 2>/dev/null || warn "Playwright install failed — browser skills may not work"
  else
    info "Playwright browsers already installed"
  fi

  # --- Python3 pip ---
  if ! command -v pip3 >/dev/null 2>&1; then
    info "Installing python3-pip"
    sudo apt install -y python3-pip
  else
    info "pip3 already installed"
  fi

  # --- Cron: Claude task cleanup (every 30 min) ---
  CLEANUP_SCRIPT="$HOME/.claude/cleanup-tasks.sh"
  mkdir -p "$HOME/.claude"
  cat > "$CLEANUP_SCRIPT" <<'CLEANUP'
#!/bin/bash
# Claude task directory cleanup — remove orphan task dirs older than 2 hours
TASKS_DIR=~/.claude/tasks
[[ -d "$TASKS_DIR" ]] || exit 0
find "$TASKS_DIR" -mindepth 1 -maxdepth 1 -type d -mmin +120 | while read dir; do
  dir_name=$(basename "$dir")
  if lsof +D "$dir" 2>/dev/null | grep -q claude; then
    echo "[$(date '+%H:%M')] Skipping active: $dir_name" >> ~/.claude/cleanup-tasks.log
  else
    echo "[$(date '+%H:%M')] Removing orphan: $dir_name" >> ~/.claude/cleanup-tasks.log
    rm -rf "$dir"
  fi
done
CLEANUP
  chmod +x "$CLEANUP_SCRIPT"

  # --- Cron: Tower selfheal (every 5 min) ---
  SELFHEAL_SCRIPT="$APP_DIR/scripts/auto-selfheal-prod.sh"
  cat > "$SELFHEAL_SCRIPT" <<SELFHEAL
#!/bin/bash
# Tower prod auto-selfheal — restart if port $PORT is not listening
LOG="\$HOME/logs/tower-selfheal.log"
mkdir -p "\$HOME/logs"
if ! ss -tlnp | grep -q ":$PORT "; then
  echo "\$(date '+%Y-%m-%d %H:%M:%S') [HEAL] Port $PORT not listening — restarting tower-prod" >> "\$LOG"
  cd $APP_DIR && pm2 restart tower-prod 2>&1 >> "\$LOG"
else
  # Only log every hour to avoid noise
  minute=\$(date +%M)
  if [[ "\$minute" == "00" ]]; then
    echo "\$(date '+%Y-%m-%d %H:%M:%S') [OK] tower-prod healthy" >> "\$LOG"
  fi
fi
# Log rotation
if [[ -f "\$LOG" ]] && [[ \$(wc -l < "\$LOG") -gt 500 ]]; then
  tail -n 250 "\$LOG" > "\${LOG}.tmp" && mv "\${LOG}.tmp" "\$LOG"
fi
SELFHEAL
  chmod +x "$SELFHEAL_SCRIPT"

  # --- Register cron jobs (idempotent) ---
  CRON_TMP=$(mktemp)
  crontab -l 2>/dev/null > "$CRON_TMP" || true

  add_cron() {
    local schedule="$1"
    local cmd="$2"
    if ! grep -qF "$cmd" "$CRON_TMP"; then
      echo "$schedule $cmd" >> "$CRON_TMP"
      info "Cron added: $schedule $cmd"
    else
      info "Cron already exists: $cmd"
    fi
  }

  add_cron "*/30 * * * *" "$CLEANUP_SCRIPT"
  add_cron "*/5 * * * *" "$SELFHEAL_SCRIPT"

  crontab "$CRON_TMP"
  rm -f "$CRON_TMP"
  info "Cron jobs registered"
fi

# =========================================================================
# Tier 3: Full — Docker, extra tooling
# =========================================================================
if [[ "$TIER" == "full" || "$TIER" == "managed" ]]; then
  info "=== Tier 3: Full extras ==="

  # --- Docker ---
  if ! command -v docker >/dev/null 2>&1; then
    info "Installing Docker"
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
    info "Docker installed (re-login for group to take effect)"
  else
    info "Docker already installed: $(docker --version)"
  fi

  # --- yq (YAML processor) ---
  if ! command -v yq >/dev/null 2>&1; then
    info "Installing yq"
    sudo snap install yq 2>/dev/null || {
      # Fallback: direct binary
      YQ_VERSION="v4.44.1"
      sudo wget -qO /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_amd64"
      sudo chmod +x /usr/local/bin/yq
    }
  else
    info "yq already installed"
  fi

  # --- htop ---
  if ! command -v htop >/dev/null 2>&1; then
    info "Installing htop"
    sudo apt install -y htop
  fi
fi

# =========================================================================
# Tier 4: Managed — Neko remote browser (for our-operated customer VMs)
# Runs after nginx + Docker are in place. Idempotent.
# =========================================================================
if [[ "$TIER" == "managed" ]]; then
  info "=== Tier 4: Managed extras (Neko) ==="
  SETUP_NEKO="$APP_DIR/scripts/azure/setup-neko.sh"
  if [[ -x "$SETUP_NEKO" ]]; then
    bash "$SETUP_NEKO" --domain "$DOMAIN" --tower-port "$PORT" \
      || warn "setup-neko.sh exited non-zero — check logs and re-run manually"
  else
    warn "setup-neko.sh missing at $SETUP_NEKO — skipping. Run manually after repo update."
  fi
fi

echo ""
info "Bootstrap complete (tier: $TIER)"
echo "  App dir      : $APP_DIR"
echo "  Workspace    : $WORKSPACE_ROOT"
echo "  Domain       : https://$DOMAIN"
echo "  Prod port    : $PORT"
echo "  Tier         : $TIER"
echo ""
echo "Next manual checks:"
echo "  1) DNS A record for $DOMAIN -> this VM public IP"
echo "  2) claude auth status"
echo "  3) Open https://$DOMAIN and create the first admin account"
echo "  4) Send a test chat message"
