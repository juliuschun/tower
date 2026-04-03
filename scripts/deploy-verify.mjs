#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { execFile } from 'child_process';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import {
  buildHealthUrl,
  buildWsUrl,
  extractJwtSecret,
  getPm2ProcessStatus,
  healthLooksOk,
} from './deploy-verify-lib.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = {
    target: 'tower-prod',
    baseUrl: 'http://127.0.0.1:32364',
    timeoutSec: 60,
    intervalMs: 2000,
    projectRoot: path.resolve(__dirname, '..'),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--target') {
      args.target = argv[++i];
    } else if (arg === '--base-url') {
      args.baseUrl = argv[++i];
    } else if (arg === '--timeout') {
      args.timeoutSec = Number(argv[++i]);
    } else if (arg === '--interval-ms') {
      args.intervalMs = Number(argv[++i]);
    } else if (arg === '--project-root') {
      args.projectRoot = path.resolve(argv[++i]);
    }
  }

  return args;
}

function usage() {
  return [
    'Usage: node scripts/deploy-verify.mjs [options]',
    '',
    'Options:',
    '  --target <name>        PM2 target name (default: tower-prod)',
    '  --base-url <url>       Base URL to verify (default: http://127.0.0.1:32364)',
    '  --timeout <sec>        Total timeout in seconds (default: 60)',
    '  --interval-ms <ms>     Poll interval in ms (default: 2000)',
    '  --project-root <path>  Project root containing .env (default: repo root)',
  ].join('\n');
}

function log(message) {
  console.log(`[deploy-verify] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJwtToken(projectRoot) {
  const envPath = path.join(projectRoot, '.env');
  const envText = fs.readFileSync(envPath, 'utf8');
  const secret = extractJwtSecret(envText);
  if (!secret) return null;
  return jwt.sign({ userId: 1, username: 'admin', role: 'admin' }, secret, { expiresIn: '5m' });
}

async function waitForPm2Online(target, timeoutSec, intervalMs) {
  const deadline = Date.now() + timeoutSec * 1000;
  let lastStatus = 'missing';

  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileAsync('pm2', ['jlist']);
      const parsed = JSON.parse(stdout || '[]');
      lastStatus = getPm2ProcessStatus(parsed, target) || 'missing';
      if (lastStatus === 'online') {
        log(`PM2 target is online: ${target}`);
        return;
      }
    } catch (err) {
      lastStatus = err instanceof Error ? err.message : String(err);
    }

    await sleep(intervalMs);
  }

  throw new Error(`PM2 target did not become online: ${target} (last=${lastStatus})`);
}

async function waitForHealth(baseUrl, token, timeoutSec, intervalMs) {
  const deadline = Date.now() + timeoutSec * 1000;
  const healthUrl = buildHealthUrl(baseUrl);
  let lastMessage = 'no response';

  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await res.text();
      let payload = null;
      try { payload = JSON.parse(body); } catch {}
      if (res.ok && healthLooksOk(payload)) {
        log(`Health endpoint is ok: ${healthUrl}`);
        return;
      }
      lastMessage = `status=${res.status} body=${body.slice(0, 200)}`;
    } catch (err) {
      lastMessage = err instanceof Error ? err.message : String(err);
    }

    await sleep(intervalMs);
  }

  throw new Error(`Health endpoint did not become ready: ${lastMessage}`);
}

async function waitForWsConnected(baseUrl, token, timeoutSec) {
  const wsUrl = buildWsUrl(baseUrl, token || undefined);
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`Timed out waiting for WS connected message: ${wsUrl}`));
    }, timeoutSec * 1000);

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data?.type === 'connected') {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          resolve(undefined);
        }
      } catch {}
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    ws.on('close', () => {
      // close after successful message is okay; otherwise timeout/error handles rejection
    });
  });

  log(`WebSocket connected message verified: ${wsUrl.replace(/([?&]token=)[^&]+/, '$1***')}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  log(`Starting deploy verification for ${args.target} @ ${args.baseUrl}`);
  const token = await readJwtToken(args.projectRoot).catch(() => null);

  await waitForPm2Online(args.target, args.timeoutSec, args.intervalMs);
  await waitForHealth(args.baseUrl, token, args.timeoutSec, args.intervalMs);
  await waitForWsConnected(args.baseUrl, token, Math.min(args.timeoutSec, 20));

  log('Verification passed');
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[deploy-verify] FAILED: ${message}`);
  process.exit(1);
});
