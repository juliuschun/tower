# Tower

**Your team's AI work layer.**

For the first time, see not just what your team produced — but how it happened.

[**한국어 README**](README.ko.md)

---

## The Big Picture

Every day, your team produces work. Code gets written, decisions get made, documents get created, problems get solved.

But where does all that actually *happen*? In scattered terminals. In Slack threads. In someone's head. In a Claude session that closes at the end of the day and disappears.

**Tower changes that.**

When all AI-assisted work flows through one place — sessions recorded, decisions logged, file changes committed with attribution, memory persisting across users and time — something new becomes possible:

You can actually see *how* your company works. Not just what it produced.

---

## Why This Matters

Most tools capture **outputs**:

| Tool | Captures |
|------|----------|
| Jira | Ticket status |
| GitHub | Final code |
| Slack | Message fragments |
| Notion | Polished documents |
| **Tower** | **The process that created all of it** |

None of them capture how work actually happens — the reasoning, the trade-offs, the back-and-forth that led to the decision.

Tower captures the process.

When your team routes their AI work through Tower, you get a living record of:
- **What** was decided — and **why** (the Claude conversation is right there)
- **Who** did what — git commits tagged by user and session
- **What's happening right now** — active sessions with real-time visibility
- **What the team has learned** — persisted in shared memory that makes Claude smarter for everyone

---

## The Problem With Claude Code (Not Claude's Fault)

Claude Code is freakishly powerful. But let's be honest:

**It's a terminal app.** Your project managers, designers, analysts, and clients aren't going to learn the CLI. They just won't.

**It lives on one machine.** Your carefully configured skills, CLAUDE.md, workspace context — all locked to one device.

**It needs an expert.** Without proper setup, you're using maybe 20% of what Claude Code can do. Most teams never get there.

**And it doesn't share.** Sessions disappear. Context resets. What one person learns, nobody else benefits from.

Tower fixes all of this — and adds something more.

---

## How It Works

```
Team member opens browser
      ↓
Works with Claude (code, docs, decisions, research...)
      ↓
Everything flows through Tower
      ↓
Sessions recorded · Files committed · Memory updated · Context shared
      ↓
Next session starts smarter.
Next team member starts with context.
Next decision builds on the last.
```

The longer your team uses Tower, the more it knows. The more it knows, the better it performs. **It's a flywheel.**

---

## What You Get

### 🌐 Browser Access
Anyone on your team — developer, designer, PM, analyst — can use the full power of Claude Code without a terminal. Role-based permissions mean admins get full access, regular users get guardrails.

### 🧠 3-Layer Team Memory

1. **Auto memory** — Claude's native MEMORY.md, loaded every conversation
2. **Workspace memory** — Shared decisions and learnings, persisted across the team
3. **Activity hooks** — Automatic logging of edits, commands, and sessions with full-text search

What one person learns becomes what Claude knows for everyone.

### 👁 Work Visibility
- See active sessions across your team in real-time
- Every file change committed with user + session attribution
- Decision records in `decisions/` — the *why* behind the *what*
- Session history that doesn't disappear when someone closes their browser

### 📋 20 Bundled Skills
Brainstorming, TDD, debugging, code review, planning, UI/UX design — pre-configured and ready. Your team starts at 80%, not 20%.

### 🔒 Role-Based Access
- **Admins**: full workspace access, `bypassPermissions` mode
- **Users**: restricted to their `allowed_path`, `acceptEdits` mode
- **File sharing**: internal (team) or external (expiring public links)

### 🔧 Git Integration
Auto-commit on every Claude edit. Every change is tracked, attributed, and reversible. Roll back to any point in history.

---

## The Flywheel

```
Day 1:    Team starts using Tower
Week 1:   Claude learns team conventions, decisions begin accumulating
Month 1:  New hire onboards → Claude already knows the project context
Month 3:  "Why did we build it this way?" → Open the session, it's right there
Month 6:  Team is faster. Claude is smarter. Work is visible.
Year 1:   Institutional memory that doesn't walk out the door.
```

---

## Get Started

```bash
git clone https://github.com/juliuschun/tower.git
cd tower
bash setup.sh    # installs everything, asks you a few questions
npm run dev      # → http://localhost:32354
```

See **[INSTALL.md](INSTALL.md)** for detailed setup, environment variables, project structure, and deployment options.

---

## What's Included

| | |
|---|---|
| **20 AI Skills** | Brainstorming, TDD, debugging, code review, planning, UI/UX design, and more. See [`claude-skills/README.md`](claude-skills/README.md). |
| **3-Layer Memory** | Auto memory + workspace memory + session hooks. Claude remembers across sessions. See [`memory-hooks/README.md`](memory-hooks/README.md). |
| **Workspace Templates** | Team principles, decision records, shared docs — bootstrapped by `setup.sh`. |
| **File Editor** | CodeMirror with syntax highlighting, real-time file tree, drag & drop upload. |
| **Git Integration** | Auto-commit on Claude edits, commit history, diff viewer, rollback. |
| **Admin Panel** | User management, role-based permissions, per-user workspace restrictions. |
| **Mobile** | Responsive layout with bottom tab bar. PWA support. |

---

## Demo

### Chat with Claude Code — in the browser

<p align="center">
  <video src="capture.mp4" width="720" controls></video>
</p>

### Build and share dashboards — on the fly

<p align="center">
  <video src="capture2.mp4" width="720" controls></video>
</p>

---

## Screenshots

<p align="center">
  <img src="docs/screenshots/login.png" alt="Login" width="720" />
</p>
<p align="center">
  <img src="docs/screenshots/main.png" alt="Main — Sessions + Chat + File Editor" width="720" />
</p>
<p align="center">
  <img src="docs/screenshots/files.png" alt="File Explorer" width="720" />
</p>
<p align="center">
  <img src="docs/screenshots/mobile.png" alt="Mobile" width="280" />
</p>

---

> Fair warning: this has bugs. It will be updated at will. But it works, and we use it every day.

---

## License

Licensed under the [Apache License 2.0](LICENSE).
