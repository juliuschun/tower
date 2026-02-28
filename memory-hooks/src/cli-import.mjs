#!/usr/bin/env node

/**
 * cli-import.mjs — Batch import all CLI JSONL sessions into tower.db.
 *
 * Usage:
 *   node cli-import.mjs            # Import all sessions
 *   node cli-import.mjs --dry-run  # Show what would be imported
 *
 * Scans ~/.claude/projects/ for all *.jsonl files.
 * Uses ~/.claude/history.jsonl for session names.
 * Skips sessions already in tower.db (idempotent).
 */

import {
  openTowerDb,
  collectAllSessions,
  parseSessionJsonl,
  upsertSession,
  loadHistoryIndex,
  resolveSessionName,
  TOWER_DB_PATH,
} from './tower-sync-lib.mjs';

const dryRun = process.argv.includes('--dry-run');

function main() {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   CLI → tower.db Session Import      ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  // 1. Open tower.db
  const db = openTowerDb();
  if (!db) {
    console.error(`❌ tower.db not found at: ${TOWER_DB_PATH}`);
    console.error('   Install claude-desk first, then run this script.');
    process.exit(1);
  }

  if (dryRun) {
    console.log('🔍 DRY RUN — no changes will be made\n');
  }

  // 2. Load history index for session names
  const historyIndex = loadHistoryIndex();
  console.log(`📚 History index: ${historyIndex.size} entries loaded`);

  // 3. Collect all JSONL files
  const allSessions = collectAllSessions();
  console.log(`📁 Found ${allSessions.length} session files\n`);

  if (allSessions.length === 0) {
    console.log('Nothing to import.');
    db.close();
    return;
  }

  // 4. Import each session
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  let emptySkipped = 0;

  for (let i = 0; i < allSessions.length; i++) {
    const entry = allSessions[i];
    const num = `[${String(i + 1).padStart(String(allSessions.length).length)}/${allSessions.length}]`;

    try {
      const parsed = parseSessionJsonl(entry.filePath);

      if (!parsed.messages.length) {
        emptySkipped++;
        continue;
      }

      const name = resolveSessionName(entry.sessionId, historyIndex, parsed.messages);
      const shortName = name.length > 50 ? name.slice(0, 50) + '...' : name;

      if (dryRun) {
        // Check if already exists
        const existing = db.prepare(
          'SELECT id FROM sessions WHERE claude_session_id = ?'
        ).get(entry.sessionId);

        if (existing) {
          console.log(`${num} ⏭  "${shortName}" (already in DB)`);
          skipped++;
        } else {
          console.log(`${num} 📥 "${shortName}" (${parsed.messages.length} msgs, ${parsed.turnCount} turns, $${parsed.totalCost.toFixed(4)})`);
          imported++;
        }
        continue;
      }

      const result = upsertSession(db, {
        claudeSessionId: entry.sessionId,
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

      if (result.created) {
        console.log(`${num} ✅ "${shortName}" (${parsed.messages.length} msgs, new)`);
        imported++;
      } else {
        // EXISTS: stats updated + any new messages appended (INSERT OR IGNORE)
        skipped++;
      }
    } catch (err) {
      console.error(`${num} ❌ ${entry.sessionId}: ${err.message}`);
      errors++;
    }
  }

  db.close();

  // 5. Summary
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  if (dryRun) {
    console.log(`🔍 DRY RUN complete:`);
    console.log(`   Would import: ${imported}`);
    console.log(`   Already in DB: ${skipped}`);
    console.log(`   Empty (skip): ${emptySkipped}`);
    console.log(`   Errors: ${errors}`);
    console.log('');
    console.log('   Run without --dry-run to actually import.');
  } else {
    console.log(`✅ Import complete:`);
    console.log(`   Created (new): ${imported}`);
    console.log(`   Updated (stats + new msgs): ${skipped}`);
    console.log(`   Empty (skip): ${emptySkipped}`);
    console.log(`   Errors: ${errors}`);
  }
  console.log('');
}

main();
