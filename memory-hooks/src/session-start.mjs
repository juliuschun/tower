#!/usr/bin/env node

/**
 * SessionStart hook (sync) — injects recent memory context to Claude.
 * Outputs to stdout which becomes additionalContext.
 * Runs 90-day cleanup at most once per day (throttled).
 */

import { getDb, getRecentSummaries, getRecent, cleanupOld, closeDb } from './db.mjs';
import { basename, join } from 'path';
import { homedir } from 'os';
import { readFileSync, writeFileSync } from 'fs';

const CLEANUP_MARKER = join(homedir(), '.claude', 'memory_last_cleanup');

function truncate(str, maxLen = 200) {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen) + '...';
}

function formatDate(iso) {
  if (!iso) return '?';
  return iso.slice(0, 10);
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shouldRunCleanup() {
  try {
    const last = readFileSync(CLEANUP_MARKER, 'utf8').trim();
    const lastDate = new Date(last);
    const now = new Date();
    // Run at most once per day
    return (now - lastDate) > 24 * 60 * 60 * 1000;
  } catch {
    return true; // marker doesn't exist yet
  }
}

function markCleanupDone() {
  try { writeFileSync(CLEANUP_MARKER, new Date().toISOString()); } catch { /* ignore */ }
}

function main() {
  try {
    const db = getDb();
    const project = basename(process.env.CLAUDE_PROJECT_DIR || process.cwd());

    // Throttled cleanup — at most once per day, not every session
    let cleaned = 0;
    if (shouldRunCleanup()) {
      cleaned = cleanupOld(90);
      markCleanupDone();
    }

    // 1. Recent session summaries (last 3)
    const summaries = getRecentSummaries({ project, limit: 3 });

    // 2. Recent important memories (importance >= 2, last 10)
    const important = getRecent({ project, limit: 10, importance: 2 });

    // 3. Recent errors (importance = 3, last 5)
    const errors = getRecent({ project, limit: 5, importance: 3 });

    // Build output — keep under 2KB
    const lines = [];
    lines.push(`<memory-context project="${escapeXml(project)}">`);

    if (summaries.length > 0) {
      lines.push('## Recent Sessions');
      for (const s of summaries) {
        const files = s.files_changed ? JSON.parse(s.files_changed) : [];
        const fileStr = files.length > 0 ? `: ${files.slice(0, 5).join(', ')}` : '';
        lines.push(`- [${formatDate(s.updated_at)}] ${truncate(s.summary, 150)}${fileStr}`);
      }
    }

    if (important.length > 0) {
      lines.push('## Recent Changes');
      const seen = new Set();
      for (const m of important) {
        const key = m.file_path || m.content?.slice(0, 50);
        if (seen.has(key)) continue;
        seen.add(key);
        const prefix = m.file_path ? `[${basename(m.file_path)}] ` : '';
        lines.push(`- ${prefix}${truncate(m.content, 200)}`);
      }
    }

    if (errors.length > 0) {
      lines.push('## Recent Errors');
      for (const e of errors) {
        lines.push(`- [${formatDate(e.created_at)}] ${truncate(e.content, 200)}`);
      }
    }

    if (cleaned > 0) {
      lines.push(`\n_Cleaned ${cleaned} old memories (>90 days)._`);
    }

    lines.push('</memory-context>');

    // Only output if there's actual content
    if (summaries.length > 0 || important.length > 0 || errors.length > 0) {
      process.stdout.write(lines.join('\n'));
    }

    closeDb();
  } catch (err) {
    // Log to stderr for debugging, never block session startup
    process.stderr.write(`[memory-hook] session-start error: ${err.message}\n`);
    process.exit(0);
  }
}

main();
