#!/usr/bin/env node

/**
 * tower-sync-lib.mjs — Shared library for CLI → tower.db synchronization.
 *
 * Parses Claude Code CLI JSONL session files and upserts them into tower.db.
 * Used by both tower-sync-stop.mjs (per-session hook) and cli-import.mjs (batch).
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

// ── Paths ──

const HOME = homedir();
export const TOWER_DB_PATH = join(HOME, 'claude-desk', 'data', 'tower.db');
export const CLAUDE_PROJECTS_DIR = join(HOME, '.claude', 'projects');
export const HISTORY_JSONL_PATH = join(HOME, '.claude', 'history.jsonl');

// ── Pricing (per 1M tokens) ──

const PRICING = {
  // Sonnet family
  'claude-sonnet-4-20250514':    { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-6':           { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-5-20250620':  { input: 3.00,  output: 15.00 },
  'claude-3-5-sonnet-20241022':  { input: 3.00,  output: 15.00 },
  'claude-3-5-sonnet-20240620':  { input: 3.00,  output: 15.00 },
  // Opus family
  'claude-opus-4-6':             { input: 15.00, output: 75.00 },
  'claude-opus-4-20250514':      { input: 15.00, output: 75.00 },
  // Haiku family
  'claude-haiku-4-5-20251001':   { input: 0.80,  output: 4.00  },
  'claude-3-5-haiku-20241022':   { input: 0.80,  output: 4.00  },
  'claude-3-haiku-20240307':     { input: 0.25,  output: 1.25  },
};
const DEFAULT_PRICING = { input: 3.00, output: 15.00 };

// ── DB ──

/**
 * Open tower.db. Returns null if the file does not exist (claude-desk not installed).
 */
export function openTowerDb() {
  if (!existsSync(TOWER_DB_PATH)) return null;
  const db = new Database(TOWER_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return db;
}

// ── History Index ──

/**
 * Load ~/.claude/history.jsonl into a Map<sessionId, {display, timestamp, project}>.
 * Keeps the FIRST entry per sessionId (earliest user message → best title).
 */
export function loadHistoryIndex() {
  const index = new Map();
  if (!existsSync(HISTORY_JSONL_PATH)) return index;

  try {
    const raw = readFileSync(HISTORY_JSONL_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (!entry.sessionId) continue;
        // Keep first meaningful display per session
        if (!index.has(entry.sessionId) && entry.display?.trim()) {
          index.set(entry.sessionId, {
            display: entry.display.trim(),
            timestamp: entry.timestamp,
            project: entry.project,
          });
        }
      } catch {}
    }
  } catch {}

  return index;
}

// ── JSONL Parser ──

/**
 * Calculate cost from usage and model name.
 */
function calculateCost(usage, model) {
  if (!usage) return 0;
  const pricing = PRICING[model] || DEFAULT_PRICING;
  const inputTokens = (usage.input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0)
    + (usage.cache_read_input_tokens || 0);
  const outputTokens = usage.output_tokens || 0;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/**
 * Filter content blocks: remove thinking, truncate huge tool_results.
 */
function filterContent(contentArr) {
  if (!Array.isArray(contentArr)) return contentArr;
  return contentArr
    .filter(b => b.type !== 'thinking')
    .map(b => {
      // Truncate huge tool results
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

/**
 * Parse a CLI JSONL session file into structured data.
 */
export function parseSessionJsonl(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');

  let sessionId = null;
  let cwd = null;
  const modelCounts = {};
  let totalTokens = 0;
  let totalCost = 0;
  let turnCount = 0;
  const filesEdited = new Set();

  // Collect raw messages grouped by requestId for assistant merging
  const rawMessages = [];      // { uuid, role, content, timestamp, requestId, parentToolUseId }
  let firstTimestamp = null;
  let lastTimestamp = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    // Skip non-message types
    if (!entry.type || entry.type === 'queue-operation' || entry.type === 'progress') continue;
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;

    // Extract session metadata from first message
    if (!sessionId && entry.sessionId) sessionId = entry.sessionId;
    if (!cwd && entry.cwd) cwd = entry.cwd;

    const msg = entry.message;
    if (!msg || !msg.content) continue;

    const ts = entry.timestamp;
    if (ts) {
      if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts;
      if (!lastTimestamp || ts > lastTimestamp) lastTimestamp = ts;
    }

    const content = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content) }];

    if (entry.type === 'user') {
      turnCount++;

      // Extract parent_tool_use_id from tool_result blocks
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
      // Token accounting
      if (msg.usage) {
        const toks = (msg.usage.input_tokens || 0)
          + (msg.usage.output_tokens || 0)
          + (msg.usage.cache_creation_input_tokens || 0)
          + (msg.usage.cache_read_input_tokens || 0);
        totalTokens += toks;
        totalCost += calculateCost(msg.usage, msg.model);
      }

      // Model tracking
      if (msg.model) {
        modelCounts[msg.model] = (modelCounts[msg.model] || 0) + 1;
      }

      // Extract files edited from tool_use blocks
      for (const block of content) {
        if (block.type === 'tool_use' && block.input?.file_path) {
          const toolName = block.name || '';
          if (['Edit', 'Write', 'NotebookEdit'].includes(toolName)) {
            filesEdited.add(block.input.file_path);
          }
        }
      }

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
      // Collect all consecutive assistant messages with the same requestId
      const merged = { ...m, content: [...m.content] };
      let j = i + 1;
      while (j < rawMessages.length
        && rawMessages[j].role === 'assistant'
        && rawMessages[j].requestId === m.requestId) {
        merged.content.push(...rawMessages[j].content);
        merged.timestamp = rawMessages[j].timestamp; // use last timestamp
        j++;
      }
      messages.push(merged);
      i = j;
    } else {
      messages.push(m);
      i++;
    }
  }

  // Determine most-used model
  let modelUsed = null;
  let maxCount = 0;
  for (const [model, count] of Object.entries(modelCounts)) {
    if (count > maxCount) { maxCount = count; modelUsed = model; }
  }

  return {
    sessionId,
    cwd,
    messages,
    totalTokens,
    totalCost,
    modelUsed,
    turnCount,
    filesEdited: [...filesEdited],
    firstTimestamp,
    lastTimestamp,
  };
}

