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

# Portable sed -i (macOS requires '' argument, Linux does not)
sed_inplace() { if [[ "$OSTYPE" == "darwin"* ]]; then sed -i '' "$@"; else sed -i "$@"; fi; }

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       Tower — Setup Wizard         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ───────────────────────────────────
# Step 1: Prerequisites
# ───────────────────────────────────
step "Step 1/7: Checking prerequisites"

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
CLAUDE_AUTHENTICATED=false
if command -v claude &>/dev/null; then
  info "Claude Code CLI found: $(which claude)"

  # Check if already authenticated (via login or ANTHROPIC_API_KEY)
  AUTH_JSON=$(claude auth status 2>/dev/null || echo '{}')
  if echo "$AUTH_JSON" | grep -q '"loggedIn": true'; then
    info "Claude CLI authenticated"
    CLAUDE_AUTHENTICATED=true
  else
    warn "Claude CLI installed but not authenticated."
    echo ""
    echo "  ${BOLD}How to authenticate:${NC}"
    echo "    1) Browser login — opens a URL you can paste into any browser (Max/Pro plan)"
    echo "    2) API Key       — paste your Anthropic API key"
    echo "    3) Copy creds    — copy ~/.claude/.credentials.json from another machine"
    echo "    4) Skip          — set up later"
    echo ""
    read -p "  Choice (1/2/3/4): " -n 1 -r AUTH_CHOICE
    echo

    if [[ "$AUTH_CHOICE" == "1" ]]; then
      echo ""
      echo "  ${BOLD}Starting login...${NC}"
      echo "  A URL will appear below. Copy it and open in any browser."
      echo "  (Even on a different computer — it will authenticate this machine.)"
      echo ""
      claude auth login 2>&1 || true
      # Re-check
      AUTH_JSON=$(claude auth status 2>/dev/null || echo '{}')
      if echo "$AUTH_JSON" | grep -q '"loggedIn": true'; then
        info "Claude CLI authenticated"
        CLAUDE_AUTHENTICATED=true
      else
        warn "Authentication did not complete. You can try again later."
        echo "  Tip: run 'claude auth login' to retry"
      fi
    elif [[ "$AUTH_CHOICE" == "2" ]]; then
      echo ""
      read -p "  Anthropic API Key (sk-ant-...): " -r API_KEY_INPUT
      if [[ -n "$API_KEY_INPUT" && "$API_KEY_INPUT" == sk-ant-* ]]; then
        # Will be added to .env in step 3
        ANTHROPIC_API_KEY_PENDING="$API_KEY_INPUT"
        info "API key saved (will be added to .env)"
        CLAUDE_AUTHENTICATED=true
      else
        warn "Invalid API key format. Skipping authentication."
      fi
    elif [[ "$AUTH_CHOICE" == "3" ]]; then
      echo ""
      echo "  Copy the file from a machine where Claude is already authenticated:"
      echo "    scp user@other-machine:~/.claude/.credentials.json ~/.claude/.credentials.json"
      echo ""
      read -p "  Have you copied it? (y/N) " -n 1 -r COPIED
      echo
      if [[ "$COPIED" =~ ^[Yy]$ ]]; then
        AUTH_JSON=$(claude auth status 2>/dev/null || echo '{}')
        if echo "$AUTH_JSON" | grep -q '"loggedIn": true'; then
          info "Claude CLI authenticated"
          CLAUDE_AUTHENTICATED=true
        else
          warn "Credentials not detected. Copy the file and try 'claude auth status'."
        fi
      fi
    else
      warn "Skipped Claude authentication."
      echo "  Set ANTHROPIC_API_KEY in .env, or run 'claude auth login' later."
    fi
  fi
