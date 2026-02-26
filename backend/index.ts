import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { config } from './config.js';
import apiRouter from './routes/api.js';
import { setupWebSocket } from './routes/ws-handler.js';
import { closeDb } from './db/schema.js';
import { stopFileWatcher } from './services/file-system.js';
import { initWorkspaceRepo } from './services/git-manager.js';

// CRITICAL: Remove CLAUDECODE env var before anything else
delete process.env.CLAUDECODE;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API routes
app.use('/api', apiRouter);

// Serve frontend in production
const frontendPath = config.frontendDir;
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

const server = http.createServer(app);
setupWebSocket(server);

// Initialize workspace git repo
initWorkspaceRepo(config.workspaceRoot).catch((err) => {
  console.error('[Git] Failed to initialize workspace repo:', err);
});

server.listen(config.port, config.host, () => {
  console.log(`
╔══════════════════════════════════════════╗
║         Tower v0.1.0                    ║
║                                          ║
║  http://localhost:${config.port}              ║
║  Auth: ${config.authEnabled ? 'enabled' : 'disabled'}                          ║
║  CWD: ${config.defaultCwd.slice(0, 30)}  ║
╚══════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  stopFileWatcher();
  closeDb();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopFileWatcher();
  closeDb();
  server.close();
  process.exit(0);
});
