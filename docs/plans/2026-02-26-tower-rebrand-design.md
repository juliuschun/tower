# Tower Rebrand Design

**Date:** 2026-02-26
**Scope:** Option B — Name + Visual Identity
**Status:** Approved

## Vision

> "항상 일하는 팀 AI 플랫폼. 한 명이 서버 하나로 회사 전체를 자동화한다."

One person. One server. Whole company automated.
Team members use it at any depth — the tower keeps working regardless.

## Brand

| Item | Value |
|------|-------|
| **Name** | Tower |
| **Tagline** | *"Stack your own tower of AI and systems."* |
| **Positioning** | AI command center for teams. Self-hosted, always-on. |

### Why "Tower"

- Control tower: one operator commands everything below
- Radio tower: always broadcasting, never sleeps
- You *build* it by stacking AI and systems — the name is the product

## Color System

| Token | Old | New |
|-------|-----|-----|
| Primary | `#7c3aed` (Claude purple) | `#f59e0b` (Amber) |
| Primary dark | `#6d28d9` | `#d97706` |
| Theme color (PWA/meta) | `#7c3aed` | `#d97706` |

**Rationale:** Amber = tower warning lights. Highly distinctive in a market saturated with blue/purple SaaS. Already used in favicon — ensures immediate consistency.

## Favicon

**Concept:** Minimalist radio/antenna tower silhouette on dark background.

```
    ·          ← antenna tip
   /|\         ← signal arcs (amber)
  / | \
 /  |  \       ← tower body
    |
   ═══          ← base
```

- 32×32 SVG
- Background: `#09090b` (existing dark)
- Tower fill: `#f59e0b` (Amber)
- Round corners: `rx="6"`

## Files Changed

| File | Change |
|------|--------|
| `frontend/index.html` | title → "Tower", theme-color → `#d97706` |
| `frontend/vite.config.ts` | PWA manifest: name, short_name, description, theme_color |
| `frontend/public/favicon.svg` | New tower silhouette SVG |
| `frontend/src/components/layout/Header.tsx` | "Claude Desk" → "Tower", icon color → amber |
| `frontend/src/components/auth/LoginPage.tsx` | "Claude Desk" → "Tower", add tagline |
| `package.json` | name: "claude-desk" → "tower" |
| `CLAUDE.md` | Project name → Tower |

## Out of Scope

- Directory rename (`claude-desk/` → `tower/`) — deferred to future PR
- Database filename change — no user-visible impact
- README / full docs rewrite — separate effort
- Feature changes — this is visual identity only
