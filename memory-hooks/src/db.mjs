import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';

const DB_PATH = join(homedir(), '.claude', 'memory.db');

let _db = null;
const _stmts = {};

export function getDb() {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 5000');
  _db.pragma('synchronous = NORMAL');

  initSchema(_db);
  prepareStatements(_db);
  return _db;
}

function stmt(name) {
  if (!_stmts[name]) getDb(); // ensure prepared
  return _stmts[name];
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      tool_name TEXT,
      type TEXT,
      project TEXT,
      file_path TEXT,
      content TEXT,
      tags TEXT,
      importance INTEGER DEFAULT 2,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
    CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);

    CREATE TABLE IF NOT EXISTS session_summaries (
      session_id TEXT PRIMARY KEY,
      project TEXT,
      summary TEXT,
      tools_used TEXT,
      files_changed TEXT,
      memory_count INTEGER DEFAULT 0,
      duration_sec INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now'))
    );
  `);

  // FTS5 standalone tables (column named 'body' to avoid clash with FTS5 'content' option)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        body, tags, file_path,
        tokenize='unicode61'
      );
    `);
  } catch (_) { /* already exists */ }

  try {
    db.exec(`
      CREATE VIRTUAL TABLE memories_trigram USING fts5(
        body, tags,
        tokenize='trigram'
      );
    `);
  } catch (_) { /* already exists */ }

  // INSERT-only trigger (memories are append-only in normal operation)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, body, tags, file_path)
        VALUES (new.id, new.content, new.tags, new.file_path);
      INSERT INTO memories_trigram(rowid, body, tags)
        VALUES (new.id, new.content, new.tags);
    END;
  `);
}

function prepareStatements(db) {
  _stmts.insert = db.prepare(`
    INSERT INTO memories (session_id, tool_name, type, project, file_path, content, tags, importance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  _stmts.dedup = db.prepare(`
    SELECT 1 FROM memories
    WHERE session_id = ? AND content = ?
      AND created_at > strftime('%Y-%m-%dT%H:%M:%S', 'now', ?)
    LIMIT 1
  `);
  _stmts.upsertSummary = db.prepare(`
    INSERT INTO session_summaries (session_id, project, summary, tools_used, files_changed, memory_count, duration_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      summary = excluded.summary,
      tools_used = excluded.tools_used,
      files_changed = excluded.files_changed,
      memory_count = excluded.memory_count,
      duration_sec = excluded.duration_sec,
      updated_at = strftime('%Y-%m-%dT%H:%M:%S', 'now')
  `);
  _stmts.cleanup = db.prepare(`
    DELETE FROM memories
    WHERE importance < 3
      AND created_at < strftime('%Y-%m-%dT%H:%M:%S', 'now', ?)
  `);
  _stmts.sessionMemories = db.prepare(`
    SELECT * FROM memories WHERE session_id = ? ORDER BY created_at ASC
  `);
}

// ── Rebuild FTS indexes (called after bulk delete) ──

function rebuildFts(db) {
  db.exec(`
    DELETE FROM memories_fts;
    INSERT INTO memories_fts(rowid, body, tags, file_path)
      SELECT id, content, tags, file_path FROM memories;
    DELETE FROM memories_trigram;
    INSERT INTO memories_trigram(rowid, body, tags)
      SELECT id, content, tags FROM memories;
  `);
}

// ── Insert ──

export function insertMemory({ session_id, tool_name, type, project, file_path, content, tags, importance }) {
  getDb();
  return stmt('insert').run(session_id, tool_name, type, project, file_path, content, tags || '', importance || 2);
}

// ── Dedup check ──

export function isDuplicate(session_id, content, windowSec = 60) {
  getDb();
  const row = stmt('dedup').get(session_id, content, `-${windowSec} seconds`);
  return !!row;
}

// ── Search (3-tier fallback) ──

