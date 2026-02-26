# Tower Rebrand Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebrand "Claude Desk" → "Tower" with amber visual identity across all user-facing surfaces.

**Architecture:** Pure find-and-replace + CSS palette swap. No backend changes. No new dependencies. TailwindCSS v4's `@theme` block is the single source of truth for primary colors — changing it propagates amber to every `primary-*` class across the entire UI automatically.

**Tech Stack:** React + TailwindCSS v4 (CSS-first config), Vite PWA, SVG favicon

---

## Task 1: Swap Primary Color Palette (CSS)

**Files:**
- Modify: `frontend/src/index.css`

The `@theme` block (line 132–143) defines all `primary-*` Tailwind colors. Replacing it with amber propagates to every button, badge, icon, and border using `primary-*` classes — no component changes needed for colors.

**Step 1: Replace the `@theme` primary palette**

Find this block (lines 132–143):
```css
@theme {
  /* Violet Accent */
  --color-primary-50: #f5f3ff;
  --color-primary-100: #ede9fe;
  --color-primary-200: #ddd6fe;
  --color-primary-300: #c4b5fd;
  --color-primary-400: #a78bfa;
  --color-primary-500: #8b5cf6;
  --color-primary-600: #7c3aed;
  --color-primary-700: #6d28d9;
  --color-primary-800: #5b21b6;
  --color-primary-900: #4c1d95;
```

Replace with:
```css
@theme {
  /* Amber Accent — Tower brand */
  --color-primary-50: #fffbeb;
  --color-primary-100: #fef3c7;
  --color-primary-200: #fde68a;
  --color-primary-300: #fcd34d;
  --color-primary-400: #fbbf24;
  --color-primary-500: #f59e0b;
  --color-primary-600: #d97706;
  --color-primary-700: #b45309;
  --color-primary-800: #92400e;
  --color-primary-900: #78350f;
```

**Step 2: Fix hardcoded purple hex values**

In the **dark theme** block (`:root, :root[data-theme="dark"]`), replace these lines:

| Find | Replace |
|------|---------|
| `--th-prose-link: #a78bfa;` | `--th-prose-link: #fbbf24;` |
| `--th-q-pending-btn-bg: rgba(139, 92, 246, 0.08);` | `--th-q-pending-btn-bg: rgba(245, 158, 11, 0.08);` |
| `--th-q-pending-btn-border: rgba(139, 92, 246, 0.25);` | `--th-q-pending-btn-border: rgba(245, 158, 11, 0.25);` |
| `--th-q-pending-btn-text: #c4b5fd;` | `--th-q-pending-btn-text: #fcd34d;` |
| `--th-q-pending-btn-hover-bg: rgba(139, 92, 246, 0.15);` | `--th-q-pending-btn-hover-bg: rgba(245, 158, 11, 0.15);` |
| `--th-q-pending-btn-hover-border: rgba(139, 92, 246, 0.40);` | `--th-q-pending-btn-hover-border: rgba(245, 158, 11, 0.40);` |
| `--th-q-pending-desc: rgba(196, 181, 253, 0.50);` | `--th-q-pending-desc: rgba(253, 211, 77, 0.50);` |

In the **light theme** block (`:root[data-theme="light"]`), replace these lines:

| Find | Replace |
|------|---------|
| `--th-prose-link: #7c3aed;` | `--th-prose-link: #d97706;` |
| `--th-prose-blockquote-bg: rgba(124, 58, 237, 0.05);` | `--th-prose-blockquote-bg: rgba(245, 158, 11, 0.05);` |
| `--th-q-pending-btn-bg: rgba(124, 58, 237, 0.06);` | `--th-q-pending-btn-bg: rgba(245, 158, 11, 0.06);` |
| `--th-q-pending-btn-border: rgba(124, 58, 237, 0.25);` | `--th-q-pending-btn-border: rgba(245, 158, 11, 0.25);` |
| `--th-q-pending-btn-text: #6d28d9;` | `--th-q-pending-btn-text: #d97706;` |
| `--th-q-pending-btn-hover-bg: rgba(124, 58, 237, 0.12);` | `--th-q-pending-btn-hover-bg: rgba(245, 158, 11, 0.12);` |
| `--th-q-pending-btn-hover-border: rgba(124, 58, 237, 0.40);` | `--th-q-pending-btn-hover-border: rgba(245, 158, 11, 0.40);` |
| `--th-q-pending-desc: rgba(109, 40, 217, 0.50);` | `--th-q-pending-desc: rgba(180, 83, 9, 0.50);` |

