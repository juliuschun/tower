/**
 * Deploy Engine — Cloudflare Pages + Azure Container Apps
 *
 * Analyzes code type and deploys to the appropriate platform:
 * - Static sites (HTML/CSS/JS only) → Cloudflare Pages
 * - Dynamic apps (server code)      → Azure Container Apps
 */
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import http from 'http';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

// ── Types ──

export type DeployTarget = 'cloudflare-pages' | 'azure-container-apps';
export type DeployStatus = 'pending' | 'building' | 'deploying' | 'live' | 'failed';

export interface DeployResult {
  success: boolean;
  target: DeployTarget;
  url?: string;
  error?: string;
  duration?: number;       // ms
  detectedType: 'static' | 'dynamic';
}

export interface DeployOptions {
  name: string;             // project/app name (lowercase, hyphens)
  sourceDir: string;        // absolute path to source directory
  target?: DeployTarget;    // force target (auto-detect if omitted)
  port?: number;            // container port (for dynamic apps, default 3000)
  env?: Record<string, string>;  // env vars for container
  description?: string;
}

interface ManifestSite {
  name: string;
  description?: string;
  access: string;
  created_at: string;
  deploy_target?: DeployTarget;
  external_url?: string;
  last_deployed_at?: string;
}

interface ManifestApp {
  name: string;
  port?: number;
  path?: string;
  description?: string;
  access: string;
  deploy_target?: DeployTarget;
  external_url?: string;
  last_deployed_at?: string;
  [key: string]: unknown;
}

interface Manifest {
  version: number;
  domain: string;
  updated_at: string;
  sites: ManifestSite[];
  apps: ManifestApp[];
  extra_locations?: unknown[];
}

// ── Config ──

function getCloudflareConfig() {
  return {
    apiToken: process.env.CLOUDFLARE_API_TOKEN || '',
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
  };
}

function getAzureConfig() {
  return {
    resourceGroup: process.env.AZURE_RESOURCE_GROUP || 'MAAP-n8n-resources',
    containerEnv: process.env.AZURE_CONTAINER_ENV || 'moat-container-env',
    registry: process.env.AZURE_REGISTRY || 'maapn8nacr.azurecr.io',
    registryName: process.env.AZURE_REGISTRY_NAME || 'maapn8nacr',
  };
}

const PUBLISHED_DIR = () => path.join(config.workspaceRoot, 'published');
const MANIFEST_PATH = () => path.join(PUBLISHED_DIR(), 'manifest.json');

// ── Code Type Detection ──

