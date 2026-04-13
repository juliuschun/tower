/**
 * Central Publish Gateway — receives deployments from managed customer Towers
 *
 * Only active when TOWER_ROLE=full.
 * Customer Towers (TOWER_ROLE=managed) send tar.gz files here for deployment.
 *
 * Auth: X-Customer-Key header → validated against gateway_customers table
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { query, queryOne } from '../db/pg-repo.js';
import { deploy, detectCodeType } from '../services/deploy-engine.js';
import { authMiddleware, adminMiddleware } from '../services/auth.js';

const execFileAsync = promisify(execFile);

const router = Router();

// ── Multer for receiving tar.gz files ──
const gatewayUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => cb(null, `gw-${Date.now()}-${Math.random().toString(36).slice(2)}.tar.gz`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/gzip' || file.mimetype === 'application/x-gzip' || file.originalname.endsWith('.tar.gz')) {
      cb(null, true);
    } else {
      cb(new Error('Only tar.gz files accepted'));
    }
  },
});

// ── Customer API Key Auth Middleware ──

interface GatewayCustomer {
  id: string;
  customer_name: string;
  api_key: string;
  profile: string;
  quota_sites: number;
  quota_apps: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
}

async function gatewayKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-customer-key'] as string;
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing X-Customer-Key header' });
  }

  try {
    const customer = await queryOne<GatewayCustomer>(
      `SELECT * FROM gateway_customers WHERE api_key = $1 AND is_active = true`,
      [apiKey],
    );

    if (!customer) {
      return res.status(403).json({ error: 'Invalid or revoked API key' });
    }

    // Attach customer info to request for downstream use
    (req as any).gatewayCustomer = customer;
    next();
  } catch (err: any) {
    console.error('[gateway] Auth error:', err);
    return res.status(500).json({ error: 'Gateway auth check failed' });
  }
}

// ══════════════════════════════════════════════════════
// Customer-facing endpoints (API key auth)
// ══════════════════════════════════════════════════════

/**
 * POST /api/gateway/publish
 *
 * Receives a tar.gz file from a managed customer Tower and deploys it.
 * Body: multipart { name, file (tar.gz), type?, target?, port?, description? }
 * Auth: X-Customer-Key header
 */
router.post('/publish', gatewayUpload.single('file'), gatewayKeyAuth, async (req: Request, res: Response) => {
  const customer: GatewayCustomer = (req as any).gatewayCustomer;
  const file = req.file;
  const { name, type, target, port, description } = req.body;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded. Send tar.gz as "file" field.' });
  }
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    return res.status(400).json({ error: 'name must be lowercase alphanumeric with hyphens' });
  }

  // Prefix project name with customer to avoid collisions: okusystem--my-report
  const deployName = `${customer.customer_name}--${name}`;
  const extractDir = path.join(os.tmpdir(), `gw-extract-${Date.now()}`);

  try {
    // Check quota (soft-enforced: warn in logs but don't block)
    const deployCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM gateway_deploy_log WHERE customer_id = $1 AND success = true`,
      [customer.id],
    );
    const currentDeploys = parseInt(deployCount?.count || '0');
    const estimatedType = type || 'static';
    const quotaLimit = estimatedType === 'static' ? customer.quota_sites : customer.quota_apps;
    if (currentDeploys >= quotaLimit) {
      console.warn(`[gateway] Customer ${customer.customer_name} at quota limit: ${currentDeploys}/${quotaLimit} (${estimatedType})`);
    }

    // Extract tar.gz to temp dir
    await fs.mkdir(extractDir, { recursive: true });
    await execFileAsync('tar', ['-xzf', file.path, '-C', extractDir], { timeout: 60_000 });

    console.log(`[gateway] Deploying for ${customer.customer_name}: ${deployName} (type: ${estimatedType})`);

    // Auto-detect type if not specified
    const finalType = type || await detectCodeType(extractDir);
    const finalTarget = target || (finalType === 'static' ? 'cloudflare-pages' : 'azure-container-apps');

    // Deploy using existing engine
    const result = await deploy({
      name: deployName,
      sourceDir: extractDir,
      target: finalTarget,
      port: port ? parseInt(port) : undefined,
      description: description || `Deployed by ${customer.customer_name}`,
    });

    // Log the deployment
    await query(
      `INSERT INTO gateway_deploy_log (customer_id, deploy_name, deploy_type, deploy_target, result_url, success, error, duration_ms, file_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [customer.id, name, finalType, finalTarget, result.url || null, result.success, result.error || null, result.duration || null, file.size],
    );

    // Update customer's updated_at
    await query(`UPDATE gateway_customers SET updated_at = now() WHERE id = $1`, [customer.id]);

    if (result.success) {
      console.log(`[gateway] Deploy success: ${deployName} → ${result.url}`);
      res.json({
        success: true,
        url: result.url,
        target: result.target,
        detectedType: result.detectedType,
        duration: result.duration,
        deployName,
      });
    } else {
      console.warn(`[gateway] Deploy failed: ${deployName} — ${result.error}`);
      res.status(422).json({
        success: false,
        error: result.error,
        target: result.target,
        detectedType: result.detectedType,
      });
    }

  } catch (err: any) {
    console.error(`[gateway] Error:`, err);
    // Log failed attempt
    try {
      await query(
        `INSERT INTO gateway_deploy_log (customer_id, deploy_name, deploy_type, deploy_target, success, error, file_size)
         VALUES ($1, $2, $3, $4, false, $5, $6)`,
        [customer.id, name, type || 'unknown', target || 'unknown', err.message, file.size],
      );
    } catch { /* ignore logging errors */ }
    res.status(500).json({ error: err.message });
  } finally {
    // Cleanup
    try { await fs.rm(file.path, { force: true }); } catch {}
    try { await fs.rm(extractDir, { recursive: true, force: true }); } catch {}
  }
});

