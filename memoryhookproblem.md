# Duplicate Session Bug — Root Cause & Fix

## Symptom

181 duplicate sessions appearing in the sidebar with identical names and timestamps but different IDs and turn counts. Users saw the same conversation title repeated many times in the ungrouped section.

## Root Cause

**Race condition between `tower-sync-stop.mjs` (SessionEnd hook) and Tower's `claimClaudeSessionId()`.**

### The Race

Every user message in Tower triggers this sequence:

```
T0: Tower calls executeQuery() → spawns Claude subprocess
T1: Claude subprocess writes output to pipe buffer, finishes, exits
T2: Subprocess exit fires SessionEnd hook (tower-sync-stop.mjs) as a SEPARATE process
T3: Hook queries DB: WHERE claude_session_id = 'X'
    → Tower hasn't processed first SDK message yet → NOT FOUND
    → Hook creates a new session (duplicate)
T4: Tower reads from pipe → processes first SDK message → claimClaudeSessionId()
    → Sets claude_session_id on Tower session
    → Clears claude_session_id from the just-created duplicate
T5: Duplicate now has claude_session_id = NULL (orphaned forever)
```

This happens on every turn where the Claude subprocess exits before Tower processes the first SDK message — common for short/fast responses.

### Evidence

All 181 duplicates shared these traits:
- `tags = '["cli"]'` — only `tower-sync-stop.mjs` uses this tag
- ISO timestamps (e.g. `2026-03-09T05:46:08.301Z`) — only `upsertSession()` sets these; Tower's `createSession()` uses SQLite `CURRENT_TIMESTAMP` format
- `claude_session_id = NULL` — cleared by `claimClaudeSessionId()` after the hook set it
- Same `created_at` within duplicate groups — parsed from the same JSONL file's `firstTimestamp`
- Different `turn_count` — JSONL grew over time, each hook invocation captured a different snapshot

## Fix

### Primary: Retry in the hook (closes the race window)

In `tower-sync-stop.mjs`, after the first ownership lookup fails, wait 2 seconds and retry. Tower processes the first SDK message in < 50ms typically, so 2 seconds gives 40x margin.

```javascript
let existing = db.prepare('SELECT id FROM sessions WHERE claude_session_id = ?').get(sessionId);
if (!existing) {
  await new Promise(r => setTimeout(r, 2000));
  existing = db.prepare('SELECT id FROM sessions WHERE claude_session_id = ?').get(sessionId);
}
```

### Secondary: Frontend/backend defense-in-depth

These guard against a different (rarer) bug class where `chatStore.sessionId` desyncs from `sessionStore.activeSessionId`:

- **`useClaudeChat.ts sendMessage`** — Checks sessionId before adding user message. If `chatStore.sessionId` is null, recovers from `sessionStore.activeSessionId`. Shows toast error if both are null.
- **`App.tsx handleSendMessage`** — Ref lock prevents concurrent `createSessionInDb()` calls from rapid double-send.
- **`ws-handler.ts handleChat`** — Rejects chat messages without sessionId instead of silently creating orphan sessions via `uuidv4()`.

### Cleanup

```sql
DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE tags = '["cli"]' AND archived = 0);
DELETE FROM sessions WHERE tags = '["cli"]' AND archived = 0;
```

## Alternatives Considered

| Option | Approach | Weakness |
|--------|----------|----------|
| Delay + retry (chosen) | Hook waits 2s before creating | Arbitrary delay, could theoretically still race under extreme load |
| `tower_managed` DB flag + cwd match | Pre-mark Tower sessions, hook checks by cwd | Multiple sessions can share the same cwd (same project) |
| Environment variable | Pass `TOWER_SESSION_ID` via `process.env` to subprocess | Global env — concurrent `executeQuery()` calls could interleave |
| Skip hook for Tower sessions entirely | Don't create sessions from hook at all | Loses CLI session auto-import feature |

## Files Changed

- `memory-hooks/src/tower-sync-stop.mjs` — Added retry logic
- `frontend/src/hooks/useClaudeChat.ts` — sessionId guard with desync recovery
- `frontend/src/App.tsx` — Concurrent session creation lock
- `backend/routes/ws-handler.ts` — Reject missing sessionId
