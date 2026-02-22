import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import fs from 'fs';

function findClaudeExecutable(): string {
  if (process.env.CLAUDE_PATH) return process.env.CLAUDE_PATH;

  try {
    const result = execSync('which claude', { encoding: 'utf-8', timeout: 5000 }).trim();
    if (result) return result;
  } catch {}

  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }

  return path.join(home, '.local', 'bin', 'claude');
}

type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export interface ModelInfo {
  id: string;
  name: string;
  badge: string;
}

export const availableModels: ModelInfo[] = [
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', badge: 'MAX' },
  { id: 'claude-opus-4-6', name: 'Opus 4.6', badge: 'MAX' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', badge: 'MAX' },
];

export const config = {
  port: parseInt(process.env.PORT || '32354'),
  host: process.env.HOST || '0.0.0.0',

  // Claude SDK
  claudeExecutable: findClaudeExecutable(),
  defaultCwd: process.env.DEFAULT_CWD || process.cwd(),
  permissionMode: (process.env.PERMISSION_MODE || 'bypassPermissions') as PermissionMode,

  // Concurrency
  maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS || '3'),

  // Auth
  jwtSecret: process.env.JWT_SECRET || 'claude-desk-secret-change-me',
  authEnabled: process.env.NO_AUTH !== 'true',
  tokenExpiry: '24h',

  // File system
  workspaceRoot: process.env.WORKSPACE_ROOT || os.homedir(),
  hiddenPatterns: ['.git', 'node_modules', '__pycache__', '.venv', '.env', '.DS_Store'],

  // DB
  dbPath: process.env.DB_PATH || path.join(process.cwd(), 'data', 'claude-desk.db'),

  // Git auto-commit
  gitAutoCommit: process.env.GIT_AUTO_COMMIT !== 'false',

  // Frontend (for production)
  frontendDir: path.join(process.cwd(), 'dist', 'frontend'),

  // Server epoch — changes on each restart, used to detect server restarts
  serverEpoch: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
};

export function getPermissionMode(role?: string): PermissionMode {
  if (role === 'admin') return 'bypassPermissions';
  if (role === 'user') return 'acceptEdits';
  return config.permissionMode;
}
