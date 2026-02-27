# Installation Guide

## Prerequisites

- **Node.js** 20+
- **Claude Code CLI** installed and authenticated (`claude --version`)
- **Anthropic API** key (Max plan or API key)

## One-Step Setup

```bash
git clone https://github.com/juliuschun/tower.git
cd tower
bash setup.sh
```

The setup wizard walks you through everything:
1. Check prerequisites (Node.js, Claude CLI)
2. Install npm dependencies
3. Create `.env` from `.env.example`
4. Initialize your workspace directory
5. Install Claude skills and memory hooks

## Manual Setup

If you prefer to do it step by step:

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum, change JWT_SECRET

# 3. Initialize workspace (optional)
# Copy templates/workspace/ to your workspace directory

# 4. Install Claude skills (optional, requires Claude Code CLI)
./install-skills.sh

# 5. Install memory hooks (optional, requires Claude Code CLI)
bash memory-hooks/install.sh
```

## Run

```bash
# Development (hot reload)
npm run dev
# → Frontend: http://localhost:32354 (Vite HMR)
# → Backend: :32355 (tsx watch, auto-restart)

# Production
npm run build
./start.sh start
```

## First Login

1. Open `http://localhost:32354`
2. Create your **admin account** on first visit
3. Add team members via the admin panel (shield icon in header)

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

---

## User Roles

| Role | Claude Permissions | File Access | Admin Panel |
|------|-------------------|-------------|-------------|
| `admin` | `bypassPermissions` | Full | Yes |
| `user` | `acceptEdits` | `allowed_path` only | No |

---

## Project Structure

```
tower/
├── backend/
│   ├── index.ts                 # Express + WebSocket server
│   ├── config.ts                # Environment config
│   ├── db/schema.ts             # SQLite schema + migrations
│   ├── routes/
│   │   ├── api.ts               # REST API
│   │   ├── ws-handler.ts        # WebSocket handler
│   │   └── session-guards.ts    # Concurrent session mgmt
│   └── services/
│       ├── auth.ts              # Auth + user management
│       ├── claude-sdk.ts        # Claude Agent SDK wrapper
│       ├── session-manager.ts   # Session CRUD
│       ├── message-store.ts     # Message persistence
│       ├── file-system.ts       # File tree, read/write
│       ├── git-manager.ts       # Git operations
│       └── ...
│
├── frontend/src/
│   ├── App.tsx                  # Main layout
│   ├── components/              # UI components
│   ├── hooks/                   # useClaudeChat, useWebSocket
│   ├── stores/                  # Zustand state management
│   └── utils/                   # Parsers, helpers
│
├── claude-skills/               # 20 bundled Claude skills
│   ├── skills/                  # Workflow, quality, domain skills
│   ├── commands/                # Slash commands (prime, gdrive, gmail)
│   └── agents/                  # Agent definitions
│
├── memory-hooks/                # 3-layer memory system
│   ├── install.sh               # One-step installer
│   └── src/                     # Hook scripts (SQLite FTS5)
│
├── templates/
│   └── workspace/               # Workspace template for new deployments
│
├── setup.sh                     # One-step setup wizard
├── start.sh                     # Production server management
├── .env.example                 # Environment variable template
├── ecosystem.config.cjs         # PM2 config
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
| **Other** | Chokidar (file watch), Mermaid (diagrams), PWA (vite-plugin-pwa) |

---

## Claude Skills & Hooks

Tower ships with **20 skills**, 3 commands, and 1 agent — all bundled.

Install with `./install-skills.sh` (included in `setup.sh`).
See [`claude-skills/README.md`](claude-skills/README.md) for the full list.

### Memory Hooks

A 3-layer memory system that gives Claude persistent memory across sessions:
1. **Auto Memory** — per-project patterns and learning
2. **Workspace Memory** — team decisions and processes
3. **Session Hooks** — SQLite FTS5 auto-capture of session activity

Install with `bash memory-hooks/install.sh` (included in `setup.sh`).
See [`memory-hooks/README.md`](memory-hooks/README.md) for details.

---

## Remote Access (Cloudflare Tunnel)

```bash
# Install cloudflared (one-time)
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