export function search(query, { project, limit = 20 } = {}) {
  const db = getDb();
  const projectFilter = project ? `AND m.project = ?` : '';
  const params = project ? [project] : [];

  // 1) FTS5 unicode61 (word-boundary, best for English)
  let results = db.prepare(`
    SELECT m.*, rank
    FROM memories_fts f
    JOIN memories m ON m.id = f.rowid
    WHERE memories_fts MATCH ?
    ${projectFilter}
    ORDER BY rank
    LIMIT ?
  `).all(ftsEscape(query), ...params, limit);

  if (results.length > 0) return results;

  // 2) FTS5 trigram (substring, good for Korean)
  try {
    results = db.prepare(`
      SELECT m.*, rank
      FROM memories_trigram t
      JOIN memories m ON m.id = t.rowid
      WHERE memories_trigram MATCH ?
      ${projectFilter}
      ORDER BY rank
      LIMIT ?
    `).all(trigramEscape(query), ...params, limit);

    if (results.length > 0) return results;
  } catch (_) { /* trigram may fail on very short queries */ }

  // 3) LIKE fallback
  results = db.prepare(`
    SELECT * FROM memories m
    WHERE (m.content LIKE ? OR m.tags LIKE ? OR m.file_path LIKE ?)
    ${projectFilter}
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(`%${query}%`, `%${query}%`, `%${query}%`, ...params, limit);

  return results;
}

function ftsEscape(q) {
  return q.trim().split(/\s+/).map(t => `"${t.replace(/"/g, '""')}"`).join(' ');
}

function trigramEscape(q) {
  return `"${q.replace(/"/g, '""')}"`;
}

// ── Recent memories ──

export function getRecent({ project, limit = 20, importance } = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (project) { conditions.push('project = ?'); params.push(project); }
  if (importance) { conditions.push('importance >= ?'); params.push(importance); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`
    SELECT * FROM memories ${where}
    ORDER BY created_at DESC LIMIT ?
  `).all(...params, limit);
}

// ── Session summaries ──

export function upsertSummary({ session_id, project, summary, tools_used, files_changed, memory_count, duration_sec }) {
  getDb();
  return stmt('upsertSummary').run(session_id, project, summary, tools_used, files_changed, memory_count, duration_sec);
}

export function getRecentSummaries({ project, limit = 5 } = {}) {
  const db = getDb();
  const where = project ? 'WHERE project = ?' : '';
  const params = project ? [project, limit] : [limit];
  return db.prepare(`
    SELECT * FROM session_summaries ${where}
    ORDER BY updated_at DESC LIMIT ?
  `).all(...params);
}

// ── Stats ──

export function getStats() {
  const db = getDb();
  const total = db.prepare('SELECT count(*) as cnt FROM memories').get();
  const byProject = db.prepare(`
    SELECT project, count(*) as cnt FROM memories GROUP BY project ORDER BY cnt DESC
  `).all();
  const byType = db.prepare(`
    SELECT type, count(*) as cnt FROM memories GROUP BY type ORDER BY cnt DESC
  `).all();
  const byImportance = db.prepare(`
    SELECT importance, count(*) as cnt FROM memories GROUP BY importance ORDER BY importance DESC
  `).all();
  const sessions = db.prepare('SELECT count(*) as cnt FROM session_summaries').get();
  const dbSize = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get();

  return { total: total.cnt, sessions: sessions.cnt, byProject, byType, byImportance, dbSizeBytes: dbSize.size };
}

// ── Cleanup (with FTS rebuild) ──

export function cleanupOld(days = 90) {
  getDb();
  const result = stmt('cleanup').run(`-${days} days`);

  if (result.changes > 0) {
    rebuildFts(_db);
  }

  return result.changes;
}

// ── Get session memories (for stop.mjs) ──

export function getSessionMemories(sessionId) {
  getDb();
  return stmt('sessionMemories').all(sessionId);
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
    Object.keys(_stmts).forEach(k => delete _stmts[k]);
  }
}
