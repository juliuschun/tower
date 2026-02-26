import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BINARY = path.join(PROJECT_ROOT, 'data', 'pinchtab');

export class PinchTabManager {
  private baseUrl: string;
  private process: ChildProcess | null = null;
  private owned = false;

  constructor() {
    this.baseUrl = process.env.PINCHTAB_URL || 'http://localhost:9867';
  }

  async start(): Promise<void> {
    if (process.env.PINCHTAB_URL) {
      // 외부 인스턴스 — 연결 확인만
      await this.waitForHealth(3000);
      return;
    }

    const binaryPath = process.env.PINCHTAB_BINARY || DEFAULT_BINARY;
    if (!existsSync(binaryPath)) {
      throw new Error(
        `PinchTab binary not found at "${binaryPath}". ` +
        `Set PINCHTAB_URL to connect to a running instance, ` +
        `or set PINCHTAB_BINARY to the binary path.`
      );
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      BRIDGE_PORT: '9867',
      BRIDGE_HEADLESS: 'true',
      ...(process.env.PINCHTAB_TOKEN ? { BRIDGE_TOKEN: process.env.PINCHTAB_TOKEN } : {}),
    };

    this.process = spawn(binaryPath, [], {
      env,
      stdio: 'ignore',
      detached: false,
    });
    this.owned = true;

    this.process.on('error', (err) => {
      console.error('[pinchtab-manager] process error:', err.message);
    });

    await this.waitForHealth(10000);
  }

  async stop(): Promise<void> {
    if (this.owned && this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
      this.owned = false;
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async fetch(endpoint: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> ?? {}),
      ...(process.env.PINCHTAB_TOKEN
        ? { Authorization: `Bearer ${process.env.PINCHTAB_TOKEN}` }
        : {}),
    };
    return fetch(`${this.baseUrl}${endpoint}`, { ...init, headers });
  }

  private async waitForHealth(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${this.baseUrl}/health`);
        if (res.ok) return;
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`PinchTab did not become healthy within ${timeoutMs}ms at ${this.baseUrl}`);
  }
}
