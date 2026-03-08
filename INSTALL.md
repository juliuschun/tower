# Installation Guide

## Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| **Ubuntu** | 22.04+ | `lsb_release -a` |
| **Node.js** | 20+ | `node -v` |
| **Git** | any | `git --version` |
| **Claude Code CLI** | latest | `claude --version` |
| **Anthropic API** | Max plan or API key | `claude auth status` |

> **Note**: `better-sqlite3` requires native build tools. On Ubuntu: `sudo apt install -y build-essential python3`

---

## Quick Start (3 commands)

```bash
git clone https://github.com/juliuschun/tower.git
cd tower
bash setup.sh
```

The setup wizard handles everything: dependencies, environment, workspace, skills, and memory hooks.

Then start:

```bash
npm run dev
# → Open http://localhost:32354
```

---

## Step-by-Step Setup

If you prefer to understand each step, or if `setup.sh` fails at any point:

### 1. System Prerequisites (Ubuntu)

```bash
# Node.js 20+ (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Build tools (needed for better-sqlite3 native compilation)
sudo apt install -y build-essential python3 git
```

### 2. Install Claude Code CLI

Claude Code is the AI engine that powers Tower. You need it installed and authenticated.

```bash
# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Verify installation
claude --version
```

> **What is Claude Code?** It's Anthropic's CLI tool that lets you talk to Claude with full access to your filesystem. Tower wraps it with a web UI so your whole team can use it from a browser.

### 3. Authenticate Claude (pick one)

| Method | Best for | Command |
|--------|----------|---------|
| **Browser login** | Max/Pro plan subscribers | `claude auth login` → copy URL to any browser |
| **API Key** | API key users, CI/CD | Set `ANTHROPIC_API_KEY` in `.env` |
| **Copy credentials** | Already authed on another machine | `scp` the credentials file |

#### Option A: Browser Login (Max/Pro plan)

```bash
claude auth login
# → Outputs a URL like: https://claude.ai/oauth/authorize?...
# → Copy that URL and open it in ANY browser (even on a different computer)
# → Complete the login → this machine is authenticated
```

> **Headless VM?** No browser needed on the server. The URL works from any browser anywhere. After you complete login in your browser, the CLI on this machine gets authenticated automatically.

#### Option B: API Key

```bash
# Add to your .env file:
echo "ANTHROPIC_API_KEY=sk-ant-your-key-here" >> .env
```

Get your key at: https://console.anthropic.com/settings/keys

#### Option C: Copy Credentials (from another authenticated machine)

```bash
# On the new machine:
mkdir -p ~/.claude
scp user@authed-machine:~/.claude/.credentials.json ~/.claude/.credentials.json
chmod 600 ~/.claude/.credentials.json

# Verify:
claude auth status
# → Should show: "loggedIn": true
```

This copies the OAuth tokens from a machine where Claude is already authenticated. Works instantly, no browser needed.

### 4. Clone & Install

```bash
git clone https://github.com/juliuschun/tower.git
cd tower
npm install
```

### 5. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` — at minimum, change `JWT_SECRET`:

```bash
# Auto-generate a secure secret
sed -i "s/change-me-to-a-random-secret/$(openssl rand -hex 32)/" .env
```

### 6. Initialize Workspace (optional)

```bash
# Copy workspace templates
mkdir -p ~/workspace
cp -r templates/workspace/* ~/workspace/
```

### 7. Install Skills & Hooks (optional, requires Claude CLI)

```bash
# Bundled Claude skills (20 skills, 3 commands, 1 agent)
./install-skills.sh

# Memory hooks (session tracking with SQLite FTS5)
bash memory-hooks/install.sh
```

### 8. Start

```bash
# Development (hot reload)
npm run dev
# → Frontend: http://localhost:32354 (Vite HMR)
# → Backend:  http://localhost:32355 (tsx watch, auto-restart)

# Production
npm install -g pm2    # one-time
npm run build
./start.sh start
```

---

## First Login

1. Open `http://localhost:32354` (or your domain)
2. **The first account you create becomes the admin.** There is no default password — you set it yourself.
3. Add team members via the admin panel (shield icon in header)

---

## Post-Setup Testing Checklist

After installation, walk through these steps to verify everything works:

### Step 1: Server Health

```bash
# Backend responds
curl -s http://localhost:32354/api/auth/status
# → {"authEnabled":true,"hasUsers":false}   (before first login)
# → {"authEnabled":true,"hasUsers":true}    (after first login)
```

### Step 2: Create Admin Account

Open `http://localhost:32354` in your browser. You'll see the login page.
- Enter a username and password (min 8 characters)
- Click "Sign in" → you're now the admin

