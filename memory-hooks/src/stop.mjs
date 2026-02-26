#!/usr/bin/env node

/**
 * Stop hook (sync) — aggregates session memories into a summary.
 * No LLM, pure structural aggregation.
 */

import { getSessionMemories, upsertSummary, closeDb } from './db.mjs';
import { basename } from 'path';

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
    const input = await readStdin();
    const sessionId = input?.session_id || process.env.CLAUDE_SESSION_ID;
    const project = basename(process.env.CLAUDE_PROJECT_DIR || process.cwd());

    // Skip if no valid session ID — prevents cross-session pollution
    if (!sessionId) {
      closeDb();
      return;
    }

    // Get all memories for this session
    const memories = getSessionMemories(sessionId);

    if (memories.length === 0) {
      closeDb();
      return;
    }

    // Aggregate
    const tools = new Set();
    const files = new Set();
    const errors = [];
    const commands = [];

    for (const m of memories) {
      if (m.tool_name) tools.add(m.tool_name);
      if (m.file_path) files.add(basename(m.file_path));
      if (m.type === 'error') errors.push(m.content?.slice(0, 100) || '');
      if (m.type === 'command' && m.content) {
        const cmd = m.content.match(/^\$ (.+?)(\n|$)/)?.[1];
        if (cmd) commands.push(cmd.slice(0, 80));
      }
    }

    // Compute duration
    const first = memories[0]?.created_at;
    const last = memories[memories.length - 1]?.created_at;
    const durationSec = first && last
      ? Math.round((new Date(last) - new Date(first)) / 1000)
      : 0;

    // Build summary
    const parts = [];

    const fileArr = [...files];
    if (fileArr.length > 0) {
      parts.push(`Edited ${fileArr.length} files: ${fileArr.slice(0, 5).join(', ')}${fileArr.length > 5 ? '...' : ''}`);
    }

    if (commands.length > 0) {
      parts.push(`Commands: ${commands.slice(0, 3).join('; ')}${commands.length > 3 ? '...' : ''}`);
    }

    if (errors.length > 0) {
      parts.push(`Errors (${errors.length}): ${errors[0]}`);
    }

    parts.push(`[${memories.length} observations, ${durationSec}s, tools: ${[...tools].join('/')}]`);

    const summary = parts.join('\n');

    upsertSummary({
      session_id: sessionId,
      project,
      summary,
      tools_used: JSON.stringify([...tools]),
      files_changed: JSON.stringify(fileArr),
      memory_count: memories.length,
      duration_sec: durationSec,
    });

    closeDb();
  } catch (err) {
    process.stderr.write(`[memory-hook] stop error: ${err.message}\n`);
    process.exit(0);
  }
}

main();
