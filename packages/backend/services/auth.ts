import crypto from 'crypto';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query, queryOne, execute } from '../db/pg-repo.js';
import { VALID_ROLES } from './damage-control.js';
import type { Request, Response, NextFunction } from 'express';

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

// ───── AES-256-GCM Encryption ─────

const ALGO = 'aes-256-gcm';

function deriveKey(): Buffer {
  // Derive a 32-byte key from JWT secret using SHA-256
  return crypto.createHash('sha256').update(config.jwtSecret).digest();
}

export function encryptPassword(plain: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:encrypted (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptPassword(stored: string): string | null {
  try {
    const [ivHex, tagHex, encHex] = stored.split(':');
    if (!ivHex || !tagHex || !encHex) return null;
    const key = deriveKey();
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null; // Not AES-encrypted (legacy bcrypt hash)
  }
}

function isAesEncrypted(stored: string): boolean {
  // AES format has two colons: iv:tag:encrypted
  return stored.split(':').length === 3;
}

// ───── Legacy bcrypt (for migration) ─────

function verifyBcrypt(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

// ───── JWT ─────

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.tokenExpiry as any });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as JwtPayload;
  } catch {
    return null;
  }
}

// ───── User CRUD ─────

export async function createUser(username: string, password: string, role = 'member') {
  const encrypted = encryptPassword(password);
  const row = await queryOne<{ id: number }>(
    'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
    [username, encrypted, role]
  );
  return { id: row!.id, username, role };
}

export async function authenticateUser(username: string, password: string): Promise<JwtPayload | null> {
  const user = await queryOne<any>(
    'SELECT * FROM users WHERE username = $1 AND disabled = 0',
    [username]
  );
  if (!user) return null;

  const stored = user.password_hash;
  let ok = false;

  if (isAesEncrypted(stored)) {
    // New AES path
    const decrypted = decryptPassword(stored);
    ok = decrypted === password;
  } else {
    // Legacy bcrypt fallback
    ok = verifyBcrypt(password, stored);
    // Auto-migrate to AES on successful login
    if (ok) {
      const encrypted = encryptPassword(password);
      await execute('UPDATE users SET password_hash = $1 WHERE id = $2', [encrypted, user.id]);
    }
  }

  if (!ok) return null;
  return { userId: user.id, username: user.username, role: user.role };
}

export async function hasUsers(): Promise<boolean> {
  const row = await queryOne<{ count: string }>('SELECT COUNT(*) as count FROM users WHERE disabled = 0');
  return Number(row!.count) > 0;
}

export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  const queryToken = req.query?.token as string | undefined;
  if (queryToken) return queryToken;
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/(?:^|;\s*)tower_token=([^;]+)/);
  if (match) return match[1];
  return null;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!config.authEnabled) return next();

  const rawToken = extractToken(req);

  if (!rawToken) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const payload = verifyToken(rawToken);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Cookie sync: if authenticated via header/query but no cookie yet, set it.
  // This ensures the browser always has the httpOnly cookie for Nginx auth_request
  // (e.g., when opening /hub/ in a new tab where Authorization header isn't sent).
  const cookies = req.headers.cookie || '';
  if (!cookies.includes('tower_token=')) {
    res.cookie('tower_token', rawToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
    });
  }

  (req as any).user = payload;
  next();
}

// ───── Admin user management ─────

export async function listUsers() {
  const rows = await query<any>(
    'SELECT id, username, role, allowed_path, password_hash, created_at FROM users WHERE disabled = 0 ORDER BY id'
  );

  return rows.map(r => ({
    id: r.id,
    username: r.username,
    role: r.role,
    allowed_path: r.allowed_path,
    // Decrypt password for admin view; show empty for legacy bcrypt
    password_plain: isAesEncrypted(r.password_hash) ? decryptPassword(r.password_hash) || '' : '',
    created_at: r.created_at,
  }));
}

export async function updateUserRole(userId: number, role: string) {
  if (!VALID_ROLES.has(role)) {
    throw new Error(`Invalid role: ${role}. Valid roles: ${[...VALID_ROLES].join(', ')}`);
  }
  await execute('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
}

export async function updateUserPath(userId: number, allowedPath: string) {
  await execute('UPDATE users SET allowed_path = $1 WHERE id = $2', [allowedPath, userId]);
}

export async function resetUserPassword(userId: number, newPassword: string) {
  const encrypted = encryptPassword(newPassword);
  await execute('UPDATE users SET password_hash = $1 WHERE id = $2', [encrypted, userId]);
}

export async function disableUser(userId: number) {
  await execute('UPDATE users SET disabled = 1 WHERE id = $1', [userId]);
}

/**
 * Returns the filesystem path a user is allowed to access.
 *
 * Resolution order:
 *   1. Explicit `allowed_path` column on the user row (admin-set)
 *   2. Role-based safe default when unset:
 *        admin    → config.workspaceRoot (full workspace)
 *        operator → config.workspaceRoot (full workspace)
 *        member   → workspace/projects/  (projects only — safer default)
 *        viewer   → workspace/projects/  (projects only — safer default)
 *
 * Rationale: non-admin users should not silently receive full workspace
 * access just because an admin forgot to set allowed_path on creation.
 * The AdminPanel surfaces a warning badge for empty values so admins
 * can promote to broader access explicitly.
 */
export async function getUserAllowedPath(userId: number): Promise<string> {
  const row = await queryOne<{ allowed_path: string | null; role: string | null }>(
    'SELECT allowed_path, role FROM users WHERE id = $1',
    [userId],
  );
  if (row?.allowed_path) return row.allowed_path;
  const role = row?.role || 'member';
  if (role === 'admin' || role === 'operator') {
    return config.workspaceRoot;
  }
  // member / viewer / unknown → restrict to projects/ by default
  return path.join(config.workspaceRoot, 'projects');
}

export function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export function verifyWsToken(token: string | null): JwtPayload | null {
  if (!config.authEnabled) return { userId: 0, username: 'anonymous', role: 'admin' };
  if (!token) return null;
  return verifyToken(token);
}