else
  warn "Claude Code CLI not found."
  echo ""
  echo "  ${BOLD}Install now?${NC}"
  echo "    1) Yes — install Claude Code CLI via npm"
  echo "    2) No  — I'll install it later"
  echo ""
  read -p "  Choice (1/2): " -n 1 -r INSTALL_CHOICE
  echo

  if [[ "$INSTALL_CHOICE" == "1" ]]; then
    echo "  Installing Claude Code CLI..."
    npm install -g @anthropic-ai/claude-code 2>&1 | tail -3
    if command -v claude &>/dev/null; then
      info "Claude Code CLI installed: $(claude --version 2>/dev/null)"

      echo ""
      echo "  ${BOLD}Authenticate now?${NC}"
      echo "    1) Browser login — opens a URL you can paste into any browser"
      echo "    2) API Key       — paste your Anthropic API key"
      echo "    3) Skip          — set up later"
      echo ""
      read -p "  Choice (1/2/3): " -n 1 -r AUTH_CHOICE
      echo

      if [[ "$AUTH_CHOICE" == "1" ]]; then
        echo ""
        echo "  A URL will appear. Copy it and open in any browser."
        echo ""
        claude auth login 2>&1 || true
        AUTH_JSON=$(claude auth status 2>/dev/null || echo '{}')
        if echo "$AUTH_JSON" | grep -q '"loggedIn": true'; then
          info "Claude CLI authenticated"
          CLAUDE_AUTHENTICATED=true
        else
          warn "Authentication did not complete. Run 'claude auth login' later."
        fi
      elif [[ "$AUTH_CHOICE" == "2" ]]; then
        echo ""
        read -p "  Anthropic API Key (sk-ant-...): " -r API_KEY_INPUT
        if [[ -n "$API_KEY_INPUT" && "$API_KEY_INPUT" == sk-ant-* ]]; then
          ANTHROPIC_API_KEY_PENDING="$API_KEY_INPUT"
          info "API key saved (will be added to .env)"
          CLAUDE_AUTHENTICATED=true
        else
          warn "Invalid API key format. Skipping authentication."
        fi
      fi
    else
      error "Installation failed. Install manually: npm install -g @anthropic-ai/claude-code"
    fi
  else
    warn "Skipping Claude CLI. Install later: npm install -g @anthropic-ai/claude-code"
  fi
fi

# ───────────────────────────────────
# Step 1.5: System packages
# ───────────────────────────────────
# LibreOffice Writer — required for DOCX → PDF preview
if command -v libreoffice &>/dev/null && dpkg -l libreoffice-writer &>/dev/null 2>&1; then
  info "LibreOffice Writer found"
else
  info "Installing LibreOffice Writer (required for DOCX preview)..."
  sudo apt-get install -y libreoffice-writer 2>&1 | tail -3
  info "LibreOffice Writer installed"
fi

# ───────────────────────────────────
# Step 2: npm install
# ───────────────────────────────────
step "Step 2/7: Installing dependencies"

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
step "Step 3/7: Environment configuration"

if [ -f ".env" ]; then
  info ".env already exists (skipping)"
else
  cp .env.example .env

  # Auto-generate JWT_SECRET (openssl preferred, fallback to node crypto)
  if command -v openssl &>/dev/null; then
    JWT_SECRET_VAL=$(openssl rand -hex 32)
  else
    JWT_SECRET_VAL=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  fi
  sed_inplace "s/change-me-to-a-random-secret/$JWT_SECRET_VAL/" .env
  info "JWT_SECRET auto-generated"

  # PUBLIC_URL — needed for correct share links when deployed
  echo ""
  echo "  ${BOLD}Public URL${NC} — used to generate share links."
  echo "  Set this to your domain (e.g. https://desk.yourteam.com)."
  echo "  Leave blank to skip (share links will use window.location.origin)."
  echo ""
  read -p "  PUBLIC_URL: " -r PUBLIC_URL_INPUT || true
  if [ -n "$PUBLIC_URL_INPUT" ]; then
    sed_inplace "s|^PUBLIC_URL=.*|PUBLIC_URL=$PUBLIC_URL_INPUT|" .env
    info "PUBLIC_URL set to $PUBLIC_URL_INPUT"
  else
    sed_inplace "s|^PUBLIC_URL=.*|# PUBLIC_URL=|" .env
    warn "PUBLIC_URL not set — share links will use browser origin"
  fi

  # Add ANTHROPIC_API_KEY if user provided it in step 1
  if [ -n "${ANTHROPIC_API_KEY_PENDING:-}" ]; then
    echo "" >> .env
    echo "# ── Anthropic API Key ──" >> .env
    echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY_PENDING" >> .env
    info "ANTHROPIC_API_KEY added to .env"
  fi

  info "Created .env"
fi

# ── Pi Agent (OpenRouter) ──
echo ""
echo "  ${BOLD}Pi Agent (Multi-Engine)${NC} — adds pay-per-token models via OpenRouter."
echo "  Supports: Claude, GPT, Gemini, Grok, Kimi, MiniMax, and 50+ more models."
echo "  (Requires an OpenRouter API key — https://openrouter.ai/keys)"
echo ""
read -p "  Enable Pi Agent? (y/N) " -n 1 -r PI_CHOICE
echo