const SERVER_INDICATORS = [
  // Node.js server patterns
  /require\s*\(\s*['"]express['"]\s*\)/,
  /from\s+['"]express['"]/,
  /require\s*\(\s*['"]fastify['"]\s*\)/,
  /require\s*\(\s*['"]koa['"]\s*\)/,
  /require\s*\(\s*['"]hono['"]\s*\)/,
  /createServer\s*\(/,
  /\.listen\s*\(\s*\d/,
  // Python server patterns
  /from\s+flask\s+import/,
  /from\s+fastapi\s+import/,
  /from\s+django/,
  /uvicorn\.run/,
  /app\.run\s*\(/,
];

const SERVER_FILES = [
  'server.js', 'server.ts', 'server.py',
  'app.js', 'app.ts', 'app.py',
  'main.py', 'index.js', 'index.ts',
  'Dockerfile', 'docker-compose.yml',
  'requirements.txt', 'Pipfile',
];

const STATIC_ONLY_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.js', '.mjs',
  '.json', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.mp4', '.webm', '.mp3',
  '.txt', '.xml', '.map',
]);

export async function detectCodeType(sourceDir: string): Promise<'static' | 'dynamic'> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true, recursive: true });

  // Check for server files
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name.toLowerCase();

    // Dockerfile = definitely dynamic
    if (name === 'dockerfile') return 'dynamic';

    // Known server file names → inspect content
    if (SERVER_FILES.includes(name)) {
      const fullPath = path.join((entry as any).parentPath || (entry as any).path || sourceDir, entry.name);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        for (const pattern of SERVER_INDICATORS) {
          if (pattern.test(content)) return 'dynamic';
        }
      } catch { /* skip unreadable files */ }
    }
  }

  // Check if all files are static-only extensions
  const allStatic = entries
    .filter(e => e.isFile())
    .every(e => {
      const ext = path.extname(e.name).toLowerCase();
      return STATIC_ONLY_EXTENSIONS.has(ext) || e.name.startsWith('.');
    });

  if (allStatic) return 'static';

  // Has package.json with start script → probably dynamic
  try {
    const pkgPath = path.join(sourceDir, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    if (pkg.scripts?.start) return 'dynamic';
  } catch { /* no package.json */ }

  // Default: static
  return 'static';
}

// ── Cloudflare Pages Deploy ──

async function deployCloudflarPages(opts: DeployOptions): Promise<DeployResult> {
  const cf = getCloudflareConfig();
  if (!cf.apiToken || !cf.accountId) {
    return { success: false, target: 'cloudflare-pages', detectedType: 'static', error: 'Cloudflare credentials not configured. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .env' };
  }

  const start = Date.now();
  const projectName = opts.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  try {
    // Create project if it doesn't exist (ignore error if already exists)
    try {
      await execFileAsync('npx', [
        'wrangler', 'pages', 'project', 'create', projectName,
        '--production-branch=main',
      ], {
        env: { ...process.env, CLOUDFLARE_API_TOKEN: cf.apiToken, CLOUDFLARE_ACCOUNT_ID: cf.accountId },
        timeout: 30_000,
      });
    } catch (e: any) {
      // "already exists" is fine
      if (!e.stderr?.includes('already exists') && !e.message?.includes('already exists')) {
        // May be a genuine error — but try deploying anyway
        console.warn(`[deploy] CF project create warning: ${e.message}`);
      }
    }

    // Deploy
    const { stdout, stderr } = await execFileAsync('npx', [
      'wrangler', 'pages', 'deploy', opts.sourceDir,
      '--project-name', projectName,
      '--commit-dirty=true',
    ], {
      env: { ...process.env, CLOUDFLARE_API_TOKEN: cf.apiToken, CLOUDFLARE_ACCOUNT_ID: cf.accountId },
      timeout: 120_000,
    });

    // Extract URL from output
    const urlMatch = stdout.match(/https:\/\/[^\s]+\.pages\.dev/) ||
                     stderr.match(/https:\/\/[^\s]+\.pages\.dev/);
    const productionUrl = `https://${projectName}.pages.dev`;

    return {
      success: true,
      target: 'cloudflare-pages',
      url: productionUrl,
      detectedType: 'static',
      duration: Date.now() - start,
    };
  } catch (e: any) {
    return {
      success: false,
      target: 'cloudflare-pages',
      detectedType: 'static',
      error: e.stderr || e.message,
      duration: Date.now() - start,
    };
  }
}

// ── Azure Container Apps Deploy ──

async function deployAzureContainerApps(opts: DeployOptions): Promise<DeployResult> {
  const az = getAzureConfig();
  const start = Date.now();
  const appName = opts.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const port = opts.port || 3000;
  const imageName = `${az.registry}/${appName}:latest`;

  try {
    // Step 1: Ensure Dockerfile exists, generate one if needed
    const dockerfilePath = path.join(opts.sourceDir, 'Dockerfile');
    const hasDockerfile = await fs.access(dockerfilePath).then(() => true).catch(() => false);

    if (!hasDockerfile) {
      const dockerfile = await generateDockerfile(opts.sourceDir, port);
      await fs.writeFile(dockerfilePath, dockerfile);
    }

    // Step 2: Build image in ACR
    console.log(`[deploy] Building image ${imageName} in ACR...`);
    await execFileAsync('az', [
      'acr', 'build',
      '--registry', az.registryName,
      '--image', `${appName}:latest`,
      '--file', 'Dockerfile',
      '.',
    ], {
      cwd: opts.sourceDir,
      timeout: 300_000, // 5 min
    });

    // Step 3: Check if container app exists
    let appExists = false;
    try {
      await execFileAsync('az', [
        'containerapp', 'show',
        '--name', appName,
        '--resource-group', az.resourceGroup,
      ], { timeout: 15_000 });
      appExists = true;
    } catch { /* doesn't exist */ }

    // Step 4: Create or update
    if (appExists) {
      console.log(`[deploy] Updating container app ${appName}...`);
      await execFileAsync('az', [
        'containerapp', 'update',
        '--name', appName,
        '--resource-group', az.resourceGroup,
        '--image', imageName,
      ], { timeout: 60_000 });
    } else {
      console.log(`[deploy] Creating container app ${appName}...`);
      const createArgs = [
        'containerapp', 'create',
        '--name', appName,
        '--resource-group', az.resourceGroup,
        '--environment', az.containerEnv,
        '--image', imageName,
        '--target-port', String(port),
        '--ingress', 'external',
        '--min-replicas', '0',
        '--max-replicas', '3',
        '--registry-server', az.registry,
      ];

      // Add env vars if provided
      if (opts.env && Object.keys(opts.env).length > 0) {
        const envPairs = Object.entries(opts.env).map(([k, v]) => `${k}=${v}`);
        createArgs.push('--env-vars', ...envPairs);
      }

      await execFileAsync('az', createArgs, { timeout: 120_000 });
    }

    // Step 5: Get the FQDN
    const { stdout } = await execFileAsync('az', [
      'containerapp', 'show',
      '--name', appName,
      '--resource-group', az.resourceGroup,
      '--query', 'properties.configuration.ingress.fqdn',
      '-o', 'tsv',
    ], { timeout: 15_000 });

    const fqdn = stdout.trim();
    const url = fqdn ? `https://${fqdn}` : undefined;

    return {
      success: true,
      target: 'azure-container-apps',
      url,
      detectedType: 'dynamic',
      duration: Date.now() - start,
    };
  } catch (e: any) {
    return {
      success: false,
      target: 'azure-container-apps',
      detectedType: 'dynamic',
      error: e.stderr || e.message,
      duration: Date.now() - start,
    };
  }
}

// ── Dockerfile Generator ──

async function generateDockerfile(sourceDir: string, port: number): Promise<string> {
  const hasPkgJson = await fs.access(path.join(sourceDir, 'package.json')).then(() => true).catch(() => false);
  const hasRequirements = await fs.access(path.join(sourceDir, 'requirements.txt')).then(() => true).catch(() => false);
  const hasPipfile = await fs.access(path.join(sourceDir, 'Pipfile')).then(() => true).catch(() => false);

  if (hasRequirements || hasPipfile) {
    // Python app
    const installCmd = hasRequirements ? 'pip install -r requirements.txt' : 'pip install pipenv && pipenv install --system';
    return `FROM python:3.12-slim
WORKDIR /app
COPY . .
RUN ${installCmd}
EXPOSE ${port}
CMD ["python", "app.py"]
`;
  }

  if (hasPkgJson) {
    // Node.js app
    return `FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE ${port}
CMD ["npm", "start"]
`;
  }

  // Generic: just serve with a simple static server as fallback
  return `FROM node:20-slim
WORKDIR /app
RUN npm install -g serve
COPY . .
EXPOSE ${port}
CMD ["serve", "-s", ".", "-l", "${port}"]
`;
}

// ── Manifest Management ──

async function readManifest(): Promise<Manifest> {
  try {
    const raw = await fs.readFile(MANIFEST_PATH(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { version: 2, domain: '', updated_at: new Date().toISOString(), sites: [], apps: [] };
  }
}

async function writeManifest(manifest: Manifest): Promise<void> {
  manifest.updated_at = new Date().toISOString();
  await fs.writeFile(MANIFEST_PATH(), JSON.stringify(manifest, null, 2));
}

async function updateManifestAfterDeploy(opts: DeployOptions, result: DeployResult): Promise<void> {
  const manifest = await readManifest();
  const now = new Date().toISOString();

  if (result.detectedType === 'static') {
    const existing = manifest.sites.find(s => s.name === opts.name);
    if (existing) {
      existing.deploy_target = result.target;
      existing.external_url = result.url;
      existing.last_deployed_at = now;
      if (opts.description) existing.description = opts.description;
    } else {
      manifest.sites.push({
        name: opts.name,
        description: opts.description || '',
        access: 'public',
        created_at: now,
        deploy_target: result.target,
        external_url: result.url,
        last_deployed_at: now,
      });
    }
  } else {
    const existing = manifest.apps.find(a => a.name === opts.name);
    if (existing) {
      existing.deploy_target = result.target;
      existing.external_url = result.url;
      existing.last_deployed_at = now;
      if (opts.description) existing.description = opts.description;
      // Clean up local-only fields when deploying to external platform
      if ((result.target as string) !== 'local') {
        delete existing.port;
        delete existing.path;
        delete existing.health_path;
        delete existing.runtime;
        delete existing.exec;
        delete existing.working_dir;
        delete (existing as any).managed;
      }
    } else {
      manifest.apps.push({
        name: opts.name,
        description: opts.description || '',
        access: 'public',
        deploy_target: result.target,
        external_url: result.url,
        last_deployed_at: now,
      });
    }
  }

  await writeManifest(manifest);
}

// ── Main Deploy Function ──

export async function deploy(opts: DeployOptions): Promise<DeployResult> {
  // Validate source directory
  try {
    await fs.access(opts.sourceDir);
  } catch {
    return { success: false, target: 'cloudflare-pages', detectedType: 'static', error: `Source directory not found: ${opts.sourceDir}` };
  }

  // Detect code type
  const detectedType = await detectCodeType(opts.sourceDir);

  // Determine target
  const target = opts.target || (detectedType === 'static' ? 'cloudflare-pages' : 'azure-container-apps');

  console.log(`[deploy] ${opts.name}: detected=${detectedType}, target=${target}, source=${opts.sourceDir}`);

  // Deploy
  let result: DeployResult;
  if (target === 'cloudflare-pages') {
    result = await deployCloudflarPages(opts);
  } else {
    result = await deployAzureContainerApps(opts);
  }

  // Update manifest on success
  if (result.success) {
    await updateManifestAfterDeploy(opts, result);
  }

  return result;
}

// ── Publish Status (replaces Hub /health) ──

interface SiteStatus extends ManifestSite {
  status: 'live' | 'empty' | 'missing';
  files: number;
}

interface AppStatus extends ManifestApp {
  status: 'up' | 'down' | 'timeout' | 'no-port' | 'external';
  statusCode?: number;
}

async function checkSiteExists(name: string): Promise<{ status: string; files: number }> {
  const siteDir = path.join(PUBLISHED_DIR(), 'sites', name);
  try {
    const entries = await fs.readdir(siteDir);
    const files = entries.filter(f => !f.startsWith('.')).length;
    return { status: files > 0 ? 'live' : 'empty', files };
  } catch {
    return { status: 'missing', files: 0 };
  }
}

async function checkAppHealth(app: ManifestApp): Promise<{ status: string; statusCode?: number }> {
  // External deployments — we can't health-check from localhost
  if (app.external_url) {
    return { status: 'external' };
  }
  if (!app.port) {
    return { status: 'no-port' };
  }

  return new Promise((resolve) => {
    const healthPath = (app as any).health_path || '/';
    const req = http.get(
      `http://localhost:${app.port}${healthPath}`,
      { timeout: 3000 },
      (res) => {
        resolve({ status: 'up', statusCode: res.statusCode });
        res.resume(); // drain
      },
    );
    req.on('error', () => resolve({ status: 'down' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 'timeout' }); });
  });
}

export async function getPublishStatus(): Promise<{ sites: SiteStatus[]; apps: AppStatus[] }> {
  const manifest = await readManifest();

  const sites: SiteStatus[] = await Promise.all(
    manifest.sites.map(async (s) => {
      const check = await checkSiteExists(s.name);
      return { ...s, status: check.status as SiteStatus['status'], files: check.files };
    }),
  );

  const apps: AppStatus[] = await Promise.all(
    manifest.apps.map(async (a) => {
      const check = await checkAppHealth(a);
      return { ...a, status: check.status as AppStatus['status'], statusCode: check.statusCode };
    }),
  );

  return { sites, apps };
}

// ── Traffic Stats (replaces Hub /stats) ──

interface TrafficEntry {
  hits: number;
  path: string;
}

export async function getTrafficStats(): Promise<TrafficEntry[]> {
  try {
    const { stdout } = await execFileAsync('tail', ['-1000', '/var/log/nginx/access.log'], { timeout: 5000 });
    const pathCounts: Record<string, number> = {};
    for (const line of stdout.split('\n')) {
      // nginx combined log: ... "GET /path HTTP/1.1" ...
      const match = line.match(/"(?:GET|POST|PUT|DELETE|PATCH)\s+([^\s"]+)/);
      if (match) {
        const p = match[1].split('?')[0]; // strip query string
        // Only count published sites/apps paths
        if (p.startsWith('/sites/') || p.startsWith('/apps/')) {
          pathCounts[p] = (pathCounts[p] || 0) + 1;
        }
      }
    }
    return Object.entries(pathCounts)
      .map(([p, hits]) => ({ path: p, hits }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 50);
  } catch {
    return [];
  }
}

// ── List Deployments ──

export async function listDeployments(): Promise<{ sites: ManifestSite[]; apps: ManifestApp[] }> {
  const manifest = await readManifest();
  return {
    sites: manifest.sites,
    apps: manifest.apps,
  };
}

// ── Delete Deployment ──

export async function deleteDeployment(name: string, type: 'site' | 'app'): Promise<{ success: boolean; error?: string }> {
  const manifest = await readManifest();

  if (type === 'site') {
    const site = manifest.sites.find(s => s.name === name);
    if (!site) return { success: false, error: 'Site not found' };

    // Delete from Cloudflare if it was deployed there
    if (site.deploy_target === 'cloudflare-pages') {
      const cf = getCloudflareConfig();
      try {
        await execFileAsync('npx', [
          'wrangler', 'pages', 'project', 'delete', name, '--yes',
        ], {
          env: { ...process.env, CLOUDFLARE_API_TOKEN: cf.apiToken, CLOUDFLARE_ACCOUNT_ID: cf.accountId },
          timeout: 30_000,
        });
      } catch (e: any) {
        console.warn(`[deploy] CF delete warning: ${e.message}`);
      }
    }

    manifest.sites = manifest.sites.filter(s => s.name !== name);
  } else {
    const app = manifest.apps.find(a => a.name === name);
    if (!app) return { success: false, error: 'App not found' };

    // Delete from Azure if it was deployed there
    if (app.deploy_target === 'azure-container-apps') {
      const az = getAzureConfig();
      try {
        await execFileAsync('az', [
          'containerapp', 'delete',
          '--name', name,
          '--resource-group', az.resourceGroup,
          '--yes',
        ], { timeout: 60_000 });
      } catch (e: any) {
        console.warn(`[deploy] Azure delete warning: ${e.message}`);
      }
    }

    manifest.apps = manifest.apps.filter(a => a.name !== name);
  }

  await writeManifest(manifest);
  return { success: true };
}
