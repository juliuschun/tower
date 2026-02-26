#!/usr/bin/env node

/**
 * Manual search utility — can be called from /memory command or CLI.
 *
 * Usage:
 *   node search.mjs <query>           — FTS search
 *   node search.mjs --recent [N]      — last N memories (default 20)
 *   node search.mjs --stats           — database statistics
 *   node search.mjs --summaries [N]   — last N session summaries
 */

import { search, getRecent, getStats, getRecentSummaries, closeDb } from './db.mjs';
import { basename } from 'path';

function formatMemory(m) {
  const date = m.created_at?.slice(0, 16) || '?';
  const imp = m.importance === 3 ? ' [!]' : '';
  const file = m.file_path ? ` (${basename(m.file_path)})` : '';
  return `[${date}] ${m.type}${imp}${file}: ${m.content?.slice(0, 300) || ''}`;
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node search.mjs <query> | --recent [N] | --stats | --summaries [N]');
    process.exit(0);
  }

  const project = basename(process.env.CLAUDE_PROJECT_DIR || process.cwd());

  if (args[0] === '--recent') {
    const limit = parseInt(args[1]) || 20;
    const results = getRecent({ project, limit });
    if (results.length === 0) {
      console.log('No memories found.');
    } else {
      console.log(`Recent ${results.length} memories (project: ${project}):\n`);
      results.forEach(m => console.log(formatMemory(m)));
    }
  }
  else if (args[0] === '--stats') {
    const stats = getStats();
    console.log(`Memory Stats:`);
    console.log(`  Total memories: ${stats.total}`);
    console.log(`  Total sessions: ${stats.sessions}`);
    console.log(`  DB size: ${(stats.dbSizeBytes / 1024).toFixed(1)} KB`);
    console.log(`\nBy project:`);
    stats.byProject.forEach(p => console.log(`  ${p.project}: ${p.cnt}`));
    console.log(`\nBy type:`);
    stats.byType.forEach(t => console.log(`  ${t.type}: ${t.cnt}`));
    console.log(`\nBy importance:`);
    stats.byImportance.forEach(i => console.log(`  ${i.importance === 3 ? 'High' : i.importance === 2 ? 'Medium' : 'Low'}: ${i.cnt}`));
  }
  else if (args[0] === '--summaries') {
    const limit = parseInt(args[1]) || 10;
    const summaries = getRecentSummaries({ project, limit });
    if (summaries.length === 0) {
      console.log('No session summaries found.');
    } else {
      console.log(`Recent ${summaries.length} sessions (project: ${project}):\n`);
      summaries.forEach(s => {
        const files = s.files_changed ? JSON.parse(s.files_changed) : [];
        console.log(`[${s.updated_at?.slice(0, 16)}] session:${s.session_id?.slice(0, 8)}...`);
        console.log(`  ${s.summary}`);
        if (files.length > 0) console.log(`  Files: ${files.join(', ')}`);
        console.log();
      });
    }
  }
  else {
    // FTS search
    const query = args.join(' ');
    const results = search(query, { project });
    if (results.length === 0) {
      console.log(`No results for "${query}".`);
    } else {
      console.log(`Found ${results.length} results for "${query}":\n`);
      results.forEach(m => console.log(formatMemory(m)));
    }
  }

  closeDb();
}

main();
