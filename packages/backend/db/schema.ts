import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { extractTextFromContent } from '../utils/text.js';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dbDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      claude_session_id TEXT,
      name TEXT NOT NULL,
      cwd TEXT,
      tags TEXT DEFAULT '[]',
      favorite INTEGER DEFAULT 0,
      user_id INTEGER,
      total_cost REAL DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      parent_tool_use_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

    CREATE TABLE IF NOT EXISTS pins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL DEFAULT 'markdown',
      sort_order INTEGER DEFAULT 0,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS scripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      language TEXT DEFAULT 'python',
      session_id TEXT,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Migrate: add pin_type and content columns to pins table
  try {
    db.exec(`ALTER TABLE pins ADD COLUMN pin_type TEXT NOT NULL DEFAULT 'file'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE pins ADD COLUMN content TEXT`);
  } catch {}

  // Git commits table
  db.exec(`
    CREATE TABLE IF NOT EXISTS git_commits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL UNIQUE,
      short_hash TEXT NOT NULL,
      author_name TEXT NOT NULL,
      message TEXT NOT NULL,
      commit_type TEXT DEFAULT 'auto',
      session_id TEXT,
      user_id INTEGER,
      files_changed TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // User management migrations
  try { db.exec(`ALTER TABLE users ADD COLUMN disabled INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE users ADD COLUMN allowed_path TEXT DEFAULT ''`); } catch {}
  try { db.exec(`ALTER TABLE users ADD COLUMN password_plain TEXT DEFAULT ''`); } catch {}

  // Migrate legacy 'user' role → 'member' (4-tier role system)
  try { db.exec(`UPDATE users SET role = 'member' WHERE role = 'user'`); } catch {}

  // Phase 5 migrations
  const sessionMigrations = [
    `ALTER TABLE sessions ADD COLUMN model_used TEXT`,
    `ALTER TABLE sessions ADD COLUMN auto_named INTEGER DEFAULT 1`,
    `ALTER TABLE sessions ADD COLUMN summary TEXT`,
    `ALTER TABLE sessions ADD COLUMN summary_at_turn INTEGER`,
    `ALTER TABLE sessions ADD COLUMN turn_count INTEGER DEFAULT 0`,
    `ALTER TABLE sessions ADD COLUMN files_edited TEXT DEFAULT '[]'`,
    `ALTER TABLE sessions ADD COLUMN archived INTEGER DEFAULT 0`,
  ];
  for (const sql of sessionMigrations) {
    try { db.exec(sql); } catch {}
  }

  // Kanban tasks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      cwd TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      session_id TEXT,
      sort_order INTEGER DEFAULT 0,
      progress_summary TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      user_id INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
  `);

  // Kanban tasks migrations
  try { db.exec(`ALTER TABLE tasks ADD COLUMN model TEXT DEFAULT 'claude-opus-4-6'`); } catch {}
  try { db.exec(`ALTER TABLE tasks ADD COLUMN archived INTEGER DEFAULT 0`); } catch {}

  // Scheduled tasks migrations
  try { db.exec(`ALTER TABLE tasks ADD COLUMN scheduled_at TEXT`); } catch {}
  try { db.exec(`ALTER TABLE tasks ADD COLUMN schedule_cron TEXT`); } catch {}
  try { db.exec(`ALTER TABLE tasks ADD COLUMN schedule_enabled INTEGER DEFAULT 0`); } catch {}
  // Index for efficient scheduler tick queries
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_schedule ON tasks(schedule_enabled, scheduled_at) WHERE schedule_enabled = 1`);
  } catch {}

  // Workflow mode migrations
  try { db.exec(`ALTER TABLE tasks ADD COLUMN workflow TEXT DEFAULT 'auto'`); } catch {}
  try { db.exec(`ALTER TABLE tasks ADD COLUMN parent_task_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE tasks ADD COLUMN worktree_path TEXT`); } catch {}
  try { db.exec(`ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id)`); } catch {}
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL`);
  } catch {}

  // Chat room integration (v3.0 — cross-DB references to PG chat_rooms)
  try { db.exec(`ALTER TABLE tasks ADD COLUMN room_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE tasks ADD COLUMN triggered_by INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE tasks ADD COLUMN room_message_id TEXT`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_room ON tasks(room_id) WHERE room_id IS NOT NULL`); } catch {}

  // Messages turn-metrics migrations
  try { db.exec(`ALTER TABLE messages ADD COLUMN duration_ms INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE messages ADD COLUMN input_tokens INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE messages ADD COLUMN output_tokens INTEGER`); } catch {}

  // File sharing table
  db.exec(`
    CREATE TABLE IF NOT EXISTS shares (
      id              TEXT PRIMARY KEY,
      file_path       TEXT NOT NULL,
      owner_id        INTEGER NOT NULL,
      share_type      TEXT NOT NULL CHECK(share_type IN ('internal','external')),
      target_user_id  INTEGER,
      token           TEXT UNIQUE,
      expires_at      DATETIME,
      revoked         INTEGER DEFAULT 0,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (target_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
    CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner_id);
    CREATE INDEX IF NOT EXISTS idx_shares_target ON shares(target_user_id);
  `);

  // System prompts table (Phase 2: centralized prompt management)
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      prompt TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default system prompt if table is empty
  try {
    const promptCount = (db.prepare('SELECT COUNT(*) as cnt FROM system_prompts').get() as any).cnt;
    if (promptCount === 0) {
      db.prepare(`INSERT INTO system_prompts (name, prompt) VALUES (?, ?)`).run('default', [
        'You are the team\'s AI assistant.',
        '- Respond in Korean.',
        '- Always confirm with the user before deleting files.',
        '- Never output sensitive information such as .env, passwords, or API keys.',
        '- If you are unsure about something, say you don\'t know rather than guessing.',
      ].join('\n'));
    }
  } catch {}

  // FTS5 virtual tables for search (trigram tokenizer for Korean support)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE sessions_fts USING fts5(
        name, summary,
        content='',
        tokenize='trigram'
      );
    `);
  } catch {} // already exists

  try {
    db.exec(`
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        body, session_id UNINDEXED,
        content='',
        tokenize='trigram'
      );
    `);
  } catch {} // already exists

  // Populate FTS from existing data (idempotent — only runs if FTS is empty)
  const ftsCount = (db.prepare('SELECT count(*) as cnt FROM sessions_fts').get() as any).cnt;
  if (ftsCount === 0) {
    const sessionCount = (db.prepare('SELECT count(*) as cnt FROM sessions').get() as any).cnt;
    if (sessionCount > 0) {
      db.exec(`
        INSERT INTO sessions_fts(rowid, name, summary)
          SELECT rowid, name, COALESCE(summary, '') FROM sessions;
      `);
      console.log('[db] sessions_fts populated from existing data');
    }
  }

  const msgFtsCount = (db.prepare('SELECT count(*) as cnt FROM messages_fts').get() as any).cnt;
  if (msgFtsCount === 0) {
    populateMessagesFts(db);
  }

  // ── Group permissions (부서별 접근 제어) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      is_global INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_groups (
      user_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, group_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    );
  `);

  // ── Projects table ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      root_path TEXT,
      color TEXT DEFAULT '#f59e0b',
      sort_order INTEGER DEFAULT 0,
      collapsed INTEGER DEFAULT 0,
      archived INTEGER DEFAULT 0,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // ── Project members (직접 멤버십) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id  TEXT    NOT NULL,
      user_id     INTEGER NOT NULL,
      role        TEXT    NOT NULL DEFAULT 'member',
      added_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, user_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pm_user ON project_members(user_id);
  `);

  // ── Migrate project_groups → project_members (one-time) ──
  _migrateProjectGroupsToMembers(db);

  // Add project_id FK to sessions
  try { db.exec(`ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id)`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)`); } catch {}

  // ── Skill Registry (3-tier: company / project / personal) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_registry (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('company','project','personal')),
      project_id TEXT,
      user_id INTEGER,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'general',
      content TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      source TEXT DEFAULT 'bundled',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_scope_name
      ON skill_registry(name, scope, COALESCE(project_id,''), COALESCE(user_id, 0));
    CREATE INDEX IF NOT EXISTS idx_skill_project ON skill_registry(project_id) WHERE project_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_skill_user ON skill_registry(user_id) WHERE user_id IS NOT NULL;
  `);
  // Migration: add skill_path for filesystem-backed skills (plugins, etc.)
  try { db.exec(`ALTER TABLE skill_registry ADD COLUMN skill_path TEXT`); } catch {}

  // ── User skill preferences (per-user toggle for company/project skills) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_skill_prefs (
      user_id   INTEGER NOT NULL,
      skill_id  TEXT NOT NULL,
      enabled   INTEGER DEFAULT 1,
      PRIMARY KEY (user_id, skill_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skill_registry(id) ON DELETE CASCADE
    );
  `);

  // ── Engine support ──
  try { db.exec(`ALTER TABLE sessions ADD COLUMN engine TEXT DEFAULT 'claude'`); } catch {}

  // ── Unified visibility + AI Panel ──
  try { db.exec(`ALTER TABLE sessions ADD COLUMN visibility TEXT DEFAULT 'private'`); } catch {}
  try { db.exec(`ALTER TABLE sessions ADD COLUMN room_id TEXT`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_room ON sessions(room_id) WHERE room_id IS NOT NULL`); } catch {}

  // ── Session identity: UNIQUE claude_session_id (Tower = SSOT) ──
  // 1. Normalize empty strings → NULL
  db.exec(`UPDATE sessions SET claude_session_id = NULL WHERE claude_session_id = ''`);

  // 2. Resolve duplicates: for each duplicated claude_session_id,
  //    keep the one with higher turn_count, NULL the rest
  const dupes = db.prepare(`
    SELECT claude_session_id FROM sessions
    WHERE claude_session_id IS NOT NULL
    GROUP BY claude_session_id HAVING COUNT(*) > 1
  `).all() as { claude_session_id: string }[];

  if (dupes.length > 0) {
    const clearDupe = db.prepare(`
      UPDATE sessions SET claude_session_id = NULL
      WHERE claude_session_id = ? AND id != ?
    `);
    const findWinner = db.prepare(`
      SELECT id, tags, turn_count FROM sessions
      WHERE claude_session_id = ?
      ORDER BY turn_count DESC, updated_at DESC
    `);

    const dedupTx = db.transaction(() => {
      for (const { claude_session_id } of dupes) {
        const rows = findWinner.all(claude_session_id) as { id: string; tags: string; turn_count: number }[];
        if (rows.length < 2) continue;

        // Prefer non-CLI session (Tower-created) as the winner
        let winnerId = rows[0].id;
        for (const row of rows) {
          const tags = JSON.parse(row.tags || '[]');
          if (!tags.includes('cli')) {
            winnerId = row.id;
            break;
          }
        }
        clearDupe.run(claude_session_id, winnerId);
      }
    });
    dedupTx();
    console.log(`[db] Resolved ${dupes.length} duplicate claude_session_id(s)`);
  }

  // 3. Create UNIQUE INDEX (partial — NULL values are excluded)
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_claude_sid
        ON sessions(claude_session_id) WHERE claude_session_id IS NOT NULL
    `);
  } catch {}
}

/**
 * One-time migration: project_groups + user_groups → project_members, then DROP project_groups.
 * Also migrates is_global group members to all projects.
 */
function _migrateProjectGroupsToMembers(db: Database.Database) {
  // Check if project_groups table still exists
  const hasTable = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_groups'`
  ).get();
  if (!hasTable) return; // Already migrated

  console.log('[db] Migrating project_groups → project_members...');

  const tx = db.transaction(() => {
    // 1. Copy project_groups + user_groups → project_members
    db.exec(`
      INSERT OR IGNORE INTO project_members (project_id, user_id, role)
      SELECT pg.project_id, ug.user_id, 'member'
      FROM project_groups pg
      JOIN user_groups ug ON pg.group_id = ug.group_id
    `);

    // 2. Global group members → all non-archived projects
    db.exec(`
      INSERT OR IGNORE INTO project_members (project_id, user_id, role)
      SELECT p.id, ug.user_id, 'member'
      FROM projects p
      CROSS JOIN user_groups ug
      JOIN groups g ON g.id = ug.group_id
      WHERE g.is_global = 1 AND p.archived = 0
    `);

    // 3. Project creators → owner
    db.exec(`
      INSERT OR IGNORE INTO project_members (project_id, user_id, role)
      SELECT id, user_id, 'owner'
      FROM projects WHERE user_id IS NOT NULL
    `);

    // 4. For creators already inserted as 'member', upgrade to 'owner'
    db.exec(`
      UPDATE project_members SET role = 'owner'
      WHERE (project_id, user_id) IN (
        SELECT id, user_id FROM projects WHERE user_id IS NOT NULL
      ) AND role = 'member'
    `);

    // 5. Drop project_groups
    db.exec(`DROP TABLE IF EXISTS project_groups`);
  });

  tx();
  console.log('[db] Migration complete: project_groups dropped, project_members populated');
}

function populateMessagesFts(db: Database.Database) {
  const rows = db.prepare(
    `SELECT rowid, session_id, content FROM messages WHERE role IN ('user', 'assistant')`
  ).all() as { rowid: number; session_id: string; content: string }[];

  if (rows.length === 0) return;

  const insert = db.prepare(
    'INSERT INTO messages_fts(rowid, body, session_id) VALUES (?, ?, ?)'
  );

  let count = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const text = extractTextFromContent(row.content);
      if (text.trim()) {
        insert.run(row.rowid, text, row.session_id);
        count++;
      }
    }
  });
  tx();
  if (count > 0) {
    console.log(`[db] messages_fts populated: ${count} messages indexed`);
  }
}

export function closeDb() {
  if (db) {
    db.close();
  }
}