// ── Session Name Resolution ──

/**
 * Resolve session name: history.jsonl display → first user text → "CLI Session"
 */
export function resolveSessionName(sessionId, historyIndex, messages) {
  // 1. history.jsonl
  const hist = historyIndex.get(sessionId);
  if (hist?.display) {
    return hist.display.slice(0, 100);
  }

  // 2. First user message text
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const content = Array.isArray(m.content) ? m.content : [];
    for (const block of content) {
      if (block.type === 'text' && block.text?.trim()) {
        return block.text.trim().slice(0, 80);
      }
    }
  }

  return 'CLI Session';
}

// ── Stats-Only Update ──

/**
 * Update only session statistics (cost, tokens, model, etc.) without touching messages.
 * Used when Tower ws-handler owns the session — it already writes messages in real-time,
 * so the hook should only backfill stats that Tower doesn't track (cost, tokens).
 */
export function updateSessionStatsOnly(db, sessionId, parsed) {
  db.prepare(`
    UPDATE sessions SET
      name         = CASE WHEN auto_named = 1 THEN COALESCE(?, name) ELSE name END,
      total_cost   = ?,
      total_tokens = ?,
      model_used   = COALESCE(?, model_used),
      turn_count   = MAX(turn_count, ?),
      files_edited = ?,
      updated_at   = ?
    WHERE id = ?
  `).run(
    parsed.resolvedName || null,
    parsed.totalCost || 0,
    parsed.totalTokens || 0,
    parsed.modelUsed || null,
    parsed.turnCount || 0,
    JSON.stringify(parsed.filesEdited || []),
    parsed.lastTimestamp || new Date().toISOString(),
    sessionId,
  );
}

// ── Upsert ──

/**
 * Upsert a CLI session into tower.db.
 *
 * - Session not in DB: INSERT session + all messages
 * - Session already in DB: UPDATE stats + INSERT OR IGNORE new messages only
 *   (preserves user edits: tags, favorite, manual name rename)
 *
 * Returns { created: boolean, sessionId: string, newMessages: number }
 */
export function upsertSession(db, data) {
  const existing = db.prepare(
    'SELECT id, auto_named FROM sessions WHERE claude_session_id = ?'
  ).get(data.claudeSessionId);

  const sessionId = existing ? existing.id : randomUUID();

  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages (
      id, session_id, role, content, parent_tool_use_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const doSync = db.transaction(() => {
    if (existing) {
      // UPDATE: refresh stats but preserve user-set name and tags
      // auto_named=1 means we can overwrite the name; 0 means user renamed it
      db.prepare(`
        UPDATE sessions SET
          name       = CASE WHEN auto_named = 1 THEN ? ELSE name END,
          total_cost   = ?,
          total_tokens = ?,
          model_used   = ?,
          turn_count   = ?,
          files_edited = ?,
          updated_at   = ?
        WHERE id = ?
      `).run(
        data.name,
        data.totalCost || 0,
        data.totalTokens || 0,
        data.modelUsed || null,
        data.turnCount || 0,
        JSON.stringify(data.filesEdited || []),
        data.updatedAt || new Date().toISOString(),
        sessionId,
      );
    } else {
      // INSERT fresh session
      db.prepare(`
        INSERT INTO sessions (
          id, claude_session_id, name, cwd, tags, total_cost, total_tokens,
          model_used, auto_named, turn_count, files_edited, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        data.claudeSessionId,
        data.name,
        data.cwd || '',
        JSON.stringify(data.tags || ['cli']),
        data.totalCost || 0,
        data.totalTokens || 0,
        data.modelUsed || null,
        1,  // auto_named
        data.turnCount || 0,
        JSON.stringify(data.filesEdited || []),
        data.createdAt || new Date().toISOString(),
        data.updatedAt || new Date().toISOString(),
      );
    }

    // INSERT OR IGNORE: new messages get added, existing ones are silently skipped
    for (const msg of data.messages) {
      const contentStr = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);
      insertMessage.run(
        msg.uuid,
        sessionId,
        msg.role,
        contentStr,
        msg.parentToolUseId || null,
        msg.timestamp || new Date().toISOString(),
      );
    }
  });

  doSync();

  return { created: !existing, sessionId };
}

// ── File Finder ──

/**
 * Find a session JSONL file by sessionId across all project directories.
 */
export function findSessionFile(sessionId) {
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

/**
 * Collect all JSONL session files across all projects.
 * Returns array of { filePath, sessionId, projectDir, mtime }
 */
export function collectAllSessions() {
  const results = [];
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return results;

  try {
    const dirs = readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const projectPath = join(CLAUDE_PROJECTS_DIR, dir.name);
      try {
        for (const file of readdirSync(projectPath)) {
          if (!file.endsWith('.jsonl')) continue;
          const filePath = join(projectPath, file);
          try {
            const stat = statSync(filePath);
            results.push({
              filePath,
              sessionId: file.replace('.jsonl', ''),
              projectDir: dir.name,
              mtime: stat.mtime,
            });
          } catch {}
        }
      } catch {}
    }
  } catch {}

  // Sort oldest first
  return results.sort((a, b) => a.mtime - b.mtime);
}