if [[ "$PI_CHOICE" =~ ^[Yy]$ ]]; then
  # Add PI_ENABLED if not already set
  if ! grep -q "^PI_ENABLED=" .env 2>/dev/null; then
    echo "" >> .env
    echo "# ── Pi Agent (Multi-Engine) ──" >> .env
    echo "PI_ENABLED=true" >> .env
  else
    sed_inplace "s/^PI_ENABLED=.*/PI_ENABLED=true/" .env
  fi

  read -p "  OpenRouter API Key (sk-or-v1-...): " -r OR_KEY_INPUT
  if [[ -n "$OR_KEY_INPUT" && "$OR_KEY_INPUT" == sk-or-* ]]; then
    if ! grep -q "^OPENROUTER_API_KEY=" .env 2>/dev/null; then
      echo "OPENROUTER_API_KEY=$OR_KEY_INPUT" >> .env
    else
      sed_inplace "s/^OPENROUTER_API_KEY=.*/OPENROUTER_API_KEY=$OR_KEY_INPUT/" .env
    fi
    info "Pi Agent enabled with OpenRouter key"
  else
    if [ -n "$OR_KEY_INPUT" ]; then
      warn "Key format unexpected (expected sk-or-v1-...). Added anyway."
      if ! grep -q "^OPENROUTER_API_KEY=" .env 2>/dev/null; then
        echo "OPENROUTER_API_KEY=$OR_KEY_INPUT" >> .env
      fi
    else
      warn "No OpenRouter key provided. Set OPENROUTER_API_KEY in .env later."
    fi
  fi

  echo "  Pi models configured in: backend/engines/pi-models.json"
  echo "  Edit that file to add/remove models (no code changes needed)."
else
  warn "Skipped Pi Agent — only Claude engine will be available"
  echo "  To enable later: set PI_ENABLED=true and OPENROUTER_API_KEY in .env"
fi

# If user provided API key but .env already existed, add it
if [ -n "${ANTHROPIC_API_KEY_PENDING:-}" ] && ! grep -q "^ANTHROPIC_API_KEY=" .env 2>/dev/null; then
  echo "" >> .env
  echo "# ── Anthropic API Key ──" >> .env
  echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY_PENDING" >> .env
  info "ANTHROPIC_API_KEY added to .env"
fi

# ───────────────────────────────────
# Step 4: Workspace directory
# ───────────────────────────────────
step "Step 4/7: Workspace setup"

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
    for item in templates/workspace/* templates/workspace/.*; do
      # Skip . and .. entries
      [[ "$item" == */. || "$item" == */.. ]] && continue
      # Skip if glob didn't match (literal pattern returned)
      [ ! -e "$item" ] && continue
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

    # Team context wizard — fill MEMORY.md with real team info
    MEMORY_FILE="$WORKSPACE_DIR/memory/MEMORY.md"
    if [ -f "$MEMORY_FILE" ] && grep -q "What the team is working on right now" "$MEMORY_FILE" 2>/dev/null; then
      echo ""
      echo "  ${BOLD}Team context wizard${NC} — helps Claude know your team from Day 1."
      echo "  (Press Enter to skip any question)"
      echo ""

      read -p "  Team / company name: " -r TEAM_NAME || true
      read -p "  Team size (people): " -r TEAM_SIZE || true
      read -p "  Main tech stack (e.g. TypeScript, Python, React): " -r TECH_STACK || true
      read -p "  Current top priority project: " -r TOP_PROJECT || true
      echo "  Primary language for Claude responses:"
      echo "    1) 한국어   2) English"
      read -p "  Choice (1/2, default 1): " -n 1 -r LANG_CHOICE || true
      echo

      LANG_CHOICE="${LANG_CHOICE:-1}"
      TEAM_NAME="${TEAM_NAME:-My Team}"
      TODAY=$(date +%Y-%m-%d)

      if [[ "$LANG_CHOICE" == "2" ]]; then
        # English MEMORY.md
        cat > "$MEMORY_FILE" <<MEMEOF
# ${TEAM_NAME}

## Team
- Size: ${TEAM_SIZE:-unknown}
- Stack: ${TECH_STACK:-(not set)}
- Claude responds in: English

## Current Priority
- ${TOP_PROJECT:-(not set)}

