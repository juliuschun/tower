#!/usr/bin/env node

/**
 * PostToolUse hook (async) — captures Edit/Write/Bash/NotebookEdit observations.
 * Reads hook input from stdin, filters noise, stores in SQLite.
 */

import { insertMemory, isDuplicate, closeDb } from './db.mjs';
import { basename } from 'path';

// ── Noise filters ──

const SKIP_PATHS = /\/(node_modules|\.git|dist|build|\.next|__pycache__|\.cache|\.venv)\//;
const SKIP_EXTENSIONS = /\.(map|lock|min\.js|min\.css|chunk\.)$/;

const SKIP_BASH_CMDS = /^\s*(ls|cat|head|tail|echo|pwd|cd|which|whoami|date|clear|true|false)\b/;
const IMPORTANT_BASH = /\b(git|npm|npx|yarn|pnpm|docker|kubectl|terraform|make|cargo|pip|poetry|bun)\b/;

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
    // Timeout — unref so it doesn't keep process alive
    const t = setTimeout(() => done(null), 2000);
    t.unref();
  });
}

function truncate(str, maxLen = 500) {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen) + `... [${str.length} chars]`;
}

function extractProject(input) {
  // Try to get project from cwd in tool_input or env
  const cwd = input?.tool_input?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return basename(cwd);
}

function processEdit(input) {
  const ti = input.tool_input || {};
  const filePath = ti.file_path || '';

  if (SKIP_PATHS.test(filePath) || SKIP_EXTENSIONS.test(filePath)) return null;

  const oldStr = ti.old_string || '';
  const newStr = ti.new_string || '';
  const content = oldStr && newStr
    ? `Edit ${filePath}: "${truncate(oldStr, 100)}" → "${truncate(newStr, 100)}"`
    : `Edit ${filePath}`;

  return {
    type: 'file_edit',
    file_path: filePath,
    content: truncate(content),
    importance: 2,
    tags: 'edit',
  };
}

function processWrite(input) {
  const ti = input.tool_input || {};
  const filePath = ti.file_path || '';

  if (SKIP_PATHS.test(filePath) || SKIP_EXTENSIONS.test(filePath)) return null;

  const fileContent = ti.content || '';
  const lines = fileContent.split('\n').length;
  const preview = fileContent.slice(0, 150).replace(/\n/g, ' ');

  return {
    type: 'file_edit',
    file_path: filePath,
    content: `Write ${filePath} (${lines} lines): ${preview}...`,
    importance: 2,
    tags: 'write',
  };
}

function processBash(input) {
  const ti = input.tool_input || {};
  const result = input.tool_result || {};
  const command = ti.command || '';
  const stdout = typeof result === 'string' ? result : (result.stdout || result.output || '');
  const stderr = typeof result === 'string' ? '' : (result.stderr || '');
  const exitCode = result.exit_code ?? result.exitCode ?? 0;

  // Skip trivial commands
  if (SKIP_BASH_CMDS.test(command)) return null;

  // Error — only when exit code is nonzero (stderr alone is often just warnings)
  if (exitCode !== 0) {
    return {
      type: 'error',
      file_path: '',
      content: truncate(`$ ${command}\nExit: ${exitCode}\n${stderr || stdout}`, 500),
      importance: 3,
      tags: 'error,bash',
    };
  }

  // Important commands
  if (IMPORTANT_BASH.test(command)) {
    return {
      type: 'command',
      file_path: '',
      content: truncate(`$ ${command}\n${stdout}`, 400),
      importance: 2,
      tags: 'bash,' + (command.match(IMPORTANT_BASH)?.[0] || ''),
    };
  }

  // Other non-trivial commands — low importance
  return {
    type: 'command',
    file_path: '',
    content: truncate(`$ ${command}`, 200),
    importance: 1,
    tags: 'bash',
  };
}

function processNotebook(input) {
  const ti = input.tool_input || {};
  const filePath = ti.notebook_path || '';

  if (SKIP_PATHS.test(filePath)) return null;

  const editMode = ti.edit_mode || 'replace';
  const cellNum = ti.cell_number ?? '?';

  return {
    type: 'file_edit',
    file_path: filePath,
    content: truncate(`Notebook ${editMode} cell ${cellNum} in ${filePath}: ${ti.new_source || ''}`, 400),
    importance: 2,
    tags: 'notebook',
  };
}

async function main() {
  const input = await readStdin();
  if (!input) process.exit(0);

  const toolName = input.tool_name || '';

  let record;
  switch (toolName) {
    case 'Edit': record = processEdit(input); break;
    case 'Write': record = processWrite(input); break;
    case 'Bash': record = processBash(input); break;
    case 'NotebookEdit': record = processNotebook(input); break;
    default: process.exit(0);
  }

  if (!record) process.exit(0);

  const sessionId = input.session_id || process.env.CLAUDE_SESSION_ID || 'unknown';
  const project = extractProject(input);

  // Dedup check
  if (isDuplicate(sessionId, record.content)) {
    closeDb();
    process.exit(0);
  }

  insertMemory({
    session_id: sessionId,
    tool_name: toolName,
    project,
    ...record,
  });

  closeDb();
}

main().catch((err) => {
  process.stderr.write(`[memory-hook] post-tool-use error: ${err.message}\n`);
  process.exit(0);
});
