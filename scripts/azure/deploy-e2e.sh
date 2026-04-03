#!/usr/bin/env bash
set -euo pipefail

# End-to-end Azure deployment helper for Tower production.
# This script creates the VM, waits for SSH, copies the bootstrap script,
# and runs the server-side provisioning flow.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERR]${NC} $1" >&2; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CREATE_VM_SCRIPT="$SCRIPT_DIR/create-vm.sh"
BOOTSTRAP_SCRIPT="$SCRIPT_DIR/bootstrap-prod.sh"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    error "Required command not found: $1"
    exit 1
  }
}

RESOURCE_GROUP=""
LOCATION="koreacentral"
VM_NAME="okusystem"
ADMIN_USER="azureuser"
VM_SIZE="Standard_B2s"
IMAGE="Ubuntu2204"
SSH_KEY="${HOME}/.ssh/id_ed25519.pub"
REPO_URL=""
DOMAIN=""
SSL_MODE="cloudflare"
CERTBOT_EMAIL=""
EXISTING_HOST=""
SKIP_VM_CREATE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --resource-group) RESOURCE_GROUP="$2"; shift 2 ;;
    --location) LOCATION="$2"; shift 2 ;;
    --vm-name) VM_NAME="$2"; shift 2 ;;
    --admin-user) ADMIN_USER="$2"; shift 2 ;;
    --size) VM_SIZE="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    --repo-url) REPO_URL="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --ssl-mode) SSL_MODE="$2"; shift 2 ;;
    --certbot-email) CERTBOT_EMAIL="$2"; shift 2 ;;
    --existing-host) EXISTING_HOST="$2"; SKIP_VM_CREATE="true"; shift 2 ;;
    --skip-vm-create) SKIP_VM_CREATE="true"; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: bash scripts/azure/deploy-e2e.sh [options]

Required:
  --repo-url <git-url>
  --domain <fqdn>

If creating a new VM:
  --resource-group <name>

Optional:
  --location <region>            Default: koreacentral
  --vm-name <name>               Default: okusystem
  --admin-user <username>        Default: azureuser
  --size <vm-size>               Default: Standard_B2s
  --image <image>                Default: Ubuntu2204
  --ssh-key <public-key-path>    Default: ~/.ssh/id_ed25519.pub
  --ssl-mode <cloudflare|certbot|none>  Default: cloudflare
  --certbot-email <email>        Required when --ssl-mode certbot
  --existing-host <ip-or-host>   Skip VM creation and use an existing server
  --skip-vm-create               Skip Azure VM creation (requires --existing-host)

Examples:
  bash scripts/azure/deploy-e2e.sh \
    --resource-group tower-rg \
    --location koreacentral \
    --vm-name okusystem \
    --admin-user azureuser \
    --repo-url git@github.com:your-org/tower.git \
    --domain tower.example.com \
    --ssl-mode cloudflare

  bash scripts/azure/deploy-e2e.sh \
    --skip-vm-create \
    --existing-host 20.249.10.11 \
    --admin-user azureuser \
    --repo-url git@github.com:your-org/tower.git \
    --domain tower.example.com

Notes:
  - ANTHROPIC_API_KEY / OPENROUTER_API_KEY can be exported before running if desired.
  - DNS and browser-based Claude login may still require a manual step.
EOF
      exit 0
      ;;
    *)
      error "Unknown argument: $1"
      exit 1
      ;;
  esac
done

require_cmd ssh
require_cmd scp
require_cmd bash

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

HOST=""
if [[ "$SKIP_VM_CREATE" == "true" ]]; then
  if [[ -z "$EXISTING_HOST" ]]; then
    error "--existing-host is required when skipping VM creation"
    exit 1
  fi
  HOST="$EXISTING_HOST"
  info "Using existing host: $HOST"
else
  if [[ -z "$RESOURCE_GROUP" ]]; then
    error "--resource-group is required when creating a VM"
    exit 1
  fi
  require_cmd az
  HOST=$(bash "$CREATE_VM_SCRIPT" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --vm-name "$VM_NAME" \
    --admin-user "$ADMIN_USER" \
    --size "$VM_SIZE" \
    --image "$IMAGE" \
    --ssh-key "$SSH_KEY" \
    --print-ip-only)
  info "New VM public IP: $HOST"
fi

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)

info "Waiting for SSH on $HOST"
for _ in $(seq 1 30); do
  if ssh "${SSH_OPTS[@]}" "${ADMIN_USER}@${HOST}" 'echo ssh-ready' >/dev/null 2>&1; then
    info "SSH is ready"
    break
  fi
  sleep 10
done

if ! ssh "${SSH_OPTS[@]}" "${ADMIN_USER}@${HOST}" 'echo ssh-ready' >/dev/null 2>&1; then
  error "SSH did not become ready in time"
  exit 1
fi

info "Copying bootstrap script"
scp "${SSH_OPTS[@]}" "$BOOTSTRAP_SCRIPT" "${ADMIN_USER}@${HOST}:/tmp/bootstrap-tower-prod.sh" >/dev/null

REMOTE_ENV=(
  "REPO_URL=$(printf '%q' "$REPO_URL")"
  "DOMAIN=$(printf '%q' "$DOMAIN")"
  "SSL_MODE=$(printf '%q' "$SSL_MODE")"
)
if [[ -n "$CERTBOT_EMAIL" ]]; then
  REMOTE_ENV+=("CERTBOT_EMAIL=$(printf '%q' "$CERTBOT_EMAIL")")
fi
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  warn "Passing ANTHROPIC_API_KEY via SSH environment for automated bootstrap"
  REMOTE_ENV+=("ANTHROPIC_API_KEY=$(printf '%q' "$ANTHROPIC_API_KEY")")
fi
if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
  warn "Passing OPENROUTER_API_KEY via SSH environment for automated bootstrap"
  REMOTE_ENV+=("OPENROUTER_API_KEY=$(printf '%q' "$OPENROUTER_API_KEY")")
fi
if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  warn "Passing OPENAI_API_KEY via SSH environment for automated bootstrap"
  REMOTE_ENV+=("OPENAI_API_KEY=$(printf '%q' "$OPENAI_API_KEY")")
fi
if [[ -n "${PI_ENABLED:-}" ]]; then
  REMOTE_ENV+=("PI_ENABLED=$(printf '%q' "$PI_ENABLED")")
fi
if [[ -n "${DEFAULT_ENGINE:-}" ]]; then
  REMOTE_ENV+=("DEFAULT_ENGINE=$(printf '%q' "$DEFAULT_ENGINE")")
fi

REMOTE_CMD=$(cat <<EOF
set -euo pipefail
chmod +x /tmp/bootstrap-tower-prod.sh
export ${REMOTE_ENV[*]}
bash /tmp/bootstrap-tower-prod.sh --repo-url "$REPO_URL" --domain "$DOMAIN" --ssl-mode "$SSL_MODE" ${CERTBOT_EMAIL:+--certbot-email "$CERTBOT_EMAIL"}
EOF
)

info "Running remote bootstrap"
ssh "${SSH_OPTS[@]}" "${ADMIN_USER}@${HOST}" "$REMOTE_CMD"

echo ""
info "Deployment flow finished"
echo "  Host         : $HOST"
echo "  Domain       : https://$DOMAIN"
echo "  SSH          : ssh ${ADMIN_USER}@${HOST}"
echo ""
echo "Remaining manual steps:"
echo "  1) Point DNS A record for $DOMAIN to $HOST"
echo "  2) If using Claude Max login: ssh in and run 'claude auth login'"
echo "  3) Open https://$DOMAIN and perform browser smoke tests"
