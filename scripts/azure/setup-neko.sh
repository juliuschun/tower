#!/usr/bin/env bash
set -euo pipefail

# setup-neko.sh — Install/restore the Neko remote browser stack on a managed
# Tower customer VM. Idempotent: safe to re-run. Installs Docker if missing,
# drops neko-start.sh/neko-stop.sh into ~/.claude/scripts/, generates a random
# admin password in ~/.tower/neko-password (only if absent), pulls the Neko
# image, starts the container, and injects `/neko/` + `/internal/auth`
# location blocks into the site's nginx conf behind Tower's JWT auth.
#
# Usage:
#   bash setup-neko.sh --domain <fqdn> [--tower-port 32364] [--neko-port 32800]
#
# Example:
#   bash setup-neko.sh --domain okusystem.moatai.app

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERR]${NC} $1" >&2; }

DOMAIN=""
TOWER_PORT="32364"
NEKO_PORT="32800"
CDP_PORT="32801"
SKIP_NGINX="false"
SKIP_DOCKER="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --tower-port) TOWER_PORT="$2"; shift 2 ;;
    --neko-port) NEKO_PORT="$2"; shift 2 ;;
    --cdp-port) CDP_PORT="$2"; shift 2 ;;
    --skip-nginx) SKIP_NGINX="true"; shift ;;
    --skip-docker) SKIP_DOCKER="true"; shift ;;
    -h|--help)
      sed -n '4,20p' "$0"
      exit 0
      ;;
    *)
      error "Unknown argument: $1"
      exit 1
      ;;
  esac
done

if [[ -z "$DOMAIN" && "$SKIP_NGINX" != "true" ]]; then
  error "--domain is required (or pass --skip-nginx)"
  exit 1
fi

