/**
 * PostgreSQL connection pool + migration runner.
 * Used for chat rooms only (v3.0 dual DB strategy).
 * Existing SQLite code is untouched.
 */

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pool: Pool | null = null;

export function getPgPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set. Chat rooms require PostgreSQL.');
    }
    pool = new Pool({
      connectionString,
      max: 20,               // connection pool size
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('[pg] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

/** Graceful shutdown — call from process exit handler. */
export async function closePgPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[pg] Pool closed.');
  }
}

/** Check if PG is configured (DATABASE_URL exists). */
export function isPgEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}

/**
 * Initialize PG: create _migrations table, run extensions, apply pending migrations.
 * Safe to call multiple times (idempotent).
 */
export async function initPg(): Promise<void> {
  if (!isPgEnabled()) {
    console.log('[pg] DATABASE_URL not set — chat rooms disabled.');
    return;
  }

  const p = getPgPool();

  // Test connection
  try {
    const res = await p.query('SELECT NOW()');
    console.log(`[pg] Connected to PostgreSQL at ${new Date(res.rows[0].now).toISOString()}`);
  } catch (err: any) {
    console.error(`[pg] Connection failed: ${err.message}`);
    throw err;
  }

  // Ensure _migrations table
  await p.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      version    TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Ensure extensions (requires superuser or pre-created)
  try {
    await p.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await p.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);
  } catch (err: any) {
    // Extensions may already exist or require superuser — log but don't fail
    console.warn(`[pg] Extension warning (safe to ignore if already created): ${err.message}`);
  }

  // Run pending migrations
  const { rows: applied } = await p.query('SELECT version FROM _migrations');
  const appliedSet = new Set(applied.map((r: { version: string }) => r.version));

  const migrationDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationDir)) {
    console.log('[pg] No migrations directory found — skipping.');
    return;
  }

  const files = fs.readdirSync(migrationDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = file.split('_')[0]; // "001" from "001_chat_rooms.sql"
    if (appliedSet.has(version)) continue;

    const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO _migrations (version, name) VALUES ($1, $2)',
        [version, file],
      );
      await client.query('COMMIT');
      console.log(`[pg-migration] ✅ ${file}`);
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error(`[pg-migration] ❌ ${file}: ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  }

  const pendingCount = files.filter(f => !appliedSet.has(f.split('_')[0])).length;
  if (pendingCount === 0) {
    console.log('[pg] All migrations up to date.');
  }
}