### Step 3: Verify WebSocket Connection

After login, check the bottom-left status bar:
- **Green dot + "Ready"** = WebSocket connected, Claude CLI found
- **Red/orange dot** = Connection issue — check the backend logs

### Step 4: Send a Test Message

Type "hello" in the chat box and press Enter.
- Claude should respond within a few seconds
- If you see an error, check that Claude is authenticated: `claude auth status`

### Step 5: Check the File Tree

Click the **Files** tab in the left sidebar.
- You should see your workspace directory contents
- If empty, that's normal — workspace starts with just template files

### Step 6: Create a Project

Click the **hamburger menu (☰)** → look for project options.
- Create a new project (e.g., "test-project")
- Tower auto-creates `~/workspace/projects/test-project/` with a `CLAUDE.md` file
- New chats in this project will use that directory as working directory

### Step 7: Verify Git Auto-Commit

```bash
cd ~/workspace && git log --oneline -5
# → Should show "init: workspace initialized by Tower"
```

If git log shows commits, auto-commit is working. Claude's file edits will be committed automatically.

---

## How Tower Uses the File System

Understanding this prevents most confusion:

```
~/workspace/                    ← WORKSPACE_ROOT (file tree root, git repo)
├── projects/                   ← Auto-created when you make a project
│   ├── my-project/             ← Each project = a directory
│   │   ├── CLAUDE.md           ← Project-specific instructions (auto-created)
│   │   └── (Claude's files)    ← Claude reads/writes here
│   └── another-project/
│       └── CLAUDE.md
├── decisions/                  ← Team decision records (from setup.sh)
├── docs/                       ← Process documentation
├── notes/                      ← Temporary memos
├── memory/MEMORY.md            ← Team context for Claude
└── uploads/                    ← Chat file attachments (auto-created)
```

### Key concepts:

- **Workspace** (`WORKSPACE_ROOT`): The root directory users can browse in the Files tab. Tower initializes a git repo here on first start.
- **Projects**: Groupings of chat sessions. Each project has its own folder with a `CLAUDE.md` that Claude reads automatically.
- **CLAUDE.md**: Instructions file that Claude loads when working in a directory. Edit this to tell Claude about your project's conventions, tech stack, or rules.
- **CWD (Current Working Directory)**: Each chat session has a working directory where Claude reads/writes files. For project chats, this is the project folder. For standalone chats, it defaults to `DEFAULT_CWD`.
- **Git auto-commit**: Tower auto-commits Claude's file changes to the workspace git repo (configurable via `GIT_AUTO_COMMIT`).

### What happens when you create a new chat:

1. If created inside a **project** → CWD = project's root directory → Claude reads that project's `CLAUDE.md`
2. If created as a **standalone chat** → CWD = `DEFAULT_CWD` (usually `~/workspace`) → Claude reads workspace-level `CLAUDE.md`
3. Claude can read/write files relative to the CWD
4. File changes are auto-committed to git (if enabled)

### Codebase projects (advanced):

If your project is a code repo outside the workspace (e.g., `~/my-app/`):
- Create a project and set the **root path** to `~/my-app/`
- Tower points Claude's CWD there instead of workspace
- Claude reads `~/my-app/CLAUDE.md` if it exists

---

## Azure VM Deployment

If you're deploying to an Azure VM, there are extra steps:

### Open Port in Network Security Group

```bash
# Replace <RG> and <VM> with your resource group and VM name
az vm open-port \
  --resource-group <RG> \
  --name <VM> \
  --port 32354 \
  --priority 1010
```

### Optional: Custom Domain with Cloudflare

1. Point your domain's DNS A record to the VM's public IP
2. Enable Cloudflare Proxy (orange cloud) for SSL
3. Set `PUBLIC_URL=https://your-domain.com` in `.env`

### Optional: Cloudflare Quick Tunnel (temporary URL)

```bash
# Install cloudflared
curl -L --output /tmp/cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i /tmp/cloudflared.deb

# Start tunnel (gives you a temporary https URL)
cloudflared tunnel --url http://localhost:32354
```

---

## Environment Variables

Copy `.env.example` to `.env` and edit:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `32354` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `WORKSPACE_ROOT` | `$HOME/workspace` | Root directory for file browsing |
| `DEFAULT_CWD` | `$WORKSPACE_ROOT` | Default CWD for new sessions |
| `JWT_SECRET` | *(must change)* | JWT signing key |
| `NO_AUTH` | `false` | Set `true` to disable auth |
| `PERMISSION_MODE` | `bypassPermissions` | Claude permission level |
| `MAX_CONCURRENT_SESSIONS` | `10` | Max concurrent sessions |
| `GIT_AUTO_COMMIT` | `true` | Auto-commit Claude edits |
| `DB_PATH` | `data/tower.db` | SQLite database path |
| `CLAUDE_PATH` | *(auto-detect)* | Claude CLI path override |
| `PUBLIC_URL` | *(none)* | Canonical domain for share links |

