#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
# Claude Memory Hooks — One-Step Installer
# ─────────────────────────────────────────────
# Usage:  bash install.sh
#         bash install.sh --uninstall
# ─────────────────────────────────────────────

CLAUDE_DIR="$HOME/.claude"
HOOKS_DIR="$CLAUDE_DIR/hooks/memory"
COMMANDS_DIR="$CLAUDE_DIR/commands"
SETTINGS="$CLAUDE_DIR/settings.json"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR/src"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!!]${NC} $1"; }
error() { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

# ── Uninstall ──

if [[ "${1:-}" == "--uninstall" ]]; then
  echo "Uninstalling Claude Memory Hooks..."
  rm -rf "$HOOKS_DIR"
  rm -f "$COMMANDS_DIR/memory.md"
  rm -f "$CLAUDE_DIR/memory.db" "$CLAUDE_DIR/memory.db-wal" "$CLAUDE_DIR/memory.db-shm"
  rm -f "$CLAUDE_DIR/memory_last_cleanup"

  if [[ -f "$SETTINGS" ]]; then
    # Remove hooks key from settings.json
    node -e "
      const fs = require('fs');
      const s = JSON.parse(fs.readFileSync('$SETTINGS', 'utf8'));
      delete s.hooks;
      fs.writeFileSync('$SETTINGS', JSON.stringify(s, null, 2) + '\n');
    " 2>/dev/null && info "Removed hooks from settings.json" || warn "Manual cleanup needed in settings.json"
  fi

  info "Uninstalled. Memory DB deleted."
  exit 0
fi

# ── Prerequisites ──

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Claude Memory Hooks Installer      ║"
echo "╚══════════════════════════════════════╝"
echo ""

command -v node >/dev/null 2>&1 || error "Node.js not found. Install Node.js 18+ first."

NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
[[ "$NODE_MAJOR" -ge 18 ]] || error "Node.js 18+ required (found: $(node -v))"
info "Node.js $(node -v)"

[[ -d "$CLAUDE_DIR" ]] || error "~/.claude directory not found. Install Claude Code first."
info "~/.claude exists"

[[ -d "$SRC_DIR" ]] || error "src/ directory not found. Run from the memory-hooks folder."

# ── Install ──

# 1. Copy source files
mkdir -p "$HOOKS_DIR"
cp "$SRC_DIR"/db.mjs "$HOOKS_DIR/"
cp "$SRC_DIR"/post-tool-use.mjs "$HOOKS_DIR/"
cp "$SRC_DIR"/session-start.mjs "$HOOKS_DIR/"
cp "$SRC_DIR"/stop.mjs "$HOOKS_DIR/"
cp "$SRC_DIR"/search.mjs "$HOOKS_DIR/"
cp "$SRC_DIR"/tower-sync-lib.mjs "$HOOKS_DIR/"
cp "$SRC_DIR"/tower-sync-stop.mjs "$HOOKS_DIR/"
cp "$SRC_DIR"/cli-import.mjs "$HOOKS_DIR/"
cp "$SRC_DIR"/package.json "$HOOKS_DIR/"
info "Source files copied to $HOOKS_DIR (incl. tower-sync)"

# 2. Install dependencies
cd "$HOOKS_DIR"
npm install --silent 2>&1 | tail -1
info "better-sqlite3 installed"

# 3. Create /memory command
mkdir -p "$COMMANDS_DIR"
cp "$SRC_DIR"/memory.md "$COMMANDS_DIR/"
info "/memory command installed"

# 4. Update settings.json (merge hooks into existing config)
node -e "
  const fs = require('fs');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf8')); } catch {}

  settings.hooks = settings.hooks || {};

  settings.hooks.SessionStart = [{
    hooks: [{
      type: 'command',
      command: 'node \$HOME/.claude/hooks/memory/session-start.mjs'
    }]
  }];

  settings.hooks.PostToolUse = settings.hooks.PostToolUse || [];
  // Remove existing memory hook if any
  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
    h => !JSON.stringify(h).includes('memory/post-tool-use')
  );
  settings.hooks.PostToolUse.push({
    matcher: 'Edit|Write|Bash|NotebookEdit',
    hooks: [{
      type: 'command',
      command: 'node \$HOME/.claude/hooks/memory/post-tool-use.mjs',
      async: true
    }]
  });

  // Stop: memory summary only (sync)
  settings.hooks.Stop = [{
    hooks: [
      {
        type: 'command',
        command: 'node \$HOME/.claude/hooks/memory/stop.mjs'
      }
    ]
  }];

  // SessionEnd: tower.db sync (async, once per session — avoids dual-writer conflict with Tower ws-handler)
  settings.hooks.SessionEnd = [{
    hooks: [
      {
        type: 'command',
        command: 'node \$HOME/.claude/hooks/memory/tower-sync-stop.mjs',
        async: true
      }
    ]
  }];

  fs.writeFileSync('$SETTINGS', JSON.stringify(settings, null, 2) + '\n');
"
info "settings.json updated with hooks"

# 5. Verify
node -e "import('$HOOKS_DIR/db.mjs').then(m => { m.getDb(); m.closeDb(); console.log('DB OK'); })" 2>&1 | grep -q "DB OK" \
  && info "DB initialization verified" \
  || warn "DB verification failed — check manually"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
info "Installation complete!"
echo ""
echo "  What happens now:"
echo "    - Every new Claude session auto-loads recent memory"
echo "    - Edit/Write/Bash actions are captured automatically"
echo "    - Session summaries are saved on exit"
echo "    - CLI sessions are synced to tower.db on exit"
echo ""
echo "  Commands:"
echo "    /memory <query>      Search memories"
echo "    /memory --stats      Show statistics"
echo "    /memory --recent     Show recent 20"
echo "    /memory --summaries  Show session summaries"
echo ""
echo "  Import existing CLI history:"
echo "    node ~/.claude/hooks/memory/cli-import.mjs"
echo "    node ~/.claude/hooks/memory/cli-import.mjs --dry-run"
echo ""
echo "  Uninstall:"
echo "    bash $SCRIPT_DIR/install.sh --uninstall"
echo ""