# ============================================================================
# 1. Docker
# ============================================================================
if [[ "$SKIP_DOCKER" != "true" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    info "Installing Docker via get.docker.com"
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
    DOCKER_FRESHLY_INSTALLED=1
    info "Docker installed. Group 'docker' added to $USER (takes effect on next login)."
  else
    info "Docker already present: $(docker --version 2>&1 | head -1)"
    DOCKER_FRESHLY_INSTALLED=0
  fi
else
  DOCKER_FRESHLY_INSTALLED=0
fi

# Helper: run docker via `sg docker -c` when the group hasn't yet taken effect,
# otherwise call `docker` directly. Falls back to sudo as last resort.
run_docker() {
  if docker ps >/dev/null 2>&1; then
    docker "$@"
  elif sg docker -c "docker ps" >/dev/null 2>&1; then
    sg docker -c "docker $*"
  else
    sudo docker "$@"
  fi
}

# ============================================================================
# 2. Password file
# ============================================================================
PW_DIR="$HOME/.tower"
PW_FILE="$PW_DIR/neko-password"
mkdir -p "$PW_DIR"
chmod 700 "$PW_DIR"
if [[ ! -s "$PW_FILE" ]]; then
  info "Generating random Neko admin password → $PW_FILE"
  python3 -c 'import secrets; print(secrets.token_urlsafe(16))' > "$PW_FILE"
  chmod 600 "$PW_FILE"
else
  info "Reusing existing Neko password at $PW_FILE"
fi
NEKO_PW=$(cat "$PW_FILE")

# ============================================================================
# 3. Drop ~/.claude/scripts/neko-start.sh + neko-stop.sh (managed-VM variants)
# ============================================================================
SCRIPTS_DIR="$HOME/.claude/scripts"
mkdir -p "$SCRIPTS_DIR"

cat > "$SCRIPTS_DIR/neko-start.sh" <<EOF
#!/usr/bin/env bash
# neko-start.sh — On-demand Neko browser with CDP + idle watchdog.
# Managed-VM variant: reads admin password from \$HOME/.tower/neko-password.
set -euo pipefail

CONTAINER_NAME="neko-browser"
NEKO_PORT=${NEKO_PORT}
CDP_PORT=${CDP_PORT}
WATCHDOG_PID_FILE="/tmp/neko-watchdog.pid"
LOG_FILE="/tmp/neko.log"
IDLE_MINUTES=60

PW_FILE="\$HOME/.tower/neko-password"
if [[ -s "\$PW_FILE" ]]; then
  NEKO_PW="\$(cat "\$PW_FILE")"
else
  NEKO_PW="tower"
fi

if docker ps --filter name="\$CONTAINER_NAME" --format '{{.Status}}' 2>/dev/null | grep -q "Up"; then
  health=\$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:\$NEKO_PORT/" 2>/dev/null || echo "000")
  if [[ "\$health" == "200" ]]; then
    echo "neko already running"
    exit 0
  fi
fi

docker start "\$CONTAINER_NAME" 2>/dev/null || {
  echo "neko container not found, creating..."
  docker run -d \\
    --name "\$CONTAINER_NAME" \\
    --restart unless-stopped \\
    -p "\$NEKO_PORT":8080 \\
    -p "\$CDP_PORT":9223 \\
    -e NEKO_SCREEN=1280x720@30 \\
    -e NEKO_PASSWORD="\$NEKO_PW" \\
    -e NEKO_PASSWORD_ADMIN="\$NEKO_PW" \\
    -e NEKO_IMPLICIT_CONTROL=true \\
    -e NEKO_EPR=52000-52100 \\
    -p 52000-52100:52000-52100/udp \\
    --shm-size=2g \\
    ghcr.io/m1k1o/neko/chromium:latest
}

echo "\$(date): neko starting..." >> "\$LOG_FILE"

for i in \$(seq 1 20); do
  if docker ps --filter name="\$CONTAINER_NAME" --format '{{.Status}}' 2>/dev/null | grep -q "healthy"; then
    echo "neko started (container: \$CONTAINER_NAME)"

    has_cdp=\$(docker exec "\$CONTAINER_NAME" bash -c 'cat /etc/chromium.d/cdp 2>/dev/null' || true)
    if [[ -z "\$has_cdp" ]]; then
      docker exec "\$CONTAINER_NAME" bash -c '
        echo "CHROMIUM_FLAGS=\\"\\\${CHROMIUM_FLAGS} --remote-debugging-port=9222\\"" > /etc/chromium.d/cdp
        apt-get update -qq > /dev/null 2>&1
        apt-get install -y -qq socat > /dev/null 2>&1
      '
      docker exec "\$CONTAINER_NAME" supervisorctl restart chromium 2>/dev/null || true
      sleep 3
      docker exec -d "\$CONTAINER_NAME" socat TCP4-LISTEN:9223,fork,reuseaddr TCP4:127.0.0.1:9222
      sleep 1
    fi

    echo "\$(date): neko ready" >> "\$LOG_FILE"
    break
  fi
  sleep 1
done

if [[ -f "\$WATCHDOG_PID_FILE" ]]; then
  old_wd=\$(cat "\$WATCHDOG_PID_FILE")
  kill "\$old_wd" 2>/dev/null || true
  rm -f "\$WATCHDOG_PID_FILE"
fi

(
  while true; do
    sleep 300
    if ! docker ps --filter name="\$CONTAINER_NAME" --format '{{.Status}}' 2>/dev/null | grep -q "Up"; then
      break
    fi
    if find "\$LOG_FILE" -mmin +"\$IDLE_MINUTES" -print -quit | grep -q .; then
      echo "\$(date): idle \${IDLE_MINUTES}m, stopping neko" >> "\$LOG_FILE"
      docker stop "\$CONTAINER_NAME" 2>/dev/null
      break
    fi
  done
) &
echo \$! > "\$WATCHDOG_PID_FILE"
disown

echo "neko ready with CDP on :\$CDP_PORT"
EOF
chmod +x "$SCRIPTS_DIR/neko-start.sh"

cat > "$SCRIPTS_DIR/neko-stop.sh" <<'EOF'
#!/usr/bin/env bash
# neko-stop.sh — Stop Neko browser container and watchdog
CONTAINER_NAME="neko-browser"
WATCHDOG_PID_FILE="/tmp/neko-watchdog.pid"

if [[ -f "$WATCHDOG_PID_FILE" ]]; then
  pid=$(cat "$WATCHDOG_PID_FILE")
  kill "$pid" 2>/dev/null || true
  rm -f "$WATCHDOG_PID_FILE"
fi

docker stop "$CONTAINER_NAME" 2>/dev/null && echo "neko stopped" || echo "neko was not running"
EOF
chmod +x "$SCRIPTS_DIR/neko-stop.sh"
info "Dropped neko-start.sh / neko-stop.sh into $SCRIPTS_DIR"

# ============================================================================
# 4. Pull image + start container (first run only; subsequent runs skip)
# ============================================================================
if [[ "$SKIP_DOCKER" != "true" ]]; then
  info "Pulling Neko image (may take a minute on first run)"
  run_docker pull ghcr.io/m1k1o/neko/chromium:latest >/dev/null
  info "Starting Neko container"
  # neko-start.sh uses plain `docker`; if the group isn't active yet, wrap it.
  if docker ps >/dev/null 2>&1; then
    bash "$SCRIPTS_DIR/neko-start.sh" || warn "neko-start.sh exited non-zero"
  else
    sg docker -c "bash $SCRIPTS_DIR/neko-start.sh" || warn "neko-start.sh exited non-zero (via sg)"
  fi
fi

# ============================================================================
# 5. Inject /neko/ + /internal/auth into nginx site conf (idempotent)
# ============================================================================
if [[ "$SKIP_NGINX" != "true" ]]; then
  NGINX_SITE="/etc/nginx/sites-available/$DOMAIN"
  if [[ ! -f "$NGINX_SITE" ]]; then
    error "Nginx site file not found: $NGINX_SITE"
    error "Run bootstrap-prod.sh first to establish the base site."
    exit 1
  fi

  # Backup once per setup-neko run
  sudo cp -n "$NGINX_SITE" "${NGINX_SITE}.pre-neko.bak" || true

  sudo python3 - "$NGINX_SITE" "$TOWER_PORT" "$NEKO_PORT" <<'PY'
import re, sys, pathlib
path = pathlib.Path(sys.argv[1])
tower_port = sys.argv[2]
neko_port = sys.argv[3]
text = path.read_text()

# Build blocks to inject
auth_block = f"""    # ── Auth subrequest (Tower JWT check) ──
    location = /internal/auth {{
        internal;
        proxy_pass http://localhost:{tower_port}/api/auth/check;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Authorization $http_authorization;
    }}
"""

neko_block = f"""    # ── Neko Browser (login required) ──
    location /neko/ {{
        auth_request /internal/auth;
        error_page 401 = @neko_unauthorized;

        proxy_pass http://127.0.0.1:{neko_port}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}
    location @neko_unauthorized {{
        return 302 /?login=required;
    }}
"""

changed = False

if '/internal/auth' not in text:
    # Inject before the first `location /` (root location) on a SSL-enabled server
    pattern = r'(\n\s*location\s+/\s*\{)'
    new_text, n = re.subn(pattern, '\n' + auth_block + r'\1', text, count=1)
    if n != 1:
        sys.stderr.write("Failed to locate 'location /' to inject auth block\n")
        sys.exit(2)
    text = new_text
    changed = True
    print("[py] injected /internal/auth block")
else:
    print("[py] /internal/auth already present — skipping")

if 'location /neko/' not in text:
    pattern = r'(\n\s*location\s+/\s*\{)'
    new_text, n = re.subn(pattern, '\n' + neko_block + r'\1', text, count=1)
    if n != 1:
        sys.stderr.write("Failed to locate 'location /' to inject neko block\n")
        sys.exit(3)
    text = new_text
    changed = True
    print("[py] injected /neko/ block")
else:
    print("[py] /neko/ already present — skipping")

if changed:
    path.write_text(text)
    print("[py] nginx conf updated")
else:
    print("[py] nginx conf already complete — no change")
PY

  info "Validating nginx config"
  if ! sudo nginx -t 2>&1; then
    error "nginx -t failed. Restoring backup."
    sudo cp "${NGINX_SITE}.pre-neko.bak" "$NGINX_SITE"
    exit 1
  fi
  info "Reloading nginx"
  sudo systemctl reload nginx
fi

# ============================================================================
# 6. Summary
# ============================================================================
echo ""
info "Neko setup complete."
echo "  Container    : neko-browser"
echo "  Local port   : $NEKO_PORT → container :8080"
echo "  CDP port     : $CDP_PORT  → container :9223"
echo "  Public URL   : ${DOMAIN:+https://$DOMAIN/neko/ (behind Tower login)}"
echo "  Admin pw     : \$HOME/.tower/neko-password (chmod 600, never commit)"
echo "  Scripts      : $SCRIPTS_DIR/neko-{start,stop}.sh"
if [[ "$DOCKER_FRESHLY_INSTALLED" == "1" ]]; then
  warn "Docker was freshly installed. Re-login (or run 'newgrp docker') so '$USER' can use docker without sudo."
fi
echo ""
echo "Verify:"
echo "  curl -s http://localhost:$NEKO_PORT/ | head -1       # expect 200"
echo "  docker ps --filter name=neko-browser"
