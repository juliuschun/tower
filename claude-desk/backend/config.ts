import path from 'path';

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
  claudeExecutable: process.env.CLAUDE_PATH || '/home/azureuser/.local/bin/claude',
  defaultCwd: process.env.DEFAULT_CWD || process.cwd(),
  permissionMode: (process.env.PERMISSION_MODE || 'bypassPermissions') as PermissionMode,

  // Concurrency
  maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS || '3'),

  // Auth
  jwtSecret: process.env.JWT_SECRET || 'claude-desk-secret-change-me',
  authEnabled: process.env.NO_AUTH !== 'true',
  tokenExpiry: '24h',

  // File system
  workspaceRoot: process.env.WORKSPACE_ROOT || '/home/azureuser',
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