**Step 3: Fix `.app-bg` gradient purples**

Find (in `.app-bg` dark block):
```css
    radial-gradient(ellipse 80% 60% at 50% 0%, rgba(124, 58, 237, 0.06) 0%, transparent 60%),
```
Replace:
```css
    radial-gradient(ellipse 80% 60% at 50% 0%, rgba(245, 158, 11, 0.06) 0%, transparent 60%),
```

Find (in `.app-bg` light block):
```css
    radial-gradient(ellipse 80% 50% at 50% 0%, rgba(124, 58, 237, 0.03) 0%, transparent 50%),
```
Replace:
```css
    radial-gradient(ellipse 80% 50% at 50% 0%, rgba(245, 158, 11, 0.03) 0%, transparent 50%),
```

**Step 4: Fix remaining hardcoded purples in prose rules**

Find:
```css
  border-left: 3px solid #7c3aed;
```
Replace:
```css
  border-left: 3px solid #d97706;
```

Find:
```css
  border-bottom: 1px solid rgba(167, 139, 250, 0.25);
```
Replace:
```css
  border-bottom: 1px solid rgba(245, 158, 11, 0.25);
```

**Step 5: Commit**
```bash
cd /home/enterpriseai/claude-desk
git add frontend/src/index.css
git commit -m "feat(rebrand): swap primary palette violet → amber (Tower)"
```

---

## Task 2: New Favicon — Tower Silhouette

**Files:**
- Modify: `frontend/public/favicon.svg`

**Step 1: Replace favicon.svg entirely**

Write the following content to `frontend/public/favicon.svg`:

```svg
<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" rx="6" fill="#0b0d12"/>
  <!-- Antenna -->
  <rect x="15" y="3" width="2" height="4" rx="1" fill="#f59e0b"/>
  <!-- Tower triangle body -->
  <polygon points="16,6 24,26 8,26" fill="#f59e0b"/>
  <!-- Base bar -->
  <rect x="7" y="26" width="18" height="2.5" rx="1.25" fill="#f59e0b"/>
  <!-- Center mast line (subtle depth) -->
  <rect x="15.4" y="6" width="1.2" height="20" rx="0.6" fill="#0b0d12" opacity="0.25"/>
</svg>
```

**Step 2: Commit**
```bash
git add frontend/public/favicon.svg
git commit -m "feat(rebrand): new Tower favicon — amber antenna silhouette"
```

---

## Task 3: HTML & PWA Config

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/vite.config.ts`

**Step 1: Update `frontend/index.html`**

Change line 6:
```html
    <title>Claude Desk</title>
```
→
```html
    <title>Tower</title>
```

Change line 8:
```html
    <meta name="theme-color" content="#7c3aed" />
```
→
```html
    <meta name="theme-color" content="#d97706" />
```

**Step 2: Update `frontend/vite.config.ts` PWA manifest**

Find:
```ts
        name: 'Claude Desk',
        short_name: 'Claude Desk',
        description: 'Claude Code Web Interface',
        theme_color: '#7c3aed',
```
Replace:
```ts
        name: 'Tower',
        short_name: 'Tower',
        description: 'Stack your own tower of AI and systems.',
        theme_color: '#d97706',
```

**Step 3: Commit**
```bash
git add frontend/index.html frontend/vite.config.ts
git commit -m "feat(rebrand): update HTML title, theme-color, PWA manifest → Tower"
```

---

## Task 4: Header Component

**Files:**
- Modify: `frontend/src/components/layout/Header.tsx`

The header currently renders a small icon with letter "C" and the text "Claude Desk". Update both.

**Step 1: Change the brand icon letter**

Find (lines 131–134):
```tsx
        <div className="w-6 h-6 rounded bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
          <span className="text-primary-400 font-bold text-xs uppercase tracking-wider">C</span>
        </div>
        {!isMobile && <span className="text-gray-100 font-bold text-[15px] tracking-tight">Claude Desk</span>}
```
Replace with:
```tsx
        <div className="w-6 h-6 rounded bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
          <span className="text-primary-400 font-bold text-xs uppercase tracking-wider">T</span>
        </div>
        {!isMobile && <span className="text-gray-100 font-bold text-[15px] tracking-tight">Tower</span>}
