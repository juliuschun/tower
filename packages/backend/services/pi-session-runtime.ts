import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function getDataDir(projectRoot = process.cwd()): string {
  return path.join(projectRoot, 'data');
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function backupKey(sessionFile: string): string {
  return crypto.createHash('sha1').update(path.resolve(sessionFile)).digest('hex');
}

export function getPiBackupPath(sessionFile: string, projectRoot = process.cwd()): string {
  return path.join(getDataDir(projectRoot), 'pi-session-backups', `${backupKey(sessionFile)}.json`);
}

export function backupPiSessionFile(sessionFile: string, projectRoot = process.cwd()): boolean {
  if (!sessionFile || !fs.existsSync(sessionFile)) return false;
  try {
    const backupPath = getPiBackupPath(sessionFile, projectRoot);
    ensureDir(path.dirname(backupPath));
    fs.copyFileSync(sessionFile, backupPath);
    return true;
  } catch {
    return false;
  }
}

export function preparePiResumeSession(sessionFile: string, projectRoot = process.cwd()): string | undefined {
  if (!sessionFile) return undefined;
  if (fs.existsSync(sessionFile)) return sessionFile;

  const backupPath = getPiBackupPath(sessionFile, projectRoot);
  if (!fs.existsSync(backupPath)) return undefined;

  try {
    ensureDir(path.dirname(sessionFile));
    fs.copyFileSync(backupPath, sessionFile);
    return sessionFile;
  } catch {
    return undefined;
  }
}

export function gracefulPiShutdown(sessionIds: string[], projectRoot = process.cwd()): void {
  if (sessionIds.length === 0) return;
  try {
    const filePath = path.join(getDataDir(projectRoot), 'interrupted-pi-sessions.json');
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify({ sessions: sessionIds, at: new Date().toISOString() }));
  } catch {
    // best-effort only
  }
}

export function consumeInterruptedPiSessions(projectRoot = process.cwd()): string[] {
  const filePath = path.join(getDataDir(projectRoot), 'interrupted-pi-sessions.json');
  try {
    if (!fs.existsSync(filePath)) return [];
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    fs.unlinkSync(filePath);
    return Array.isArray(data.sessions) ? data.sessions : [];
  } catch {
    return [];
  }
}
