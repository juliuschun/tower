import { getDb } from '../db/schema.js';
import { randomUUID } from 'crypto';

export interface Share {
  id: string;
  file_path: string;
  owner_id: number;
  share_type: 'internal' | 'external';
  target_user_id?: number;
  token?: string;
  expires_at?: string;
  revoked: number;
  created_at: string;
}

export interface ShareWithMeta extends Share {
  owner_username?: string;
  target_username?: string;
}

const EXPIRES_MAP: Record<string, number> = {
  '1h':  1 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7 * 24 * 60 * 60 * 1000,
};

export function createInternalShare(filePath: string, ownerId: number, targetUserId: number): Share {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO shares (id, file_path, owner_id, share_type, target_user_id)
    VALUES (?, ?, ?, 'internal', ?)
  `).run(id, filePath, ownerId, targetUserId);
  return db.prepare('SELECT * FROM shares WHERE id = ?').get(id) as Share;
}

export function createExternalShare(filePath: string, ownerId: number, expiresIn: string): Share & { token: string } {
  const db = getDb();
  const id = randomUUID();
  const token = randomUUID().replace(/-/g, '');
  const ms = EXPIRES_MAP[expiresIn] ?? EXPIRES_MAP['24h'];
  const expiresAt = new Date(Date.now() + ms).toISOString();
  db.prepare(`
    INSERT INTO shares (id, file_path, owner_id, share_type, token, expires_at)
    VALUES (?, ?, ?, 'external', ?, ?)
  `).run(id, filePath, ownerId, token, expiresAt);
  return db.prepare('SELECT * FROM shares WHERE id = ?').get(id) as Share & { token: string };
}

export function getSharesByFile(filePath: string, ownerId: number): ShareWithMeta[] {
  const db = getDb();
  return db.prepare(`
    SELECT s.*, u.username as target_username
    FROM shares s
    LEFT JOIN users u ON s.target_user_id = u.id
    WHERE s.file_path = ? AND s.owner_id = ? AND s.revoked = 0
    ORDER BY s.created_at DESC
  `).all(filePath, ownerId) as ShareWithMeta[];
}

export function getSharesWithMe(targetUserId: number): ShareWithMeta[] {
  const db = getDb();
  return db.prepare(`
    SELECT s.*, u.username as owner_username
    FROM shares s
    JOIN users u ON s.owner_id = u.id
    WHERE s.target_user_id = ? AND s.share_type = 'internal' AND s.revoked = 0
    ORDER BY s.created_at DESC
  `).all(targetUserId) as ShareWithMeta[];
}

export function getShareByToken(token: string): Share | null {
  const db = getDb();
  return db.prepare('SELECT * FROM shares WHERE token = ?').get(token) as Share | null;
}

export function revokeShare(shareId: string, ownerId: number): boolean {
  const db = getDb();
  const result = db.prepare(`
    UPDATE shares SET revoked = 1 WHERE id = ? AND owner_id = ? AND share_type = 'external'
  `).run(shareId, ownerId);
  return result.changes > 0;
}

export function hasInternalShareForUser(filePath: string, userId: number): boolean {
  const db = getDb();
  const row = db.prepare(`
    SELECT 1 FROM shares
    WHERE file_path = ? AND target_user_id = ? AND share_type = 'internal' AND revoked = 0
    LIMIT 1
  `).get(filePath, userId);
  return !!row;
}

export function isTokenValid(share: Share): boolean {
  if (share.revoked) return false;
  if (share.expires_at && new Date(share.expires_at) < new Date()) return false;
  return true;
}