---

## User Roles

| Role | Claude Permissions | File Access | Admin Panel |
|------|-------------------|-------------|-------------|
| `admin` | `bypassPermissions` | Full | Yes |
| `operator` | `bypassPermissions` | Full | No |
| `member` | `acceptEdits` | `allowed_path` only | No |
| `viewer` | `plan` (read-only) | `allowed_path` only | No |

---

## Server Management (Production)

```bash
./start.sh start     # Build + start with PM2
./start.sh stop      # Stop
./start.sh restart   # Rebuild + restart
./start.sh logs      # View logs (last 50 lines)
./start.sh status    # Check status
```

> **Warning**: Do NOT mix `npm run dev` and `./start.sh`. They use different ports and database paths. Pick one.

---

## Verify Installation

After starting, run these checks:

```bash
# 1. Backend health
curl -s http://localhost:32354/api/health

# 2. WebSocket upgrade
curl -s -i --http1.1 \
  -H "Upgrade: websocket" -H "Connection: Upgrade" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  http://localhost:32354/ws 2>&1 | head -3
# → Should return HTTP/1.1 101

# 3. Claude CLI accessible
claude --version
```

---

## Troubleshooting

### `npm install` fails on `better-sqlite3`

```bash
sudo apt install -y build-essential python3
npm install
```

### Port already in use

```bash
fuser -k 32354/tcp 32355/tcp
npm run dev
```

### Claude skills not loading

```bash
# Check skills are installed
ls ~/.claude/skills/*/SKILL.md

# Re-install if needed
./install-skills.sh
```

### PM2 not found (production mode)

```bash
npm install -g pm2
```

### File tree shows nothing / "Cannot read directory"

```bash
# Check workspace exists
ls ~/workspace/
# If missing, create it:
mkdir -p ~/workspace
# Restart the server — it will auto-initialize git
```

### Claude doesn't know about my project

Make sure your project has a `CLAUDE.md` file in its root directory:

```bash
ls ~/workspace/projects/my-project/CLAUDE.md
# If missing, create one:
echo "# My Project\n\nDescribe your project here." > ~/workspace/projects/my-project/CLAUDE.md
```

### "Claude not found" or sessions fail

```bash
# Check Claude CLI is installed and authenticated
claude --version
claude auth status
# If not authenticated:
claude auth login
# Or set API key in .env:
grep ANTHROPIC_API_KEY .env
```

---

## Project Structure

```
tower/
├── backend/          # Express + WebSocket server
├── frontend/src/     # React + Vite
├── claude-skills/    # 20 bundled skills
├── memory-hooks/     # 3-layer memory system
├── templates/        # Workspace templates
├── setup.sh          # One-step setup wizard
├── start.sh          # Production server management
├── .env.example      # Environment template
├── ecosystem.config.cjs  # PM2 configuration
└── package.json
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, Vite 6, Tailwind CSS 4, Zustand 5, CodeMirror |
| **Backend** | Express, WebSocket (ws), tsx watch |
| **AI** | `@anthropic-ai/claude-agent-sdk` (Claude Code SDK) |
| **DB** | SQLite (better-sqlite3), WAL mode |
| **Auth** | JWT (bcryptjs + jsonwebtoken) |
| **Process** | PM2 (production), concurrently (dev) |

---

## Browser Automation (PinchTab MCP) — Optional

Tower can optionally control a real browser via [PinchTab](https://github.com/pinchtab/pinchtab).

### Setup

```bash
# Install Chrome/Chromium
sudo apt install -y chromium-browser

# Download PinchTab binary
mkdir -p data/
# Download from https://github.com/pinchtab/pinchtab/releases
chmod +x data/pinchtab
```

### Configure `.mcp.json`

```json
{
  "mcpServers": {
    "pinchtab": {
      "command": "npx",
      "args": ["tsx", "mcp/pinchtab-server.ts"],
      "env": {
        "CHROME_BINARY": "/usr/bin/chromium-browser",
        "BRIDGE_HEADLESS": "true"
      }
    }
  }
}
```

Available tools: `browser_navigate`, `browser_text`, `browser_snapshot`, `browser_action`, `browser_screenshot`, `browser_evaluate`.
