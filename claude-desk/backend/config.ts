import path from 'path';

export const config = {
  port: parseInt(process.env.PORT || '32354'),
  host: process.env.HOST || '0.0.0.0',

  // Claude SDK
  claudeExecutable: process.env.CLAUDE_PATH || '/home/azureuser/.local/bin/claude',
  defaultCwd: process.env.DEFAULT_CWD || process.cwd(),
  permissionMode: (process.env.PERMISSION_MODE || 'bypassPermissions') as 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan',

  // Auth
  jwtSecret: process.env.JWT_SECRET || 'claude-desk-secret-change-me',
  authEnabled: process.env.NO_AUTH !== 'true',
  tokenExpiry: '24h',

  // File system
  workspaceRoot: process.env.WORKSPACE_ROOT || '/home/azureuser',
  hiddenPatterns: ['.git', 'node_modules', '__pycache__', '.venv', '.env', '.DS_Store'],

  // DB
  dbPath: process.env.DB_PATH || path.join(process.cwd(), 'data', 'claude-desk.db'),

  // Frontend (for production)
  frontendDir: path.join(process.cwd(), 'dist', 'frontend'),
};
