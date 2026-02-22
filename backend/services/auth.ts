import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getDb } from '../db/schema.js';
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

export function createUser(username: string, password: string, role = 'user') {
  const db = getDb();
  const hash = hashPassword(password);
  const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
  return { id: result.lastInsertRowid as number, username, role };
}

export function authenticateUser(username: string, password: string): JwtPayload | null {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return { userId: user.id, username: user.username, role: user.role };
}

export function hasUsers(): boolean {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
  return row.count > 0;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!config.authEnabled) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const payload = verifyToken(authHeader.slice(7));
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  (req as any).user = payload;
  next();
}

export function verifyWsToken(token: string | null): JwtPayload | null {
  if (!config.authEnabled) return { userId: 0, username: 'anonymous', role: 'admin' };
  if (!token) return null;
  return verifyToken(token);
}
