#!/usr/bin/env node

/**
 * tower-sync-stop.mjs — SessionEnd hook that syncs a completed CLI session to tower.db.
 *
 * NOTE: This hook is registered under "SessionEnd" (not "Stop").
 * - Stop  = fires after every Claude response (per turn)
 * - SessionEnd = fires once when the session truly terminates (Ctrl+D, /exit, etc.)
 *
 * Reads session_id from stdin or env var, finds the JSONL file,
 * parses it, and upserts into tower.db.
 *
 * Silently exits if tower.db does not exist (claude-desk not installed).
 * Never blocks — all errors go to stderr with exit 0.
 */

import {
  openTowerDb,
  parseSessionJsonl,
  upsertSession,
  updateSessionStatsOnly,
  loadHistoryIndex,
  resolveSessionName,
  findSessionFile,
} from './tower-sync-lib.mjs';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let resolved = false;
    const done = (val) => { if (!resolved) { resolved = true; resolve(val); } };

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try { done(JSON.parse(data)); }
      catch { done(null); }
    });
    const t = setTimeout(() => done(null), 2000);
    t.unref();
  });
}

async function main() {
  try {
    // 1. Get session ID
    const input = await readStdin();
    const sessionId = input?.session_id || process.env.CLAUDE_SESSION_ID;
    if (!sessionId) return;

    // 2. Open tower.db (null = not installed)
    const db = openTowerDb();
    if (!db) return;

    try {
      // 3. Find JSONL file
      const filePath = findSessionFile(sessionId);
      if (!filePath) { db.close(); return; }

      // 4. Parse
      const parsed = parseSessionJsonl(filePath);
      if (!parsed.messages.length) { db.close(); return; }

      // 5. Ownership check — if Tower already owns this session, only update stats
      const existing = db.prepare(
        'SELECT id FROM sessions WHERE claude_session_id = ?'
      ).get(sessionId);

      if (existing) {
        // Tower ws-handler already writes messages in real-time.
        // Only backfill stats (cost, tokens, model) that Tower doesn't track.
        const historyIndex = loadHistoryIndex();
        const name = resolveSessionName(sessionId, historyIndex, parsed.messages);
        updateSessionStatsOnly(db, existing.id, {
          ...parsed,
          resolvedName: name,
        });
        db.close();
        return;
      }

      // 6. CLI-only session (not in tower.db) — full upsert with messages
      const historyIndex = loadHistoryIndex();
      const name = resolveSessionName(sessionId, historyIndex, parsed.messages);

      upsertSession(db, {
        claudeSessionId: sessionId,
        name,
        cwd: parsed.cwd,
        tags: ['cli'],
        totalCost: parsed.totalCost,
        totalTokens: parsed.totalTokens,
        modelUsed: parsed.modelUsed,
        turnCount: parsed.turnCount,
        filesEdited: parsed.filesEdited,
        messages: parsed.messages,
        createdAt: parsed.firstTimestamp,
        updatedAt: parsed.lastTimestamp,
      });

      db.close();
    } catch (err) {
      try { db.close(); } catch {}
      throw err;
    }
  } catch (err) {
    process.stderr.write(`[tower-sync] stop error: ${err.message}\n`);
    process.exit(0); // never block CLI
  }
}

main();
