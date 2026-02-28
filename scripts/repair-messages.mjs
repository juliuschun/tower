#!/usr/bin/env node

/**
 * repair-messages.mjs — One-time repair for sessions with missing assistant messages.
 *
 * The dual-writer bug caused some Tower sessions to have 0 assistant messages
 * even though the JSONL file has them. This script finds those sessions and
 * backfills messages from the JSONL source.
 *
 * Usage:
 *   node scripts/repair-messages.mjs            # Repair
 *   node scripts/repair-messages.mjs --dry-run  # Preview only
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

const HOME = homedir();
const TOWER_DB_PATH = join(HOME, 'claude-desk', 'data', 'tower.db');
const CLAUDE_PROJECTS_DIR = join(HOME, '.claude', 'projects');

const dryRun = process.argv.includes('--dry-run');

// ── Minimal JSONL parser (extract messages only) ──

function filterContent(contentArr) {
  if (!Array.isArray(contentArr)) return contentArr;
  return contentArr
    .filter(b => b.type !== 'thinking')
    .map(b => {
      if (b.type === 'tool_result' && typeof b.content === 'string' && b.content.length > 5000) {
        return { ...b, content: b.content.slice(0, 5000) + '\n... (truncated)' };
      }
      if (b.type === 'tool_result' && Array.isArray(b.content)) {
        return {
          ...b,
          content: b.content.map(c => {
            if (c.type === 'text' && typeof c.text === 'string' && c.text.length > 5000) {
              return { ...c, text: c.text.slice(0, 5000) + '\n... (truncated)' };
            }
            return c;
          }),
        };
      }
      return b;
    });
}

function parseMessagesFromJsonl(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const rawMessages = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!entry.type || (entry.type !== 'user' && entry.type !== 'assistant')) continue;

    const msg = entry.message;
    if (!msg || !msg.content) continue;

    const content = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content) }];
    const ts = entry.timestamp;

    if (entry.type === 'user') {
      let parentToolUseId = null;
      for (const block of content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          parentToolUseId = block.tool_use_id;
          break;
        }
      }
      rawMessages.push({
        uuid: entry.uuid,
        role: 'user',
        content: filterContent(content),
        timestamp: ts,
        requestId: null,
        parentToolUseId,
      });
    }

    if (entry.type === 'assistant') {
      rawMessages.push({
        uuid: entry.uuid,
        role: 'assistant',
        content: filterContent(content),
        timestamp: ts,
        requestId: entry.requestId || null,
        parentToolUseId: null,
      });
    }
  }

  // Merge consecutive assistant messages with same requestId
  const messages = [];
  let i = 0;
  while (i < rawMessages.length) {
    const m = rawMessages[i];
    if (m.role === 'assistant' && m.requestId) {
      const merged = { ...m, content: [...m.content] };
      let j = i + 1;
      while (j < rawMessages.length
        && rawMessages[j].role === 'assistant'
        && rawMessages[j].requestId === m.requestId) {
        merged.content.push(...rawMessages[j].content);
        merged.timestamp = rawMessages[j].timestamp;
        j++;
      }
      messages.push(merged);
      i = j;
    } else {
      messages.push(m);
      i++;
    }
  }

  return messages;
}

function findSessionFile(sessionId) {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return null;
  try {
    const dirs = readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const filePath = join(CLAUDE_PROJECTS_DIR, dir.name, `${sessionId}.jsonl`);
      if (existsSync(filePath)) return filePath;
    }
  } catch {}
  return null;
}

// ── Main ──

function main() {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   Message Repair — Dual-Writer Fix   ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  if (!existsSync(TOWER_DB_PATH)) {
    console.error(`tower.db not found at: ${TOWER_DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(TOWER_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  if (dryRun) {
    console.log('DRY RUN — no changes will be made\n');
  }

  // Find sessions with messages but 0 assistant messages
  const broken = db.prepare(`
    SELECT s.id, s.claude_session_id, s.name,
      (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id AND m.role = 'assistant') as assistant_count,
      (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as total_count
    FROM sessions s
    WHERE (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id AND m.role = 'assistant') = 0
    AND (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) > 0
  `).all();

  console.log(`Found ${broken.length} sessions with 0 assistant messages\n`);

  if (broken.length === 0) {
    console.log('Nothing to repair.');
    db.close();
    return;
  }

  const insertMessage = db.prepare(`
    INSERT INTO messages (
      id, session_id, role, content, parent_tool_use_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Check if a message ID already exists (possibly under a different session)
  const checkMessage = db.prepare('SELECT id FROM messages WHERE id = ?');

  let repaired = 0;
  let noFile = 0;
  let errors = 0;

  for (const session of broken) {
    const shortName = session.name?.length > 50 ? session.name.slice(0, 50) + '...' : (session.name || '(unnamed)');

    // Find JSONL file
    const filePath = findSessionFile(session.claude_session_id);
    if (!filePath) {
      console.log(`  SKIP "${shortName}" — JSONL not found (claude_session_id=${session.claude_session_id?.slice(0, 12)})`);
      noFile++;
      continue;
    }

    try {
      const messages = parseMessagesFromJsonl(filePath);
      const assistantMsgs = messages.filter(m => m.role === 'assistant');
      const userToolResultMsgs = messages.filter(m => m.role === 'user' && m.parentToolUseId);

      if (assistantMsgs.length === 0) {
        console.log(`  SKIP "${shortName}" — JSONL also has 0 assistant messages`);
        continue;
      }

      if (dryRun) {
        console.log(`  WOULD REPAIR "${shortName}" — ${assistantMsgs.length} assistant + ${userToolResultMsgs.length} user tool_result msgs from JSONL`);
        repaired++;
        continue;
      }

      // Insert all missing messages (assistant + user tool_result)
      // If UUID already exists (from Stop hook creating a duplicate session), use a new UUID
      const toInsert = [...assistantMsgs, ...userToolResultMsgs];
      let inserted = 0;
      for (const msg of toInsert) {
        const contentStr = typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);
        // Use original UUID if available, generate new one if it collides
        let msgId = msg.uuid || randomUUID();
        if (checkMessage.get(msgId)) {
          msgId = randomUUID();
        }
        insertMessage.run(
          msgId,
          session.id,
          msg.role,
          contentStr,
          msg.parentToolUseId || null,
          msg.timestamp || new Date().toISOString(),
        );
        inserted++;
      }

      console.log(`  REPAIRED "${shortName}" — inserted ${inserted} messages (${assistantMsgs.length} assistant + ${userToolResultMsgs.length} user tool_result)`);
      repaired++;
    } catch (err) {
      console.error(`  ERROR "${shortName}": ${err.message}`);
      errors++;
    }
  }

  db.close();

  // Summary
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  if (dryRun) {
    console.log(`DRY RUN complete:`);
    console.log(`  Would repair: ${repaired}`);
  } else {
    console.log(`Repair complete:`);
    console.log(`  Repaired: ${repaired}`);
  }
  console.log(`  No JSONL found: ${noFile}`);
  console.log(`  Errors: ${errors}`);
  console.log('');
}

main();
