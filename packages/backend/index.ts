import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { config, validateConfig } from './config.js';
import apiRouter from './routes/api.js';
import gatewayRouter from './routes/gateway.js';
import { setupWebSocket, broadcastToAll, broadcastToUser, serverSideResumeInterrupted } from './routes/ws-handler.js';
import { initPg, closePgPool, isPgEnabled } from './db/pg.js';
import { stopFileWatcher } from './services/file-system.js';
import { initWorkspaceRepo } from './services/git-manager.js';
import { resumeOrphanedTaskMonitoring, hasMonitoredTasks, stopAllMonitors } from './services/task-runner.js';
import { cleanupOrphanedSdkProcesses, stopOrphanMonitor, gracefulShutdown, consumeInterruptedSessions, type InterruptedSession } from './services/claude-sdk.js';
import { consumeInterruptedPiSessions } from './services/pi-session-runtime.js';
import { startUnifiedScheduler, stopUnifiedScheduler } from './services/unified-scheduler.js';
import { startHeartbeatScheduler, stopHeartbeatScheduler } from './services/heartbeat.js';
import { initNotificationHub } from './services/notification-hub.js';
import { auditStaleSessions } from './services/session-manager.js';
import { stopWsSync } from './services/ws-sync.js';
import { bootstrapLibraryProviders } from './services/skill-registry.js';
import { backfillTaskProjects } from './services/task-manager.js';

// CRITICAL: Remove CLAUDECODE env var before anything else
delete process.env.CLAUDECODE;
// Session resilience v1 — findJsonlFile + interrupted auto-resume

// Refuse to start with insecure JWT secret
validateConfig();

const app = express();
app.set('trust proxy', 1); // trust first proxy (Cloudflare) — correct IP for rate limiting
app.use(helmet({
  contentSecurityPolicy: false,       // breaks Vite HMR + inline scripts
  crossOriginEmbedderPolicy: false,   // breaks iframe embeds
}));
app.use(cors());
app.use(compression({ threshold: 512 })); // gzip responses > 512 bytes
app.use(express.json({ limit: '10mb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max: 20,                    // 20 attempts per window per IP
  message: { error: 'Too many attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth', authLimiter);

// Gateway routes (full mode only — MUST be before /api catch-all)
if (config.towerRole === 'full') {
  app.use('/api/gateway', gatewayRouter);
  console.log('[gateway] Central Publish Gateway enabled (TOWER_ROLE=full)');
}

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
      // Backfill project_id for orphaned tasks (cwd → project root_path matching)
      backfillTaskProjects().then(({ updated, total }) => {
        if (updated > 0) console.log(`[tasks] Backfilled project_id for ${updated}/${total} orphaned tasks`);
      }).catch(err => console.error('[tasks] Backfill failed:', err));
    } catch (err) {
      console.error('[pg] Failed to initialize — chat rooms will be unavailable:', err);
    }
  } else {
    console.log('[pg] DATABASE_URL not set — chat rooms disabled');
  }

  // 2026-04-17: company 스킬은 DB에 저장하지 않음. library.yaml + ~/.claude/skills/
  // 가 단일 소스. 여기선 library 스킬의 frontmatter에서 provider 요구사항만 읽어
  // skill_providers 테이블에 반영한다. (workspace/decisions/2026-04-17-skill-db-simplification.md)
  try {
    const result = await bootstrapLibraryProviders();
    console.log(`[startup] Library providers synced=${result.synced}, orphans_removed=${result.orphansRemoved}`);
  } catch (err) {
    console.error('[startup] bootstrapLibraryProviders failed:', err);
  }

  // Load interrupted sessions from previous shutdown (before stale cleanup)
  // Combine Claude + Pi interrupted sessions for unified auto-resume.
  const interruptedSessions: InterruptedSession[] = consumeInterruptedSessions();
  const piInterruptedIds = consumeInterruptedPiSessions();
  if (piInterruptedIds.length > 0) {
    console.log(`[startup] Recovered ${piInterruptedIds.length} interrupted Pi session(s)`);
    // Pi sessions store their engine session file path as claudeSessionId in DB,
    // so we only need the Tower session ID here — serverSideResumeInterrupted()
    // reads claudeSessionId from DB via getSession().
    for (const id of piInterruptedIds) {
      interruptedSessions.push({ id });
    }
  }
  if (interruptedSessions.length > 0) {
    // Store globally so ws-handler can check during reconnect (client-side fallback)
    (globalThis as any).__interruptedSessions = new Set(interruptedSessions.map(s => s.id));
    // Also store full details for server-side auto-resume
    (globalThis as any).__interruptedSessionDetails = interruptedSessions;
  }

  // Audit stale sessions (missing .jsonl) — log only, never clear claude_session_id.
  // Clearing causes permanent context loss. Instead, sdk.ts throws explicit error on resume.
  auditStaleSessions();

  // Recover tasks that survived the restart, then start orphan monitor.
  // The monitor only kills idle orphans (CPU < 1% for 2 checks), so it's safe
  // to run alongside monitored tasks — active task processes won't be touched.
  resumeOrphanedTaskMonitoring((type, payload) => broadcastToAll({ type, ...payload }));
  cleanupOrphanedSdkProcesses();

  // Start unified scheduler (checks every 30s for due schedules + legacy tasks)
  startUnifiedScheduler((type, payload) => broadcastToAll({ type, ...payload }));

  // Initialize notification hub — routes notifications to specific users via WS
  const notifBroadcast = (type: string, data: any) => {
    if (type === 'notification' && data.targetUserId) {
      broadcastToUser(data.targetUserId, { type: 'notification', notification: data.notification });
    } else if (type === 'room_message') {
      broadcastToAll({ type, ...data });
    } else {
      broadcastToAll({ type, ...data });
    }
  };
  initNotificationHub(notifBroadcast);

  // Initialize proactive agent (AI-initiated conversations)
  const { initProactiveAgent } = await import('./services/proactive-agent.js');
  initProactiveAgent(notifBroadcast);

  // Start heartbeat scheduler (checks project HEARTBEAT.md files periodically)
  startHeartbeatScheduler(notifBroadcast);

  // Server-side auto-resume: proactively resume interrupted sessions without waiting
  // for a client WebSocket reconnect. This fixes the gap where background-only sessions
  // or sessions with no active browser tab would be permanently lost.
  // Runs async — does not block server startup.
  serverSideResumeInterrupted().catch(err => {
    console.error('[auto-resume] Failed to resume interrupted sessions:', err);
  });
});

// Graceful shutdown — let orphan CLI processes keep running
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  gracefulShutdown('SIGINT');
  stopUnifiedScheduler();
  stopHeartbeatScheduler();
  stopOrphanMonitor();
  stopAllMonitors();
  stopFileWatcher();
  stopWsSync().catch(() => {}).finally(() => {
    closePgPool().finally(() => server.close(() => process.exit(0)));
  });
});

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM');
  stopUnifiedScheduler();
  stopHeartbeatScheduler();
  stopOrphanMonitor();
  stopAllMonitors();
  stopFileWatcher();
  stopWsSync().catch(() => {}).finally(() => {
    closePgPool().finally(() => server.close(() => process.exit(0)));
  });
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
