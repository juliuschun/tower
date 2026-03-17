import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { config, validateConfig } from './config.js';
import apiRouter from './routes/api.js';
import { setupWebSocket, broadcastToAll } from './routes/ws-handler.js';
// SQLite closeDb removed — all data now in PG (closePgPool handles shutdown)
import { initPg, closePgPool, isPgEnabled } from './db/pg.js';
import { stopFileWatcher } from './services/file-system.js';
import { initWorkspaceRepo } from './services/git-manager.js';
import { resumeOrphanedTaskMonitoring, hasMonitoredTasks, stopAllMonitors } from './services/task-runner.js';
import { cleanupOrphanedSdkProcesses, stopOrphanMonitor, gracefulShutdown } from './services/claude-sdk.js';
import { startScheduler, stopScheduler } from './services/task-scheduler.js';
import { cleanupStaleSessions } from './services/session-manager.js';
import { seedBundledSkills, seedPluginSkills, syncCompanySkillsToFs } from './services/skill-registry.js';

// CRITICAL: Remove CLAUDECODE env var before anything else
delete process.env.CLAUDECODE;

// Refuse to start with insecure JWT secret
validateConfig();

const app = express();
app.set('trust proxy', 1); // trust first proxy (Cloudflare) — correct IP for rate limiting
app.use(helmet({
  contentSecurityPolicy: false,       // breaks Vite HMR + inline scripts
  crossOriginEmbedderPolicy: false,   // breaks iframe embeds
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max: 20,                    // 20 attempts per window per IP
  message: { error: 'Too many attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth', authLimiter);

// API routes
app.use('/api', apiRouter);

// Serve frontend in production
const frontendPath = config.frontendDir;
if (fs.existsSync(frontendPath)) {
  // sw.js & index.html must never be cached — ensures PWA updates propagate immediately
  // CDN-Bypass: Cloudflare respects CDN-Cache-Control separately from browser Cache-Control
  app.get('/sw.js', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(frontendPath, 'sw.js'));
  });
  app.use(express.static(frontendPath, {
    setHeaders: (res, filePath) => {
      // Hashed assets (e.g. index-DRQj5zgr.js) can be cached forever; everything else gets revalidation
      if (filePath.includes('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

const server = http.createServer(app);
setupWebSocket(server);

// Initialize workspace git repo
initWorkspaceRepo(config.workspaceRoot).catch((err) => {
  console.error('[Git] Failed to initialize workspace repo:', err);
});

server.listen(config.port, config.host, async () => {
  console.log(`
╔══════════════════════════════════════════╗
║         Tower v0.1.0                    ║
║                                          ║
║  http://localhost:${config.port}              ║
║  Auth: ${config.authEnabled ? 'enabled' : 'disabled'}                          ║
║  CWD: ${config.defaultCwd.slice(0, 30)}  ║
╚══════════════════════════════════════════╝
  `);

  // Initialize PostgreSQL (restart trigger) (chat rooms — v3.0 dual DB)
  if (isPgEnabled()) {
    try {
      await initPg();
      console.log('[pg] PostgreSQL initialized — chat rooms enabled');
    } catch (err) {
      console.error('[pg] Failed to initialize — chat rooms will be unavailable:', err);
    }
  } else {
    console.log('[pg] DATABASE_URL not set — chat rooms disabled');
  }

  // Seed bundled skills into DB + sync to filesystem
  const bundledDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'claude-skills', 'skills');
  await seedBundledSkills(bundledDir);
  await seedPluginSkills();
  await syncCompanySkillsToFs();

  // Clean up stale chat session claudeSessionIds where .jsonl is gone.
  // Must run BEFORE orphan monitoring — ensures chat sessions don't attempt
  // resume from missing files (kanban tasks already handle this via recoverZombieTasks).
  cleanupStaleSessions();

  // Recover tasks that survived the restart, then start orphan monitor.
  // The monitor only kills idle orphans (CPU < 1% for 2 checks), so it's safe
  // to run alongside monitored tasks — active task processes won't be touched.
  resumeOrphanedTaskMonitoring((type, payload) => broadcastToAll({ type, ...payload }));
  cleanupOrphanedSdkProcesses();

  // Start scheduled-task poller (checks every 30s for due tasks)
  startScheduler((type, payload) => broadcastToAll({ type, ...payload }));
});

// Graceful shutdown — let orphan CLI processes keep running
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  gracefulShutdown('SIGINT');
  stopScheduler();
  stopOrphanMonitor();
  stopAllMonitors();
  stopFileWatcher();
  closePgPool().finally(() => server.close(() => process.exit(0)));
});

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM');
  stopScheduler();
  stopOrphanMonitor();
  stopAllMonitors();
  stopFileWatcher();
  closePgPool().finally(() => server.close(() => process.exit(0)));
});

// Prevent SDK "Operation aborted" errors from crashing the entire backend.
// These occur when abort() is called while the SDK is mid-write to a dead process.
process.on('uncaughtException', (err) => {
  if (err.name === 'AbortError' || /operation aborted/i.test(err.message)) {
    console.warn('[process] Caught AbortError (non-fatal):', err.message);
    return; // swallow — expected during session abort
  }
  console.error('[process] Uncaught exception (fatal):', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  if (reason?.name === 'AbortError' || /operation aborted/i.test(reason?.message || '')) {
    console.warn('[process] Caught unhandled AbortError rejection (non-fatal):', reason?.message);
    return;
  }
  console.error('[process] Unhandled rejection:', reason);
});
