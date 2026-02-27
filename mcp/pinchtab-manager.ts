import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BINARY = path.join(PROJECT_ROOT, 'data', 'pinchtab');

// Chrome 바이너리 후보 목록 (env 우선, 없으면 순서대로 탐색)
const CHROME_CANDIDATES = [
  process.env.CHROME_BINARY,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean) as string[];

function findChrome(): string | null {
  return CHROME_CANDIDATES.find(existsSync) ?? null;
}

export class PinchTabManager {
  private baseUrl: string;
  private binaryPath: string | null = null;
  private process: ChildProcess | null = null;
  private owned = false;
  private processAlive = false;
  private restarting: Promise<void> | null = null;

  constructor() {
    this.baseUrl = process.env.PINCHTAB_URL || 'http://localhost:9867';
  }

  // ─── 공개 API ────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (process.env.PINCHTAB_URL) {
      // 외부 인스턴스 — 연결 확인만
      await this.waitForHealth(3000);
      return;
    }

    const bp = process.env.PINCHTAB_BINARY || DEFAULT_BINARY;
    if (!existsSync(bp)) {
      throw new Error(
        `PinchTab binary not found at "${bp}". ` +
        `Set PINCHTAB_URL to connect to a running instance, ` +
        `or set PINCHTAB_BINARY to the binary path.`
      );
    }
    this.binaryPath = bp;

    // ⑤ 포트 충돌 처리: 이미 떠있으면 외부 인스턴스로 연결
    if (await this.isPortUp()) {
      console.error('[pinchtab-manager] port already in use — connecting to existing instance');
      await this.waitForHealth(5000);
      return;
    }

    await this.spawnProcess();
    await this.waitForHealth(10000);
  }

  async stop(): Promise<void> {
    this.killProcess();
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  // ② fetch() 자동 복구 래퍼
  async fetch(endpoint: string, init?: RequestInit): Promise<Response> {
    // 프로세스가 죽은 걸 알고 있으면 먼저 재시작
    if (this.owned && !this.processAlive) {
      await this.ensureRestarted();
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> ?? {}),
      ...(process.env.PINCHTAB_TOKEN
        ? { Authorization: `Bearer ${process.env.PINCHTAB_TOKEN}` }
        : {}),
    };

    try {
      return await fetch(`${this.baseUrl}${endpoint}`, { ...init, headers });
    } catch (err) {
      // 네트워크 에러 → health 확인 후 재시작 시도
      if (this.owned && !(await this.isHealthy())) {
        console.error('[pinchtab-manager] fetch failed, restarting…');
        await this.ensureRestarted();
        return fetch(`${this.baseUrl}${endpoint}`, { ...init, headers });
      }
      throw err;
    }
  }

  // ─── 내부 메서드 ──────────────────────────────────────────────────────────────

  // ③ restart(): restarting 플래그로 중복 재시작 차단
  private ensureRestarted(): Promise<void> {
    if (!this.restarting) {
      this.restarting = this.doRestart().finally(() => {
        this.restarting = null;
      });
    }
    return this.restarting;
  }

  private async doRestart(): Promise<void> {
    console.error('[pinchtab-manager] restarting pinchtab…');
    this.killProcess();
    await new Promise(r => setTimeout(r, 500)); // 포트 해제 대기
    await this.spawnProcess();
    await this.waitForHealth(10000);
    console.error('[pinchtab-manager] restart complete');
  }

  private spawnProcess(): Promise<void> {
    if (!this.binaryPath) throw new Error('No binary path set');

    // ④ Chrome 자동 감지
    const chrome = findChrome();
    if (!chrome) {
      throw new Error(
        `Chrome not found. Tried: ${CHROME_CANDIDATES.join(', ')}. ` +
        `Set CHROME_BINARY env to the correct path.`
      );
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      BRIDGE_PORT: '9867',
      BRIDGE_HEADLESS: 'true',
      CHROME_BINARY: chrome,
      ...(process.env.BRIDGE_PROFILE ? { BRIDGE_PROFILE: process.env.BRIDGE_PROFILE } : {}),
      ...(process.env.PINCHTAB_TOKEN ? { BRIDGE_TOKEN: process.env.PINCHTAB_TOKEN } : {}),
    };

    const child = spawn(this.binaryPath, [], {
      env,
      stdio: 'ignore',
      detached: false,
    });

    this.process = child;
    this.owned = true;
    this.processAlive = true;

    // ① process 'exit' 감지
    child.on('exit', (code) => {
      console.error(`[pinchtab-manager] process exited (code ${code})`);
      this.processAlive = false;
      if (this.process === child) this.process = null;
    });

    child.on('error', (err) => {
      console.error('[pinchtab-manager] process error:', err.message);
      this.processAlive = false;
    });

    return Promise.resolve();
  }

  private killProcess(): void {
    if (this.process) {
      try { this.process.kill('SIGTERM'); } catch { /* already dead */ }
      this.process = null;
    }
    this.processAlive = false;
    this.owned = !!this.binaryPath; // binary path가 있으면 여전히 "소유" 모드
  }

  private async isPortUp(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return false;
      const body = await res.json().catch(() => ({}));
      return body.status !== 'disconnected';
    } catch {
      return false;
    }
  }

  private async waitForHealth(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isHealthy()) return;
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`PinchTab did not become healthy within ${timeoutMs}ms at ${this.baseUrl}`);
  }
}
