# Tower

**The road to 100% AI-augmented corporation.**

🌐 [English](README.md) · [한국어](README.ko.md)

<p align="center">
  <img src="capture-chat.png" alt="Tower — every AI conversation, shared like Google Docs" width="720" />
</p>

The strongest organization is one where 100% of the team works with AI — not just developers, not just power users, everyone. The barrier has never been AI itself. It's the terminal, the CLI, the setup, the isolation. Tower removes that barrier.

Every conversation with AI, shared by the whole team like a Google Doc. One file system. One memory. One place where your entire company's AI work happens — visible, searchable, and building on itself.

*In production. $20K revenue in first 2 weeks.*

<p align="center">
  <img src="diagram-tower.png" alt="Tower — team members contribute, knowledge compounds, everyone benefits" width="560" />
</p>

---

## The Problem: AI Is Personal. Work Is Not.

ChatGPT. Claude Code. Copilot. They're all powerful — and they're all trapped on one person's screen.

- Conversations scatter across individual accounts
- What AI learns in one session dies when the session ends
- The same questions get asked over and over by different people
- Non-developers can't even get past the terminal

Even Claude Code — the most capable coding agent — lives in a single terminal. One person benefits. The team doesn't.

You can hand everyone an AI subscription. That doesn't make you an AI-augmented organization. It makes you a collection of individuals using AI alone.

---

## The Solution: Share AI Like Google Docs

### Shared Conversations

Every AI conversation is visible to the team. Who asked what. What AI answered. What decisions were made. Organized by project — your company's AI work at a glance.

No more "what did Claude say about that?" — just look.

### One File System, One Memory

One server. One shared file system. One memory that persists across people and time.

What one person teaches AI on Monday, a new hire uses on Friday. Three layers of memory — session, project, and team — so nothing learned is ever lost.

Version control happens automatically. Every change is committed, browsable, and rollbackable. It looks and feels like file management — not Git. **Zero CLI knowledge required.**

### Partitioned by Team

Marketing doesn't see engineering's code. Engineering doesn't see HR's documents. But when they need to collaborate, the walls come down.

Projects, departments, teams, individuals — partition however your organization works. Five permission levels (admin → viewer) with folder-level isolation.

```
workspace/
├── projects/
│   ├── marketing-site/
│   │   └── CLAUDE.md    ← "Brand voice is casual. Use Next.js."
│   ├── api-backend/
│   │   └── CLAUDE.md    ← "Use Go. Follow company style guide."
│   └── onboarding-docs/
│       └── CLAUDE.md    ← "Write for non-technical readers."
└── memory/MEMORY.md      ← Shared context across all projects
```

---

## Run Any Code. No CLI Needed.

<p align="center">
  <img src="diagram-access.png" alt="Tower — messages from any device become real work" width="640" />
</p>

Tower runs on your server. AI doesn't just chat — it executes. Write code, create files, deploy apps, run analyses. The full power of a development environment, accessible through a browser.

Your marketing lead can ask AI to build a landing page. Your ops manager can automate a report. Your intern can run a data analysis. None of them need to know what a terminal is.

---

## Skills Create Skills

When AI works with your whole team — connected to one file system and one shared memory — something compounds.

A one-off task becomes a reusable skill. That skill creates another skill. Your team's AI gets better every day, automatically.

**Example:** Someone creates a quote generator → it spawns a proposal skill → which evolves into a contract skill. Each one built on the last, available to everyone.

20+ skills ship out of the box: brainstorming, debugging, code review, planning, UI/UX design, research, document generation. Your team starts at 80% and climbs from there.

---

## And Also

<p align="center">
  <img src="capture-board.png" alt="Tower — Agent Board with autonomous task execution" width="720" />
</p>

**Agent Board** — Create a task. AI executes it. Tasks create tasks. "Plan our product launch" spawns market research, competitor analysis, pricing, and timeline — each running autonomously. Schedule recurring tasks. Your weekly reports write themselves.

<p align="center">
  <img src="capture-publish.png" alt="Tower — Publishing Hub" width="720" />
</p>

**Publishing Hub** — Turn any AI-generated artifact into a live site or app. One click. Your server. No vendor lock-in.

**Mobile** — Responsive browser UI. Works from your phone with full server compute behind it.

**File Sharing** — Internal team sharing + time-limited external links. No separate file sharing service needed.

**Search Everything** — Files, conversations, tasks, Git history. Full-text search across your entire AI workspace.

---

## Get Started

```bash
git clone https://github.com/your-org/tower.git
cd tower
bash setup.sh    # installs everything, asks you a few questions
npm run dev      # → http://localhost:32354
```

See **[INSTALL.md](INSTALL.md)** for details.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18 · TypeScript · Vite 6 · Zustand · Tailwind CSS 4 |
| **Backend** | Express · TypeScript · WebSocket · SQLite (WAL + FTS5) |
| **AI Engine** | Multi-engine: Claude Agent SDK + Pi Agent SDK · OpenRouter · MCP protocol · 20+ skills |
| **Auth** | JWT · bcrypt · Role-based (admin / owner / member / guest) |

---

## Multi-Engine AI

Tower isn't locked to one AI provider. The Engine abstraction layer lets you run multiple AI backends side by side:

| Engine | Provider | Billing | Models |
|--------|----------|---------|--------|
| **Claude Code** | Anthropic Agent SDK | Max subscription ($200/mo) | Opus, Sonnet, Haiku |
| **Pi Agent** | Pi SDK via OpenRouter | Pay-per-token | Any OpenRouter model: Claude, GPT, Gemini, Grok, Kimi, MiniMax... |

Switch models mid-conversation. Compare outputs across providers. Start with Claude Max, add OpenRouter models when you need them. Remove either engine by deleting one file.

Configure available models in `backend/engines/pi-models.json` — no code changes needed.

---

## Status: Research Alpha

We use this every day in production. It works — and it's not finished.

Some features are still rough around the edges. New capabilities are being designed and shipped continuously. Full workspace partitioning, user sandboxing, and enterprise-grade isolation are coming.

This is an active research project building toward a clear destination: **100% AI-augmented teams.**

Feedback and contributions are welcome — [open an issue](https://github.com/your-org/tower/issues) or submit a PR.

## License

[Apache License 2.0](LICENSE)
