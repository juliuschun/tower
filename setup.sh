#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
# Tower — One-Step Setup
# ─────────────────────────────────────────────
# Usage:  bash setup.sh
# ─────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!!]${NC} $1"; }
error() { echo -e "${RED}[ERR]${NC} $1"; }
step()  { echo -e "\n${CYAN}${BOLD}── $1 ──${NC}"; }

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       Tower — Setup Wizard         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ───────────────────────────────────
# Step 1: Prerequisites
# ───────────────────────────────────
step "Step 1/6: Checking prerequisites"

# Node.js
if ! command -v node &>/dev/null; then
  error "Node.js not found. Install Node.js 20+ first."
  echo "  https://nodejs.org/"
  exit 1
fi
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  error "Node.js 20+ required (found: $(node -v))"
  exit 1
fi
info "Node.js $(node -v)"

# Claude Code CLI
if command -v claude &>/dev/null; then
  info "Claude Code CLI found: $(which claude)"
else
  warn "Claude Code CLI not found."
  echo "  Install: npm install -g @anthropic-ai/claude-code"
  echo "  Then run: claude login"
  echo ""
  read -p "  Continue without Claude CLI? (y/N) " -n 1 -r
  echo
  [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

# ───────────────────────────────────
# Step 2: npm install
# ───────────────────────────────────
step "Step 2/6: Installing dependencies"

if [ -d "node_modules" ]; then
  info "node_modules exists, running npm install..."
else
  info "Fresh install..."
fi
npm install --silent 2>&1 | tail -3
info "Dependencies installed"

# ───────────────────────────────────
# Step 3: Environment file
# ───────────────────────────────────
step "Step 3/6: Environment configuration"

if [ -f ".env" ]; then
  info ".env already exists (skipping)"
else
  cp .env.example .env
  info "Created .env from .env.example"
  warn "Edit .env to set JWT_SECRET and other values!"
fi

# ───────────────────────────────────
# Step 4: Workspace directory
# ───────────────────────────────────
step "Step 4/6: Workspace setup"

# Determine workspace path from .env or default
WORKSPACE_DIR="$HOME/workspace"
if [ -f ".env" ]; then
  ENV_WS=$(grep -E "^WORKSPACE_ROOT=" .env 2>/dev/null | sed 's/WORKSPACE_ROOT=//' | sed "s|\\\$HOME|$HOME|g" || true)
  if [ -n "$ENV_WS" ]; then
    WORKSPACE_DIR="$ENV_WS"
  fi
fi

if [ -d "$WORKSPACE_DIR/decisions" ] && [ -f "$WORKSPACE_DIR/principles.md" ]; then
  info "Workspace already initialized at $WORKSPACE_DIR"
else
  echo "  Workspace directory: $WORKSPACE_DIR"
  read -p "  Initialize workspace structure? (Y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    mkdir -p "$WORKSPACE_DIR"
    # Copy templates (don't overwrite existing files)
    for item in templates/workspace/*; do
      name=$(basename "$item")
      if [ -d "$item" ]; then
        if [ ! -d "$WORKSPACE_DIR/$name" ]; then
          cp -r "$item" "$WORKSPACE_DIR/$name"
          info "Created $name/"
        else
          # Copy missing files into existing directory
          for f in "$item"/*; do
            fname=$(basename "$f")
            if [ ! -f "$WORKSPACE_DIR/$name/$fname" ]; then
              cp "$f" "$WORKSPACE_DIR/$name/$fname"
              info "Created $name/$fname"
            fi
          done
        fi
      else
        if [ ! -f "$WORKSPACE_DIR/$name" ]; then
          cp "$item" "$WORKSPACE_DIR/$name"
          info "Created $name"
        else
          info "$name already exists (skipping)"
        fi
      fi
    done
    info "Workspace initialized at $WORKSPACE_DIR"
  else
    warn "Skipped workspace setup"
  fi
fi

# ───────────────────────────────────
# Step 5: Claude Skills
# ───────────────────────────────────
step "Step 5/6: Claude skills & hooks"

CLAUDE_DIR="$HOME/.claude"

if [ -d "$CLAUDE_DIR" ]; then
  # Install bundled skills
  echo "  Installing bundled skills..."
  bash "$SCRIPT_DIR/install-skills.sh"
  echo ""

  # Memory hooks
  read -p "  Install memory hooks (session tracking)? (Y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    bash "$SCRIPT_DIR/memory-hooks/install.sh"
  else
    warn "Skipped memory hooks"
  fi
else
  warn "~/.claude not found — install Claude Code CLI first"
  echo "  Skills and hooks can be installed later:"
  echo "    ./install-skills.sh"
  echo "    bash memory-hooks/install.sh"
fi

# ───────────────────────────────────
# Step 6: Summary
# ───────────────────────────────────
step "Step 6/6: Setup complete!"

echo ""
echo "  ${BOLD}Quick start:${NC}"
echo "    npm run dev          Start development server"
echo "    open http://localhost:32354"
echo ""
echo "  ${BOLD}First time:${NC}"
echo "    1. Open http://localhost:32354 in your browser"
echo "    2. Create your admin account"
echo "    3. Start chatting with Claude!"
echo ""
echo "  ${BOLD}Production:${NC}"
echo "    npm run build        Build for production"
echo "    ./start.sh start     Start with PM2"
echo ""
echo "  ${BOLD}Optional:${NC}"
echo "    cloudflared tunnel --url http://localhost:32354"
echo "    → Expose to internet via Cloudflare tunnel"
echo ""

# Check for things that need manual attention
if [ -f ".env" ] && grep -q "change-me-to-a-random-secret" .env 2>/dev/null; then
  warn "Don't forget to change JWT_SECRET in .env!"
fi

echo "  For more info: see README.md"
echo ""
