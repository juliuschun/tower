import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import os from 'os';
import fs from 'fs';

// Resolve project root from source file location (not process.cwd())
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dev: packages/backend/config.ts → ../..  |  prod: dist/backend/packages/backend/config.js → ../../../..
const PROJECT_ROOT = __dirname.includes('dist')
  ? path.resolve(__dirname, '..', '..', '..', '..')
  : path.resolve(__dirname, '..', '..');

// Load .env file — provides defaults, inline env vars (from package.json scripts) take precedence
try {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx);
      const value = trimmed.slice(eqIdx + 1);
      // Don't override existing env vars (inline vars from dev script take precedence)
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
} catch {}

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

/** Centralized model config — read from backend/models.json */
const MODELS_JSON_PATH = path.join(PROJECT_ROOT, 'packages', 'backend', 'models.json');

export interface ModelDefaults {
  session: string;
  ai_reply: string;
  ai_task: string;
}

interface ModelsFile {
  claude: Array<{ id: string; name: string; badge: string; enabled: boolean }>;
  pi: Array<{ provider: string; modelId: string; name: string; badge: string; enabled: boolean }>;
  local?: Array<{ id: string; name: string; badge: string; enabled: boolean }>;
  defaults?: ModelDefaults;
}

export function loadModelsFile(): ModelsFile {
  try {
    return JSON.parse(fs.readFileSync(MODELS_JSON_PATH, 'utf8'));
  } catch {
    return { claude: [], pi: [] };
  }
}

export function saveModelsFile(data: ModelsFile): void {
  fs.writeFileSync(MODELS_JSON_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function loadClaudeModels(): ModelInfo[] {
  return loadModelsFile().claude
    .filter(m => m.enabled)
    .map(m => ({ id: m.id, name: m.name, badge: m.badge }));
}

function loadPiModels(): ModelInfo[] {
  return loadModelsFile().pi
    .filter(m => m.enabled)
    .map(m => ({
      id: `pi:${m.provider}/${m.modelId}`,
      name: m.name,
      badge: m.badge || m.provider.toUpperCase().slice(0, 2),
    }));
}

function loadLocalModels(): ModelInfo[] {
  return (loadModelsFile().local || [])
    .filter(m => m.enabled)
    .map(m => ({
      id: `local:${m.id}`,
      name: m.name,
      badge: m.badge || 'LOCAL',
    }));
}

export let availableModels: ModelInfo[] = loadClaudeModels();

const DEFAULT_MODEL_DEFAULTS: ModelDefaults = {
  session: 'claude-opus-4-6',
  ai_reply: 'claude-haiku-4-5-20251001',
  ai_task: 'claude-sonnet-4-6',
};

/** Get admin-configured default models per context */
export function getModelDefaults(): ModelDefaults {
  const file = loadModelsFile();
  return file.defaults ?? DEFAULT_MODEL_DEFAULTS;
}

/** Reload models from JSON file — call after admin edits */
export function reloadModels(): { claude: ModelInfo[]; pi: ModelInfo[]; local: ModelInfo[]; defaults: ModelDefaults } {
  availableModels = loadClaudeModels();
  config.piModels = loadPiModels();
  config.localModels = loadLocalModels();
  return { claude: availableModels, pi: config.piModels, local: config.localModels, defaults: getModelDefaults() };
}

export const config = {
  port: parseInt(process.env.PORT || '32354'),
  host: process.env.HOST || '0.0.0.0',

  // Claude SDK
  claudeExecutable: findClaudeExecutable(),
  defaultCwd: process.env.DEFAULT_CWD || process.cwd(),
  permissionMode: (process.env.PERMISSION_MODE || 'bypassPermissions') as PermissionMode,

  // Concurrency
  maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS || '30'),

  // Auth
  jwtSecret: process.env.JWT_SECRET || 'tower-secret-change-me',
  authEnabled: process.env.NO_AUTH !== 'true',
  tokenExpiry: '24h',

  // File system
  workspaceRoot: process.env.WORKSPACE_ROOT || os.homedir(),
  hiddenPatterns: ['.git', 'node_modules', '__pycache__', '.venv', '.env', '.DS_Store'],

  // DB — use PROJECT_ROOT so path is stable regardless of cwd
  dbPath: process.env.DB_PATH || path.join(PROJECT_ROOT, 'data', 'tower.db'),

  // Sandbox (Linux only, requires: apt install bubblewrap)
  sandboxEnabled: process.env.SANDBOX_ENABLED === 'true',

  // Git auto-commit
  gitAutoCommit: process.env.GIT_AUTO_COMMIT !== 'false',

  // Engine
  defaultEngine: process.env.DEFAULT_ENGINE || 'claude',
  piEnabled: process.env.PI_ENABLED === 'true',
  piModels: loadPiModels(),
  localEnabled: process.env.LOCAL_LLM_ENABLED === 'true',
  localModels: loadLocalModels(),
  localLlmBaseUrl: process.env.LOCAL_LLM_BASE_URL || 'http://localhost:8080',
  localLlmApiKey: process.env.LOCAL_LLM_API_KEY || '',
  localLlmDefaultModel: process.env.LOCAL_LLM_DEFAULT_MODEL || '',

  // Frontend (for production)
  frontendDir: path.join(PROJECT_ROOT, 'dist', 'frontend'),

  // Public URL — used for generating shareable links (e.g. https://your-domain.example.com)
  // If not set, share links use window.location.origin (fallback, can be wrong domain)
  publicUrl: process.env.PUBLIC_URL?.replace(/\/$/, '') || '',

  // Kakao OAuth
  kakaoRestKey: process.env.KAKAO_REST_KEY || '',
  kakaoClientSecret: process.env.KAKAO_CLIENT_SECRET || '',
  kakaoRedirectUri: process.env.KAKAO_REDIRECT_URI || '',

  // Telegram Bot
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',

  // Server epoch — changes on each restart, used to detect server restarts
  serverEpoch: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
};

export function validateConfig() {
  const INSECURE = ['tower-secret-change-me', 'change-me-to-a-random-secret', ''];
  if (config.authEnabled && INSECURE.includes(config.jwtSecret)) {
    console.error('\n[FATAL] JWT_SECRET is not set or uses the default placeholder.');
    console.error('  Run: openssl rand -hex 32');
    console.error('  Then set JWT_SECRET in .env\n');
    process.exit(1);
  }
}

export function getPermissionMode(role?: string): PermissionMode {
  switch (role) {
    case 'admin':    return 'bypassPermissions';
    case 'operator': return 'bypassPermissions';
    case 'member':   return 'acceptEdits';
    case 'viewer':   return 'plan';
    case 'user':     return 'acceptEdits'; // legacy backward-compat
    default:         return config.permissionMode;
  }
}

