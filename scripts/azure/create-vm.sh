#!/usr/bin/env bash
set -euo pipefail

# Azure VM creator for Tower production deployments
# Usage:
#   bash scripts/azure/create-vm.sh \
#     --resource-group my-rg \
#     --location koreacentral \
#     --vm-name okusystem \
#     --admin-user azureuser \
#     --ssh-key ~/.ssh/id_ed25519.pub

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

pick_default_ssh_key() {
  if [[ -f "$HOME/.ssh/id_ed25519.pub" ]]; then
    echo "$HOME/.ssh/id_ed25519.pub"
  elif [[ -f "$HOME/.ssh/id_rsa.pub" ]]; then
    echo "$HOME/.ssh/id_rsa.pub"
  else
    echo ""
  fi
}

RESOURCE_GROUP=""
LOCATION="koreacentral"
VM_NAME="okusystem"
ADMIN_USER="azureuser"
VM_SIZE="Standard_B2s"
IMAGE="Ubuntu2204"
SSH_KEY="$(pick_default_ssh_key)"
PUBLIC_IP_SKU="Standard"
TAGS="service=tower env=prod"
PRINT_IP_ONLY="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --resource-group) RESOURCE_GROUP="$2"; shift 2 ;;
    --location) LOCATION="$2"; shift 2 ;;
    --vm-name) VM_NAME="$2"; shift 2 ;;
    --admin-user) ADMIN_USER="$2"; shift 2 ;;
    --size) VM_SIZE="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    --public-ip-sku) PUBLIC_IP_SKU="$2"; shift 2 ;;
    --tags) TAGS="$2"; shift 2 ;;
    --print-ip-only) PRINT_IP_ONLY="true"; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: bash scripts/azure/create-vm.sh [options]

Required:
  --resource-group <name>

Optional:
  --location <azure-region>       Default: koreacentral
  --vm-name <name>                Default: okusystem
  --admin-user <username>         Default: azureuser
  --size <vm-size>                Default: Standard_B2s
  --image <image>                 Default: Ubuntu2204
  --ssh-key <public-key-path>     Default: ~/.ssh/id_ed25519.pub or ~/.ssh/id_rsa.pub
  --public-ip-sku <sku>           Default: Standard
  --tags "k=v k2=v2"              Default: service=tower env=prod
  --print-ip-only                 Print only the public IP on success
EOF
      exit 0
      ;;
    *)
      error "Unknown argument: $1"
      exit 1
      ;;
  esac
done

require_cmd az

if [[ -z "$RESOURCE_GROUP" ]]; then
  error "--resource-group is required"
  exit 1
fi

if [[ -z "$SSH_KEY" || ! -f "$SSH_KEY" ]]; then
  error "SSH public key not found. Pass --ssh-key <path>."
  exit 1
fi

az account show >/dev/null 2>&1 || {
  error "Azure CLI is not logged in. Run: az login"
  exit 1
}

if ! az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
  info "Creating resource group: $RESOURCE_GROUP ($LOCATION)"
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION" >/dev/null
else
  info "Resource group already exists: $RESOURCE_GROUP"
fi

info "Creating VM: $VM_NAME"
VM_JSON=$(az vm create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --location "$LOCATION" \
  --image "$IMAGE" \
  --size "$VM_SIZE" \
  --admin-username "$ADMIN_USER" \
  --authentication-type ssh \
  --ssh-key-values "$SSH_KEY" \
  --public-ip-sku "$PUBLIC_IP_SKU" \
  --tags $TAGS \
  --output json)

PUBLIC_IP=$(echo "$VM_JSON" | python3 -c 'import sys, json; print(json.load(sys.stdin)["publicIpAddress"])')
PRIVATE_IP=$(echo "$VM_JSON" | python3 -c 'import sys, json; print(json.load(sys.stdin)["privateIpAddress"])')

info "Opening NSG ports: 22, 80, 443"
az vm open-port --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" --port 22 --priority 1000 >/dev/null
az vm open-port --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" --port 80 --priority 1010 >/dev/null
az vm open-port --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" --port 443 --priority 1020 >/dev/null

if [[ "$PRINT_IP_ONLY" == "true" ]]; then
  echo "$PUBLIC_IP"
  exit 0
fi

echo ""
info "VM created successfully"
echo "  Resource Group : $RESOURCE_GROUP"
echo "  VM Name        : $VM_NAME"
echo "  Location       : $LOCATION"
echo "  Size           : $VM_SIZE"
echo "  Admin User     : $ADMIN_USER"
echo "  Public IP      : $PUBLIC_IP"
echo "  Private IP     : $PRIVATE_IP"
echo "  SSH Key        : $SSH_KEY"
echo ""
echo "Next step:"
echo "  ssh ${ADMIN_USER}@${PUBLIC_IP}"
