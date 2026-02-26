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
