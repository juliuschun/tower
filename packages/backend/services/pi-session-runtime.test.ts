import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-pi-runtime-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('pi-session-runtime', () => {
  it('backs up a session file into data/pi-session-backups', async () => {
    const root = makeTempDir();
    const cwd = path.join(root, 'project');
    const sessionsDir = path.join(cwd, '.pi', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    const sessionFile = path.join(sessionsDir, 'session.json');
    fs.writeFileSync(sessionFile, '{"ok":true}\n', 'utf8');

    const { backupPiSessionFile, getPiBackupPath } = await import('./pi-session-runtime.ts');
    expect(backupPiSessionFile(sessionFile, root)).toBe(true);
    expect(fs.existsSync(getPiBackupPath(sessionFile, root))).toBe(true);
  });

  it('preparePiResumeSession restores missing session file from backup', async () => {
    const root = makeTempDir();
    const cwd = path.join(root, 'project');
    const sessionsDir = path.join(cwd, '.pi', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    const sessionFile = path.join(sessionsDir, 'session.json');
    fs.writeFileSync(sessionFile, '{"ok":true}\n', 'utf8');

    const mod = await import('./pi-session-runtime.ts');
    expect(mod.backupPiSessionFile(sessionFile, root)).toBe(true);
    fs.rmSync(sessionFile);

    expect(mod.preparePiResumeSession(sessionFile, root)).toBe(sessionFile);
    expect(fs.existsSync(sessionFile)).toBe(true);
  });

  it('gracefulPiShutdown writes interrupted session ids and consumeInterruptedPiSessions reads them once', async () => {
    const root = makeTempDir();
    const mod = await import('./pi-session-runtime.ts');

    mod.gracefulPiShutdown(['s1', 's2'], root);
    expect(mod.consumeInterruptedPiSessions(root)).toEqual(['s1', 's2']);
    expect(mod.consumeInterruptedPiSessions(root)).toEqual([]);
  });
});
