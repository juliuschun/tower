import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getDb } from '../db/schema.js';
import { VALID_ROLES } from './damage-control.js';
import type { Request, Response, NextFunction } from 'express';

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

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

export function createUser(username: string, password: string, role = 'member') {
  const db = getDb();
  const hash = hashPassword(password);
  const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
  return { id: result.lastInsertRowid as number, username, role };
}

export function authenticateUser(username: string, password: string): JwtPayload | null {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND disabled = 0').get(username) as any;
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return { userId: user.id, username: user.username, role: user.role };
}

export function hasUsers(): boolean {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM users WHERE disabled = 0').get() as any;
  return row.count > 0;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!config.authEnabled) return next();

  const authHeader = req.headers.authorization;
  const queryToken = req.query?.token as string | undefined;
  const rawToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : queryToken || null;

  if (!rawToken) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const payload = verifyToken(rawToken);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  (req as any).user = payload;
  next();
}

// ───── Admin user management ─────

export function listUsers() {
  const db = getDb();
  return db.prepare(
    'SELECT id, username, role, allowed_path, created_at FROM users WHERE disabled = 0 ORDER BY id'
  ).all();
}

export function updateUserRole(userId: number, role: string) {
  if (!VALID_ROLES.has(role)) {
    throw new Error(`Invalid role: ${role}. Valid roles: ${[...VALID_ROLES].join(', ')}`);
  }
  const db = getDb();
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
}

export function updateUserPath(userId: number, allowedPath: string) {
  const db = getDb();
  db.prepare('UPDATE users SET allowed_path = ? WHERE id = ?').run(allowedPath, userId);
}

export function resetUserPassword(userId: number, newPassword: string) {
  const db = getDb();
  const hash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
}

export function disableUser(userId: number) {
  const db = getDb();
  db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(userId);
}

export function getUserAllowedPath(userId: number): string {
  const db = getDb();
  const row = db.prepare('SELECT allowed_path FROM users WHERE id = ?').get(userId) as any;
  return row?.allowed_path || config.workspaceRoot;
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