## Workspace Structure
- \`principles.md\` — team principles
- \`decisions/\` — decision records (immutable, one file = one decision)
- \`docs/\` — process docs, guides
- \`notes/\` — temporary memos

## Rhythm
- **Weekly**: scan notes/ → promote to decisions/ or docs/
- **Monthly**: review docs/ — still accurate?
- **Quarterly**: update this MEMORY.md — reprioritize
MEMEOF

      else
        # Korean MEMORY.md
        cat > "$MEMORY_FILE" <<MEMEOF
# ${TEAM_NAME}

## 팀
- 규모: ${TEAM_SIZE:-미정}
- 기술 스택: ${TECH_STACK:-(미설정)}
- Claude 응답 언어: 한국어

## 현재 우선순위
- ${TOP_PROJECT:-(미설정)}

## 워크스페이스 구조
- \`principles.md\` — 팀 원칙
- \`decisions/\` — 결정 기록 (불변, 파일 하나 = 결정 하나)
- \`docs/\` — 정리된 문서 (프로세스, 가이드)
- \`notes/\` — 임시 메모, 아이디어

## 정리 리듬
- **주 1회**: notes/ 훑기 → 중요한 건 decisions/ 또는 docs/로 승격
- **월 1회**: docs/ 훑기 → "이거 아직 맞나?" 확인
- **분기 1회**: 이 MEMORY.md 업데이트 → 우선순위 점검
MEMEOF

        # Korean principles.md
        PRINCIPLES_FILE="$WORKSPACE_DIR/principles.md"
        cat > "$PRINCIPLES_FILE" <<PRINEOF
# 우리가 지키는 다섯 가지 원칙

## 1. 써라 (Write it down)
구두로 결정하지 않는다. 짧게라도 적는다.
적지 않은 결정은 나중에 "그때 뭐라고 했더라?"가 된다.

## 2. 왜를 남겨라 (Record the why)
"A로 결정했다"가 아니라 "B도 있었지만 A로 갔다. 이유는 X."
나중에 조건이 바뀌면 그때 다시 판단하기 위해.

## 3. 찾을 수 있게 해라 (Make it findable)
적는 것만큼 중요한 건 나중에 찾을 수 있는 것.
제목을 명확하게, 위치를 일관되게.

## 4. 작은 것부터 (Start small)
완벽한 SOP를 만들려고 하지 마라.
한 문단짜리 메모가 아무것도 없는 것보다 100배 낫다.

## 5. 주기적으로 돌아봐라 (Revisit)
적었으면 끝이 아니다. 한 달에 한 번,
"이거 아직 맞나?" 한 번만 확인하면 된다.
PRINEOF
        info "principles.md written in Korean"
      fi

      info "MEMORY.md initialized for ${TEAM_NAME}"

      # ── Workspace CLAUDE.md onboarding ──
      CLAUDE_WS_FILE="$WORKSPACE_DIR/CLAUDE.md"
      if [ -f "$CLAUDE_WS_FILE" ] && grep -q '{{TEAM_NAME}}' "$CLAUDE_WS_FILE" 2>/dev/null; then
        echo ""
        echo "  ${BOLD}Workspace CLAUDE.md wizard${NC} — customizes AI behavior for your workspace."
        echo "  (Press Enter to skip any question)"
        echo ""

        # Q1: Infrastructure type
        echo "  Infrastructure:"
        echo "    1) Local machine"
        echo "    2) Azure VM"
        echo "    3) AWS / GCP / other cloud"
        echo "    4) Skip (add later)"
        read -p "  Choice (1-4, default 4): " -n 1 -r INFRA_CHOICE || true
        echo
        INFRA_CHOICE="${INFRA_CHOICE:-4}"

        # Q2: Client projects
        read -p "  Use projects/ for per-client work? (y/N) " -n 1 -r USE_PROJECTS || true
        echo
        USE_PROJECTS="${USE_PROJECTS:-n}"

        # Build infra section
        INFRA_SECTION=""
        if [[ "$INFRA_CHOICE" == "2" ]]; then
          if [[ "$LANG_CHOICE" == "2" ]]; then
            INFRA_SECTION="
## Azure VM Environment

This workspace runs on an Azure VM.

- **VM Management Guide**: \`azurevm/README.md\` (create if needed)
- **Auth**: System Managed Identity (\`az login --identity\`)
- **Warning**: VM state changes (start/stop/resize) should be logged to \`azurevm/critical_change.md\`
"
          else
            INFRA_SECTION="
## Azure VM 환경

이 워크스페이스는 Azure VM에서 운영된다.

- **VM 관리 가이드**: \`azurevm/README.md\` (필요 시 생성)
- **인증**: System Managed Identity (\`az login --identity\`)
- **주의**: VM 상태 변경(시작/중지/리사이즈)은 \`azurevm/critical_change.md\`에 기록할 것
"
          fi
        elif [[ "$INFRA_CHOICE" == "3" ]]; then
          if [[ "$LANG_CHOICE" == "2" ]]; then
            INFRA_SECTION="
## Cloud Environment

This workspace runs on a cloud instance.

- **Access guide**: \`docs/cloud-setup.md\` (create if needed)
- **Resources**: document in \`docs/\` for team reference
"
          else
            INFRA_SECTION="
## 클라우드 환경

이 워크스페이스는 클라우드 인스턴스에서 운영된다.

- **접속 가이드**: \`docs/cloud-setup.md\` (필요 시 생성)
- **리소스 목록**: \`docs/\`에 문서화하여 팀 참고
"
          fi
        fi

        # Build projects section
        PROJECTS_SECTION=""
        if [[ "$USE_PROJECTS" =~ ^[Yy]$ ]]; then
          mkdir -p "$WORKSPACE_DIR/projects"
          if [[ "$LANG_CHOICE" == "2" ]]; then
            PROJECTS_SECTION="
## Projects (projects/)

Per-client or per-project outputs live here.

| Folder | Description |
|--------|-------------|
| (add as needed) | |

When creating project outputs:
- Work inside the relevant project folder
- Name files clearly: \`2026-03-marketing-analysis.md\` not \`report_final_v2.md\`
"
          else
            PROJECTS_SECTION="
## 프로젝트 작업 (projects/)

\`projects/\` 안의 하위 폴더는 개별 클라이언트나 프로젝트의 산출물이다.

| 폴더 | 설명 |
|------|------|
| (필요에 따라 추가) | |

프로젝트 산출물을 만들 때:
- 해당 프로젝트 폴더 안에서 작업
- 최종 산출물 이름은 명확하게 (\`보고서_v1.md\` ✗ → \`2026-03-마케팅-분석-보고서.md\` ✓)
"
          fi
        fi

        # Generate CLAUDE.md based on language choice
        if [[ "$LANG_CHOICE" == "2" ]]; then
          # ── English CLAUDE.md ──
          cat > "$CLAUDE_WS_FILE" <<CLAUDEEOF
# ${TEAM_NAME} — Workspace

This directory is the **team brain** — decisions, docs, memos, and project outputs.
It is *not* a code project. For code-specific rules, see each repo's own CLAUDE.md.

## Role of This Directory

| This workspace | Code project CLAUDE.md |
|---|---|
| Team collaboration rules, doc structure, AI behavior | Build/dev rules for that specific codebase |

## Directory Structure

\`\`\`
workspace/
├── CLAUDE.md              # ← This file (AI behavior + workspace guide)
├── principles.md          # Team principles
├── memory/MEMORY.md       # Team context (current priorities, structure, rhythm)
├── decisions/             # Decision records (immutable — never delete/modify)
├── docs/                  # Process docs, guides, SOPs
├── notes/                 # Temporary memos, ideas$(if [[ "$USE_PROJECTS" =~ ^[Yy]$ ]]; then echo "
└── projects/              # Per-client/project outputs"; else echo ""; fi)
\`\`\`

## Agent Behavior Rules

### On Session Start

1. **Read \`memory/MEMORY.md\`** — understand team status and priorities
2. **Know \`principles.md\`** — especially "Write it down" and "Record the why"
3. **Search \`decisions/\` and \`docs/\`** before starting any task — check for prior art

### While Working

- **Decisions → suggest recording**: "Want to record this in \`decisions/\`?"
- **File naming**: decisions → \`YYYY-MM-DD-title.md\`, notes → \`YYYY-MM-DD.md\`
- **\`decisions/\` files are immutable.** To change a decision, create a new file.
- **Tasks under 15 min: just do them.** The task system is for 30+ min work.

### When Writing Docs

- Markdown. Specific titles ("Apply API cache" ✓, "Performance improvements" ✗)
- Always include the **why**: "We went with A over B because X."
- Assume the reader is smart but not a developer — explain jargon inline.

## Communication Style

When explaining technical decisions or architecture:
- Plain language, everyday analogies
- Simplest explanation first, detail only if asked
- If a technical term is necessary, explain it in one sentence right after
${INFRA_SECTION}${PROJECTS_SECTION}
## Cleanup Rhythm

| Frequency | Action |
|---|---|
| **Weekly** | Scan \`notes/\` → promote anything important to \`decisions/\` or \`docs/\` |
| **Monthly** | Review \`docs/\` — still accurate? |
| **Quarterly** | Update \`memory/MEMORY.md\` — reprioritize |

## Warnings

- **Never commit \`.env\`, credentials, or secret files** (check \`.gitignore\`)
- **Never delete or modify files in \`decisions/\`** — create a new file instead
- When modifying this CLAUDE.md, note the reason in \`decisions/\`
CLAUDEEOF

        else
          # ── Korean CLAUDE.md ──
          cat > "$CLAUDE_WS_FILE" <<CLAUDEEOF
# ${TEAM_NAME} — Workspace

팀의 공유 작업 공간. 결정, 문서, 메모, 프로젝트 산출물이 모인다.
코드 프로젝트가 아니다. 코드 빌드/개발 규칙은 각 프로젝트의 CLAUDE.md 참고.

## 이 디렉토리의 역할

| 이 workspace | 코드 프로젝트 CLAUDE.md |
|---|---|
| 팀 협업 규칙, 문서 체계, AI 행동 규칙 | 해당 코드베이스의 빌드/개발 규칙 |

## 디렉토리 구조

\`\`\`
workspace/
├── CLAUDE.md              # ← 이 파일 (AI 행동 규칙 + 워크스페이스 가이드)
├── principles.md          # 팀 원칙
├── memory/MEMORY.md       # 팀 컨텍스트 (현재 우선순위, 구조, 리듬)
├── decisions/             # 결정 기록 (불변 — 절대 삭제/수정 금지)
├── docs/                  # 정리된 문서 (프로세스, 가이드, SOP)
├── notes/                 # 임시 메모, 아이디어$(if [[ "$USE_PROJECTS" =~ ^[Yy]$ ]]; then echo "
└── projects/              # 프로젝트별 산출물"; else echo ""; fi)
\`\`\`

## 에이전트 행동 규칙

### 세션 시작 시

1. **\`memory/MEMORY.md\` 읽기** — 팀 현황, 우선순위, 구조 파악
2. **\`principles.md\` 인식** — 특히 "써라", "왜를 남겨라"
3. 태스크에 관련된 기존 문서가 있는지 \`decisions/\`와 \`docs/\`를 먼저 검색

### 작업 중

- **결정을 내렸으면 기록을 제안하라**: "이 결정을 \`decisions/\`에 기록할까요?"
- **파일명 규칙**: decisions → \`YYYY-MM-DD-제목.md\`, notes → \`YYYY-MM-DD.md\`
- **\`decisions/\` 파일은 절대 삭제·수정하지 않는다.** 변경이 필요하면 새 파일을 만든다.
- **15분 안에 끝나는 일은 태스크로 만들지 말고 직접 해라.** 태스크 시스템의 가치는 30분+ 작업에서 나온다.

### 문서 작성 시

- 마크다운 기본. 한국어 우선, 기술 용어는 영어 혼용 가능.
- 제목은 **구체적으로** ("API 캐시 적용" ✓, "성능 개선" ✗)
- 이유(Why)를 반드시 포함: "A로 했다" → "B도 있었지만 A로 갔다. 이유는 X."
- 읽는 사람이 개발자가 아닐 수 있다. 전문 용어 쓰면 바로 다음에 한 문장 설명.

## 커뮤니케이션 스타일

기술적 결정이나 아키텍처를 설명할 때:
- 일상 비유를 쓰고, 전문 용어를 피한다
- 가장 단순한 설명부터 시작, 디테일은 요청받으면 추가
- 기술 용어가 필요하면 바로 다음에 한 문장으로 설명
${INFRA_SECTION}${PROJECTS_SECTION}
## 정리 리듬

| 주기 | 행동 |
|------|------|
| **주 1회** | \`notes/\` 훑기 → 중요한 건 \`decisions/\` 또는 \`docs/\`로 승격 |
| **월 1회** | \`docs/\` 훑기 → "이거 아직 맞나?" 확인 |
| **분기 1회** | \`memory/MEMORY.md\` 업데이트 → 우선순위 점검 |

## 주의사항

- **\`.env\`, 인증 정보, 시크릿 파일은 절대 커밋하지 않는다** (\`.gitignore\` 확인)
- **\`decisions/\` 파일은 절대 삭제·수정 금지** — 변경이 필요하면 새 파일 생성
- 이 CLAUDE.md를 수정할 때는 \`decisions/\`에 변경 이유를 남길 것
CLAUDEEOF

        fi

        info "CLAUDE.md generated for ${TEAM_NAME}"
        echo "  → $CLAUDE_WS_FILE"
        echo "  → Annotated reference: $(dirname "$0")/sample_claude.md"
      fi

    fi

  else
    warn "Skipped workspace setup"
  fi
fi

# ───────────────────────────────────
# Step 5: Publishing Hub (optional)
# ───────────────────────────────────
step "Step 5/7: Publishing Hub"

# Only offer if: workspace exists, nginx available, Linux
if [ -d "$WORKSPACE_DIR" ] && command -v nginx &>/dev/null && [[ "$OSTYPE" == "linux"* ]]; then
  if [ -f "$WORKSPACE_DIR/published/apps/hub/server.js" ] && systemctl is-active pub-hub.service &>/dev/null; then
    info "Publishing Hub already installed and running"
  else
    echo "  Publishing Hub provides:"
    echo "    - Web dashboard for managing published apps/sites"
    echo "    - Auto-generated nginx config + systemd services"
    echo "    - One-click deploy/stop/restart for apps"
    echo ""
    read -p "  Install Publishing Hub? (y/N) " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Yy]$ ]]; then
      # Copy template files (don't overwrite existing)
      PUB_DIR="$WORKSPACE_DIR/published"
      mkdir -p "$PUB_DIR/apps/hub" "$PUB_DIR/sites"

      if [ ! -f "$PUB_DIR/apps/hub/server.js" ]; then
        cp "$SCRIPT_DIR/templates/workspace/published/apps/hub/server.js" "$PUB_DIR/apps/hub/server.js"
        info "Hub server.js installed"
      else
        info "Hub server.js already exists (keeping)"
      fi

      if [ ! -f "$PUB_DIR/manifest.json" ]; then
        # Fresh manifest — fill in dynamic values
        MANIFEST_TEMPLATE="$SCRIPT_DIR/templates/workspace/published/manifest.json"
        cp "$MANIFEST_TEMPLATE" "$PUB_DIR/manifest.json"
        NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
        sed_inplace "s|\"updated_at\": \"\"|\"updated_at\": \"$NOW\"|" "$PUB_DIR/manifest.json"
        sed_inplace "s|\"working_dir\": \"\"|\"working_dir\": \"$PUB_DIR/apps/hub\"|" "$PUB_DIR/manifest.json"
        sed_inplace "s|\"created_at\": \"\"|\"created_at\": \"$NOW\"|" "$PUB_DIR/manifest.json"
        info "manifest.json created"
      else
        info "manifest.json already exists (keeping)"
      fi

      # Domain setup
      echo ""
      read -p "  Domain for nginx (e.g. desk.myteam.com, leave blank to skip nginx): " -r HUB_DOMAIN || true
      echo

      if [ -n "$HUB_DOMAIN" ]; then
        sed_inplace "s|\"domain\": \"\"|\"domain\": \"$HUB_DOMAIN\"|" "$PUB_DIR/manifest.json"

        # Generate minimal nginx config (Hub + Tower only, Hub will manage the rest)
        NGINX_CONF="/etc/nginx/sites-available/$HUB_DOMAIN"
        if [ ! -f "$NGINX_CONF" ]; then
          sudo tee "$NGINX_CONF" > /dev/null <<NGINXEOF
# $HUB_DOMAIN — Bootstrap config (Publishing Hub will manage this)
server {
    listen 80;
    server_name $HUB_DOMAIN;

    # Auth subrequest (Tower JWT check)
    location = /internal/auth {
        internal;
        proxy_pass http://localhost:32355/api/auth/check;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Authorization \$http_authorization;
    }

    # Publishing Hub (login required)
    location /hub/ {
        auth_request /internal/auth;
        error_page 401 = @hub_unauthorized;
        proxy_pass http://127.0.0.1:32400/hub/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
    location @hub_unauthorized {
        return 302 /?login=required;
    }

    # Static Sites
    location /sites/ {
        alias $PUB_DIR/sites/;
        autoindex on;
        index index.html;
    }

    # Tower (default)
    location / {
        proxy_pass http://localhost:32354;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINXEOF
          sudo ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$HUB_DOMAIN" 2>/dev/null || true
          sudo nginx -t && sudo nginx -s reload
          info "nginx configured for $HUB_DOMAIN"
        else
          info "nginx config already exists for $HUB_DOMAIN (keeping)"
        fi
      else
        warn "Skipped nginx setup — Hub accessible only via localhost:32400"
      fi

      # Install systemd service
      SVC_NAME="pub-hub.service"
      if ! systemctl cat "$SVC_NAME" &>/dev/null; then
        sudo tee "/etc/systemd/system/$SVC_NAME" > /dev/null <<SVCEOF
[Unit]
Description=Publishing Hub
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$PUB_DIR/apps/hub
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SVCEOF
        sudo systemctl daemon-reload
        sudo systemctl enable "$SVC_NAME"
        sudo systemctl start "$SVC_NAME"
        info "pub-hub.service installed and started"
      else
        info "pub-hub.service already exists"
        # Ensure it's running
        if ! systemctl is-active "$SVC_NAME" &>/dev/null; then
          sudo systemctl start "$SVC_NAME"
          info "pub-hub.service started"
        fi
      fi

      # Wait for Hub to come up, then sync
      sleep 2
      if curl -s http://127.0.0.1:32400/hub/api/manifest &>/dev/null; then
        info "Publishing Hub is running"
        # Sync: installs remaining services + regenerates nginx from manifest
        SYNC_RESULT=$(curl -s -X POST http://127.0.0.1:32400/hub/api/sync 2>/dev/null)
        if echo "$SYNC_RESULT" | grep -q '"ok":true'; then
          info "Infrastructure synced via Hub API"
        else
          warn "Hub sync returned unexpected result — check /hub/ dashboard"
        fi
      else
        warn "Hub not responding on :32400 — check: journalctl -u pub-hub.service"
      fi

      # Workspace settings.json with PreToolUse hooks (if not exists)
      WS_SETTINGS="$WORKSPACE_DIR/.claude/settings.json"
      if [ ! -f "$WS_SETTINGS" ]; then
        mkdir -p "$WORKSPACE_DIR/.claude"
        cat > "$WS_SETTINGS" <<'SETTINGSEOF'
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "CMD=\"$CLAUDE_TOOL_INPUT_command\"; if echo \"$CMD\" | grep -qE '(cp|mv|vi|vim|nano|tee).*sites-(available|enabled)'; then echo '⚠️  nginx config는 Publishing Hub가 자동 관리합니다.' && echo '→ curl -X POST http://127.0.0.1:32400/hub/api/sync' && exit 1; fi; if echo \"$CMD\" | grep -qE 'systemctl.*(start|stop|restart|enable|disable).*pub-'; then if echo \"$CMD\" | grep -q 'pub-hub'; then exit 0; fi; echo '⚠️  pub-* 서비스는 Publishing Hub API로 관리하세요.' && echo '→ curl -X POST http://127.0.0.1:32400/hub/api/apps/{name}/start' && exit 1; fi"
          }
        ]
      },
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "FILE=\"$CLAUDE_TOOL_INPUT_file_path\"; if echo \"$FILE\" | grep -qE 'sites-(available|enabled)/'; then echo '🚫 nginx config는 Publishing Hub가 자동 생성합니다.' && exit 1; fi"
          }
        ]
      }
    ]
  }
}
SETTINGSEOF
        info "Workspace hooks installed (.claude/settings.json)"
      else
        info "Workspace hooks already exist (keeping)"
      fi

      echo ""
      info "Publishing Hub setup complete!"
      echo "  Dashboard: http://localhost:32400/hub/"
      if [ -n "$HUB_DOMAIN" ]; then
        echo "  Public:    https://$HUB_DOMAIN/hub/ (after TLS setup)"
      fi

    else
      warn "Skipped Publishing Hub"
    fi
  fi
else
  if [ ! -d "$WORKSPACE_DIR" ]; then
    warn "Skipping Publishing Hub — workspace not set up"
    echo ""
    echo "  Publishing Hub는 workspace 위에서 동작합니다."
    echo "  Step 4에서 workspace를 먼저 세팅한 뒤, setup.sh를 다시 실행하세요."
    echo ""
  elif ! command -v nginx &>/dev/null; then
    warn "Skipping Publishing Hub — nginx not installed"
    echo ""
    echo "  Publishing Hub는 nginx + systemd 기반으로 앱/사이트를 관리합니다."
    echo "  설치 후 setup.sh를 다시 실행하면 이 단계가 활성화됩니다:"
    echo ""
    echo "    ${BOLD}sudo apt install -y nginx${NC}"
    echo "    ${BOLD}bash setup.sh${NC}                # 기존 설정은 유지되고 Hub만 추가됩니다"
    echo ""
  elif [[ "$OSTYPE" != "linux"* ]]; then
    warn "Skipping Publishing Hub — Linux (systemd) 환경에서만 지원"
    echo ""
    echo "  Publishing Hub는 systemd 서비스 관리 + nginx 자동 설정을 포함합니다."
    echo "  macOS에서는 수동으로 Hub 서버를 실행할 수 있습니다:"
    echo ""
    echo "    ${BOLD}cd ~/workspace/published/apps/hub && node server.js${NC}"
    echo "    → http://localhost:32400/hub/"
    echo ""
  fi
fi

# ───────────────────────────────────
# Step 6: Claude Skills
# ───────────────────────────────────
step "Step 6/7: Claude skills & hooks"

CLAUDE_DIR="$HOME/.claude"

# Ensure ~/.claude exists (Claude CLI creates it on first run, but we need it now for skills)
if command -v claude &>/dev/null && [ ! -d "$CLAUDE_DIR" ]; then
  mkdir -p "$CLAUDE_DIR"
  info "Created $CLAUDE_DIR"
fi

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

    # CLI history import (tower-sync)
    echo ""
    read -p "  Import existing CLI history to tower.db? (Y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      if [ -f "$HOME/.claude/hooks/memory/cli-import.mjs" ]; then
        node "$HOME/.claude/hooks/memory/cli-import.mjs"
      else
        warn "cli-import.mjs not found — run memory-hooks/install.sh first"
      fi
    fi
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
step "Step 7/7: Setup complete!"

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
echo "  ${BOLD}Publishing Hub:${NC}"
echo "    http://localhost:32400/hub/    Dashboard"
echo "    curl -X POST http://127.0.0.1:32400/hub/api/sync"
echo ""
echo "  ${BOLD}Optional:${NC}"
echo "    cloudflared tunnel --url http://localhost:32354"
echo "    → Expose to internet via Cloudflare tunnel"
echo ""

echo "  For more info: see README.md"
echo ""