# Quick Tunnel (temporary URL, no account needed)
cloudflared tunnel --url http://localhost:32354
```

The output URL (`https://xxx.trycloudflare.com`) gives you HTTPS access from anywhere.

> Quick Tunnel URLs change on restart. For a permanent URL, use a [Named Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/).

---

## Server Management

```bash
./start.sh start     # Build + start with PM2
./start.sh stop      # Stop
./start.sh restart   # Rebuild + restart
./start.sh logs      # View logs
./start.sh status    # Check status
```

---

## Browser Automation (PinchTab MCP)

Tower ships with a built-in MCP server that lets Claude control a real browser via [PinchTab](https://github.com/pinchtab/pinchtab).

### Prerequisites

- **Chrome or Chromium** installed:
  ```bash
  # Ubuntu/Debian
  sudo apt install chromium-browser
  # or
  sudo apt install google-chrome-stable
  ```
- **PinchTab binary** placed at `data/pinchtab`:
  ```bash
  mkdir -p data/
  # Download from https://github.com/pinchtab/pinchtab/releases
  chmod +x data/pinchtab
  ```

### How It Works

```
Claude Code (MCP client)
    │  stdio
    ▼
mcp/pinchtab-server.ts      ← MCP 서버 (6 browser tools)
    │  HTTP
    ▼
data/pinchtab               ← Bridge binary (auto-spawned)
    │  CDP
    ▼
Chrome (headless)
```

The MCP server is registered in `.mcp.json` and loads automatically when Claude Code starts in this directory.

### Available Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL |
| `browser_text` | Get page text (~800 tokens, cheapest) |
| `browser_snapshot` | Accessibility tree (interactive elements + IDs) |
| `browser_action` | click / type / fill / scroll / hover / press |
| `browser_screenshot` | Visual screenshot (use sparingly) |
| `browser_evaluate` | Execute JavaScript |

**Token strategy:** Start with `browser_text`, use `browser_snapshot` for interaction, `browser_screenshot` only for visual confirmation.

### Configuration (.mcp.json)

```json
{
  "mcpServers": {
    "pinchtab": {
      "command": "npx",
      "args": ["tsx", "mcp/pinchtab-server.ts"],
      "env": {
        "CHROME_BINARY": "/usr/bin/chromium-browser",
        "BRIDGE_PROFILE": "/path/to/chrome-profile",
        "BRIDGE_HEADLESS": "true"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROME_BINARY` | auto-detect | Chrome binary path. Auto-detects `google-chrome` → `chromium-browser` → `chromium` |
| `BRIDGE_PROFILE` | (Chrome default) | Chrome user data directory |
| `BRIDGE_HEADLESS` | `true` | Run Chrome headless |
| `PINCHTAB_URL` | (none) | Connect to an already-running PinchTab instance instead of spawning |
| `PINCHTAB_BINARY` | `data/pinchtab` | Override binary path |
| `PINCHTAB_TOKEN` | (none) | Auth token for PinchTab bridge |

### Self-Healing

The manager automatically recovers from failures:

- **Process crash** — detected via `exit` event; next `fetch()` call triggers restart
- **Network failure** — health check on error; restarts if unhealthy
- **Port collision** — if port 9867 is already in use on startup, connects to that instance instead of spawning
- **Chrome not found** — clear error listing all candidates tried

Restart takes ~2–10 seconds. Claude sees a slightly slow response, not an error.

### Troubleshooting

```bash
# Check bridge health
curl http://localhost:9867/health

# Expected when healthy:
# {"cdp":"...","status":"ok","tabs":1}

# Expected when Chrome disconnected:
# {"status":"disconnected","error":"..."}
# → Restart Claude Code to respawn the bridge

# Test screenshot directly
curl -s http://localhost:9867/screenshot | python3 -c "
import sys, json, base64
d = json.load(sys.stdin)
print('format:', d['format'], '| size:', len(d['base64']), 'chars')
"

# Kill stale bridge (if needed)
pkill -f data/pinchtab
```

**"Could not process image" error** — The bridge returned JSON instead of an image (Chrome disconnected). Restart Claude Code to fix.

**Chrome binary not found** — Set `CHROME_BINARY` in `.mcp.json` env to the correct path.

**Port 9867 already in use** — The bridge will connect to the existing instance. If that instance is unhealthy, kill it: `pkill -f data/pinchtab`
