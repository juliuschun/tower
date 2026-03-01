import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';

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
}

export function closeDb() {
  if (db) {
    db.close();
  }
}
