# Last Viewed Session Restore — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** On login or page refresh, silently auto-select the session the user was last viewing.

**Architecture:** Extract a `getTokenUserId` helper to a utility file (testable). Write `tower_lastViewed_${userId}` to localStorage when the user clicks a session. Read it back after `/api/sessions` resolves and silently call `setActiveSessionId`. No backend changes.

**Tech Stack:** React, localStorage, JWT base64 decode (no library), Vitest

---

## Task 1: `getTokenUserId` utility + tests

**Files:**
- Create: `frontend/src/utils/session-restore.ts`
- Create: `frontend/src/utils/session-restore.test.ts`

**Step 1: Write the failing tests**

Create `frontend/src/utils/session-restore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getTokenUserId } from './session-restore';

// Build a fake JWT: header.base64payload.sig
function makeToken(payload: object): string {
  const enc = btoa(JSON.stringify(payload));
  return `fakeheader.${enc}.fakesig`;
}

describe('getTokenUserId', () => {
  it('returns userId from valid token', () => {
    const token = makeToken({ userId: 42, username: 'alice', role: 'admin' });
    expect(getTokenUserId(token)).toBe(42);
  });

  it('returns 0 for null token', () => {
    expect(getTokenUserId(null)).toBe(0);
  });

  it('returns 0 for malformed token', () => {
    expect(getTokenUserId('not-a-jwt')).toBe(0);
  });

  it('returns 0 when userId missing from payload', () => {
    const token = makeToken({ username: 'bob' });
    expect(getTokenUserId(token)).toBe(0);
  });

  it('returns 0 for invalid base64 payload', () => {
    expect(getTokenUserId('h.!!!.s')).toBe(0);
  });
});
```

**Step 2: Run tests — expect FAIL**

```bash
cd /home/enterpriseai/claude-desk
npm test -- --reporter=verbose 2>&1 | grep -A5 "session-restore"
```

Expected: `getTokenUserId` is not defined / module not found.

**Step 3: Implement `session-restore.ts`**

Create `frontend/src/utils/session-restore.ts`:

```ts
/**
 * Decode a JWT payload (no signature verification — client-side only, used as localStorage key).
 * Returns userId from the payload, or 0 if unavailable.
 */
export function getTokenUserId(token: string | null): number {
  if (!token) return 0;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return 0;
    const payload = JSON.parse(atob(parts[1]));
    return payload.userId ?? 0;
  } catch {
    return 0;
  }
}

/** localStorage key for the last-viewed session, scoped by userId */
export function lastViewedKey(userId: number): string {
  return `tower_lastViewed_${userId}`;
}
```

**Step 4: Run tests — expect PASS**

```bash
cd /home/enterpriseai/claude-desk
npm test -- --reporter=verbose 2>&1 | grep -A10 "session-restore"
```

Expected output:
```
✓ returns userId from valid token
✓ returns 0 for null token
✓ returns 0 for malformed token
✓ returns 0 when userId missing from payload
✓ returns 0 for invalid base64 payload
5 passed
```

**Step 5: Commit**

```bash
cd /home/enterpriseai/claude-desk
git add frontend/src/utils/session-restore.ts frontend/src/utils/session-restore.test.ts
git commit -m "feat(session-restore): add getTokenUserId utility + tests"
```

---

## Task 2: Save last-viewed on session click

**Files:**
- Modify: `frontend/src/App.tsx` (line ~228 — `handleSelectSession`)

**Context:** `handleSelectSession` is called whenever the user clicks a session in the sidebar. It currently calls `setActiveSessionId(session.id)` at line 238. We add one localStorage write right after that.

**Step 1: Add the import at the top of App.tsx**

Find the existing import block near the top of `frontend/src/App.tsx`. After the last `import` statement, add:

```ts
import { getTokenUserId, lastViewedKey } from './utils/session-restore';
```

**Step 2: Add localStorage write in `handleSelectSession`**

In `handleSelectSession` (starts at line 228), find this line:

```ts
    setActiveSessionId(session.id);
```

Replace with:

```ts
    setActiveSessionId(session.id);
    localStorage.setItem(lastViewedKey(getTokenUserId(token)), session.id);
```

That is the only change in this function.

**Step 3: Verify tests still pass**

```bash
cd /home/enterpriseai/claude-desk
npm test 2>&1 | tail -5
```

Expected: all tests pass (no regressions).

**Step 4: Commit**

```bash
cd /home/enterpriseai/claude-desk
git add frontend/src/App.tsx
git commit -m "feat(session-restore): save last-viewed session on select"
```

---

## Task 3: Restore last-viewed after sessions load

**Files:**
- Modify: `frontend/src/App.tsx` (line ~131 — sessions load effect)

**Context:** The sessions load effect (around line 124) fetches `/api/sessions` and calls `setSessions(data)`. This is the right place to restore — sessions list is now available to validate against.

**Step 1: Find the sessions load effect**

In `frontend/src/App.tsx`, find this block (around lines 131–137):

```ts
    fetch(`${API_BASE}/sessions`, { headers })
      .then((r) => {
        if (r.status === 401) { localStorage.removeItem('token'); setToken(null); return []; }
        return r.ok ? r.json() : [];
      })
      .then((data) => setSessions(data))
      .catch(() => {});
```

**Step 2: Replace the `.then((data) => setSessions(data))` line**

Replace:

```ts
      .then((data) => setSessions(data))
```

With:

```ts
      .then((data) => {
        setSessions(data);
        // Silently restore the last session the user was viewing
        const lastId = localStorage.getItem(lastViewedKey(getTokenUserId(token)));
        if (lastId && data.some((s: SessionMeta) => s.id === lastId)) {
          setActiveSessionId(lastId);
        }
      })
```

**Step 3: Verify tests still pass**

```bash
cd /home/enterpriseai/claude-desk
npm test 2>&1 | tail -5
```

Expected: all tests pass.

**Step 4: Commit**

```bash
cd /home/enterpriseai/claude-desk
git add frontend/src/App.tsx
git commit -m "feat(session-restore): auto-restore last-viewed session on load"
```

---

## Task 4: Manual Verification

**Step 1: Start dev server**

```bash
cd /home/enterpriseai/claude-desk
npm run dev
```

**Step 2: Verify the happy path**

1. Open `http://localhost:32354`, log in
2. Click any session in the sidebar
3. Open DevTools → Application → Local Storage → check for key `tower_lastViewed_<userId>` with the session ID as value ✅
4. Refresh the page (F5)
5. After load: the same session should be silently pre-selected in the sidebar and chat area ✅

**Step 3: Verify the deleted-session fallback**

1. Note the current `tower_lastViewed_*` value in localStorage
2. Delete that session via the UI (or manually set localStorage to a fake UUID: `localStorage.setItem('tower_lastViewed_1', '00000000-fake-uuid')`)
3. Refresh the page
4. App should load with no session selected (empty state) — not an error ✅

**Step 4: Verify multi-user isolation**

1. Log in as user A, click a session → note `tower_lastViewed_1` (or whatever userId A has)
2. Log out, log in as user B → note a different `tower_lastViewed_<B_userId>` key
3. Each user restores their own last session ✅

**Step 5: Stop dev server, no commit needed (verification only)**