```

**Step 2: Commit**
```bash
git add frontend/src/components/layout/Header.tsx
git commit -m "feat(rebrand): update Header brand name C → T, Claude Desk → Tower"
```

---

## Task 5: Login Page

**Files:**
- Modify: `frontend/src/components/auth/LoginPage.tsx`

**Step 1: Update brand name and add tagline**

Find (lines 28–33):
```tsx
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary-500 mb-2">Claude Desk</h1>
          <p className="text-sm text-gray-500">
            {isSetup ? 'Create an admin account' : 'Sign in'}
          </p>
        </div>
```
Replace with:
```tsx
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary-500 mb-1">Tower</h1>
          <p className="text-xs text-gray-600 mb-3 italic">
            Stack your own tower of AI and systems.
          </p>
          <p className="text-sm text-gray-500">
            {isSetup ? 'Create an admin account' : 'Sign in'}
          </p>
        </div>
```

**Step 2: Commit**
```bash
git add frontend/src/components/auth/LoginPage.tsx
git commit -m "feat(rebrand): update LoginPage — Tower name + tagline"
```

---

## Task 6: Config Files

**Files:**
- Modify: `package.json`
- Modify: `ecosystem.config.cjs`
- Modify: `CLAUDE.md`

**Step 1: Update `package.json`**

Change line 2:
```json
  "name": "claude-desk",
```
→
```json
  "name": "tower",
```

Also update the pm2 script references (they reference the pm2 app name):
```json
    "stop": "pm2 stop claude-desk",
    "restart": "echo '⚠️  개발 중에는 npm run dev 를 사용하세요. restart는 production 전용 (DB 경로가 달라짐)' && npm run build && pm2 restart claude-desk",
    "logs": "pm2 logs claude-desk --lines 50",
```
→
```json
    "stop": "pm2 stop tower",
    "restart": "echo '⚠️  개발 중에는 npm run dev 를 사용하세요. restart는 production 전용 (DB 경로가 달라짐)' && npm run build && pm2 restart tower",
    "logs": "pm2 logs tower --lines 50",
```

**Step 2: Update `ecosystem.config.cjs`**

Change line 6:
```js
    name: "claude-desk",
```
→
```js
    name: "tower",
```

**Step 3: Update `CLAUDE.md`**

Change line 1–3:
```md
# Project: Claude Desk

Web-based team environment for Claude Code.
```
→
```md
# Project: Tower

AI command center for your team. Stack your own tower of AI and systems.
```

**Step 4: Commit all**
```bash
git add package.json ecosystem.config.cjs CLAUDE.md
git commit -m "feat(rebrand): rename claude-desk → tower in configs and docs"
```

---

## Task 7: Visual Verification

**Step 1: Start dev server**
```bash
cd /home/enterpriseai/claude-desk
npm run dev
```

**Step 2: Check these in the browser at `http://localhost:32354`**

| Check | Expected |
|-------|---------|
| Browser tab | "Tower" |
| Favicon | Amber tower triangle |
| Header brand | "T" icon (amber) + "Tower" text |
| Header buttons | Amber accents (new session, connected dot border) |
| Login page | "Tower" h1, tagline below, amber sign-in button |
| Dark mode toggle | Amber highlight |
| Cost badge | Amber |

**Step 3: If pm2 is running in production, rename the process**

> ⚠️ Only if pm2 is currently running with `claude-desk` name:
```bash
cd /home/enterpriseai/claude-desk
npm run build
pm2 delete claude-desk
pm2 start ecosystem.config.cjs
```

**Step 4: Final commit (only if you tweaked anything during verification)**
```bash
git add -p
git commit -m "fix(rebrand): visual verification tweaks"
```

---

## Summary

| Task | Files | Time |
|------|-------|------|
| 1. CSS palette | `index.css` | 5 min |
| 2. Favicon | `favicon.svg` | 2 min |
| 3. HTML/PWA | `index.html`, `vite.config.ts` | 2 min |
| 4. Header | `Header.tsx` | 2 min |
| 5. LoginPage | `LoginPage.tsx` | 2 min |
| 6. Configs | `package.json`, `ecosystem.config.cjs`, `CLAUDE.md` | 3 min |
| 7. Verify | browser | 5 min |

**Total: ~20 minutes**
