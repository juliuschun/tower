# Last Viewed Session Restore — Design

**Date:** 2026-02-26
**Status:** Approved

## Goal

On login or page refresh, silently auto-select the session the user was last *viewing* — not the most recently updated session, but the one they last clicked.

## Approach

Option C: **localStorage, user-scoped key.** No backend changes. Zero API overhead.

## Data Flow

```
[User clicks a session]
  → localStorage.setItem(`tower_lastViewed_${userId}`, sessionId)

[Page load / login — after /api/sessions resolves]
  → getTokenUserId(token)  // decode JWT payload, return userId
  → localStorage.getItem(`tower_lastViewed_${userId}`)
  → session found in list? → setActiveSessionId(sessionId)  // silent
  → session deleted?       → do nothing (fall back to empty state)
```

## localStorage Key

```
tower_lastViewed_${userId}    // userId = integer from JWT payload
tower_lastViewed_0            // auth disabled / anonymous
```

Scoped by userId so multiple accounts on the same browser stay independent.

## Helper Function

```ts
function getTokenUserId(token: string | null): number {
  if (!token) return 0;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.userId ?? 0;
  } catch {
    return 0;
  }
}
```

JWT payload already contains `{ userId, username, role }` — no new backend fields needed.

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/App.tsx` | Add `getTokenUserId` helper; write to localStorage on session select; restore from localStorage after sessions load |

## Edge Cases

| Case | Behaviour |
|------|-----------|
| First login ever | localStorage empty → no session selected (current behaviour) |
| Saved session was deleted | ID not in sessions list → ignored, empty state |
| Auth disabled | userId=0 → key `tower_lastViewed_0`, works fine |
| No token | `getTokenUserId` returns 0 → same as above |
| Token decode fails | try/catch → returns 0 → graceful fallback |

## Out of Scope

- Cross-device sync (YAGNI — localStorage is sufficient for team tool)
- Toast / notification on restore (user requested silent)
- Backend `last_session_id` column (no value added for this use case)