// ══════════════════════════════════════════════════════
// Admin endpoints (Tower admin auth)
// ══════════════════════════════════════════════════════

/** Generate a customer API key: cust_<name>_<random> */
function generateApiKey(customerName: string): string {
  const rand = crypto.randomBytes(16).toString('hex');
  return `cust_${customerName}_${rand}`;
}

/** GET /api/gateway/customers — List all gateway customers */
router.get('/customers', authMiddleware, adminMiddleware, async (_req: Request, res: Response) => {
  try {
    const customers = await query(
      `SELECT id, customer_name, api_key, profile, quota_sites, quota_apps, is_active, metadata, created_at, updated_at
       FROM gateway_customers ORDER BY created_at DESC`,
    );
    // Also fetch deploy counts
    const counts = await query(
      `SELECT customer_id, COUNT(*) as total, COUNT(*) FILTER (WHERE success) as successful
       FROM gateway_deploy_log GROUP BY customer_id`,
    );
    const countMap = new Map((counts || []).map((c: any) => [c.customer_id, { total: +c.total, successful: +c.successful }]));

    const result = (customers || []).map((c: any) => ({
      ...c,
      deploys: countMap.get(c.id) || { total: 0, successful: 0 },
    }));

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/gateway/customers — Register a new customer */
router.post('/customers', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { customer_name, profile, quota_sites, quota_apps, metadata } = req.body;
    if (!customer_name) return res.status(400).json({ error: 'customer_name required' });
    if (!/^[a-z0-9][a-z0-9-]*$/.test(customer_name)) {
      return res.status(400).json({ error: 'customer_name must be lowercase alphanumeric with hyphens' });
    }

    // Check duplicate
    const existing = await queryOne(`SELECT id FROM gateway_customers WHERE customer_name = $1`, [customer_name]);
    if (existing) return res.status(409).json({ error: `Customer '${customer_name}' already exists` });

    const apiKey = generateApiKey(customer_name);
    const customer = await queryOne(
      `INSERT INTO gateway_customers (customer_name, api_key, profile, quota_sites, quota_apps, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [customer_name, apiKey, profile || 'basic', quota_sites || 10, quota_apps || 5, JSON.stringify(metadata || {})],
    );

    console.log(`[gateway] Customer registered: ${customer_name} (key: ${apiKey.slice(0, 20)}...)`);
    res.status(201).json(customer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/gateway/customers/:id — Update customer config */
router.patch('/customers/:id', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { profile, quota_sites, quota_apps, is_active, metadata } = req.body;

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (profile !== undefined) { sets.push(`profile = $${idx++}`); vals.push(profile); }
    if (quota_sites !== undefined) { sets.push(`quota_sites = $${idx++}`); vals.push(quota_sites); }
    if (quota_apps !== undefined) { sets.push(`quota_apps = $${idx++}`); vals.push(quota_apps); }
    if (is_active !== undefined) { sets.push(`is_active = $${idx++}`); vals.push(is_active); }
    if (metadata !== undefined) { sets.push(`metadata = $${idx++}`); vals.push(JSON.stringify(metadata)); }

    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    sets.push(`updated_at = now()`);
    vals.push(id);

    const customer = await queryOne(
      `UPDATE gateway_customers SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals,
    );

    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/gateway/customers/:id — Soft-delete (deactivate) a customer */
router.delete('/customers/:id', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await queryOne(
      `UPDATE gateway_customers SET is_active = false, updated_at = now() WHERE id = $1 RETURNING customer_name`,
      [id],
    );
    if (!result) return res.status(404).json({ error: 'Customer not found' });
    console.log(`[gateway] Customer deactivated: ${(result as any).customer_name}`);
    res.json({ success: true, message: `Customer '${(result as any).customer_name}' deactivated` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/gateway/customers/:id/rotate-key — Generate new API key */
router.post('/customers/:id/rotate-key', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const customer = await queryOne<GatewayCustomer>(`SELECT * FROM gateway_customers WHERE id = $1`, [id]);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const newKey = generateApiKey(customer.customer_name);
    await query(`UPDATE gateway_customers SET api_key = $1, updated_at = now() WHERE id = $2`, [newKey, id]);

    console.log(`[gateway] API key rotated for: ${customer.customer_name}`);
    res.json({ api_key: newKey, message: 'Key rotated. Update the customer server .env immediately.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/gateway/deploys — Deploy history (admin) */
router.get('/deploys', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const deploys = await query(
      `SELECT d.*, c.customer_name
       FROM gateway_deploy_log d
       JOIN gateway_customers c ON c.id = d.customer_id
       ORDER BY d.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    res.json(deploys || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
