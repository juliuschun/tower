#\!/bin/bash
# Claude Code Skills 설치 스크립트
# Usage: ./install-skills.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_SRC="$SCRIPT_DIR/claude-skills"
CLAUDE_DIR="$HOME/.claude"

echo "=== Claude Code Skills Installer ==="
echo "Source: $SKILLS_SRC"
echo "Target: $CLAUDE_DIR"
echo ""

# skills 복사
if [ -d "$SKILLS_SRC/skills" ]; then
  mkdir -p "$CLAUDE_DIR/skills"
  for skill in "$SKILLS_SRC/skills"/*/; do
    name=$(basename "$skill")
    if [ -d "$CLAUDE_DIR/skills/$name" ]; then
      echo "[update] skills/$name"
      rm -rf "$CLAUDE_DIR/skills/$name"
    else
      echo "[install] skills/$name"
    fi
    cp -r "$skill" "$CLAUDE_DIR/skills/$name"
  done
fi

# commands 복사
if [ -d "$SKILLS_SRC/commands" ]; then
  mkdir -p "$CLAUDE_DIR/commands"
  for cmd in "$SKILLS_SRC/commands"/*.md; do
    name=$(basename "$cmd")
    echo "[install] commands/$name"
    cp "$cmd" "$CLAUDE_DIR/commands/$name"
  done
fi

# agents 복사
if [ -d "$SKILLS_SRC/agents" ]; then
  mkdir -p "$CLAUDE_DIR/agents"
  for agent in "$SKILLS_SRC/agents"/*.md; do
    name=$(basename "$agent")
    echo "[install] agents/$name"
    cp "$agent" "$CLAUDE_DIR/agents/$name"
  done
fi

echo ""
echo "=== 설치 완료 ==="
echo "Skills:   $(ls -d "$CLAUDE_DIR/skills"/*/ 2>/dev/null | wc -l | tr -d  )개"
echo "Commands: $(ls "$CLAUDE_DIR/commands"/*.md 2>/dev/null | wc -l | tr -d  )개"
echo "Agents:   $(ls "$CLAUDE_DIR/agents"/*.md 2>/dev/null | wc -l | tr -d  )개"
