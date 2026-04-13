/**
 * Publish Client — used by TOWER_ROLE=managed servers
 *
 * Packages a source directory into tar.gz and sends it to the
 * Central Publish Gateway (Moat AI's full-role server) for deployment.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

export interface GatewayPublishOptions {
  name: string;
  sourceDir: string;
  type?: 'static' | 'dynamic';
  target?: string;
  port?: number;
  description?: string;
}

export interface GatewayPublishResult {
  success: boolean;
  url?: string;
  target?: string;
  detectedType?: string;
  error?: string;
  duration?: number;
}

/**
 * Package sourceDir into tar.gz, POST to the central gateway.
 *
 * Flow:
 *   1. tar.gz the source directory
 *   2. POST multipart/form-data to PUBLISH_GATEWAY_URL
 *   3. Return the gateway's response (deploy result)
 */
export async function publishViaGateway(opts: GatewayPublishOptions): Promise<GatewayPublishResult> {
  const { publishGatewayUrl, publishApiKey } = config;

  if (!publishGatewayUrl) {
    return { success: false, error: 'PUBLISH_GATEWAY_URL is not configured. Set it in .env' };
  }
  if (!publishApiKey) {
    return { success: false, error: 'PUBLISH_API_KEY is not configured. Set it in .env' };
  }

  // Validate source directory
  try {
    await fs.access(opts.sourceDir);
  } catch {
    return { success: false, error: `Source directory not found: ${opts.sourceDir}` };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tower-publish-'));
  const tarPath = path.join(tmpDir, 'source.tar.gz');

  try {
    // Step 1: Create tar.gz of source directory
    console.log(`[publish-client] Packaging ${opts.sourceDir} → ${tarPath}`);
    await execFileAsync('tar', [
      '-czf', tarPath,
      '-C', opts.sourceDir,
      '.',
    ], { timeout: 60_000 });

    const stat = await fs.stat(tarPath);
    console.log(`[publish-client] Package size: ${(stat.size / 1024).toFixed(1)} KB`);

    // Step 2: POST to gateway using fetch (Node 18+ built-in)
    const fileBuffer = await fs.readFile(tarPath);
    const blob = new Blob([fileBuffer], { type: 'application/gzip' });

    const formData = new FormData();
    formData.append('name', opts.name);
    formData.append('file', blob, 'source.tar.gz');
    if (opts.type) formData.append('type', opts.type);
    if (opts.target) formData.append('target', opts.target);
    if (opts.port) formData.append('port', String(opts.port));
    if (opts.description) formData.append('description', opts.description);

    console.log(`[publish-client] Sending to gateway: ${publishGatewayUrl}`);
    const response = await fetch(publishGatewayUrl, {
      method: 'POST',
      headers: {
        'X-Customer-Key': publishApiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errBody = await response.text();
      let errMsg: string;
      try {
        const errJson = JSON.parse(errBody);
        errMsg = errJson.error || errBody;
      } catch {
        errMsg = errBody;
      }
      return { success: false, error: `Gateway error (${response.status}): ${errMsg}` };
    }

    const result: GatewayPublishResult = await response.json();
    console.log(`[publish-client] Gateway response:`, result);
    return result;

  } catch (err: any) {
    console.error(`[publish-client] Failed:`, err);
    return { success: false, error: err.message || 'Unknown error during gateway publish' };
  } finally {
    // Cleanup temp directory
    try {
      await fs.rm(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  }
}
