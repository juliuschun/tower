/**
 * telegram-link.ts — Telegram account linking via /start command.
 *
 * Flow:
 * 1. User clicks "Connect Telegram" in Tower Settings
 * 2. Server creates a random link token (maps to userId)
 * 3. User opens t.me/BotName?start=TOKEN in Telegram
 * 4. Telegram sends /start TOKEN to our webhook
 * 5. We match the token → save chat_id in user_oauth_tokens
 *
 * Tokens are in-memory, expire in 10 minutes, and are single-use.
 */

import crypto from 'crypto';

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface PendingLink {
  userId: number;
  username: string;
  createdAt: number;
}

// In-memory store — lost on restart (by design: short-lived tokens)
const pendingLinks = new Map<string, PendingLink>();

/** Create a link token for a user. Returns the token string. */
export function createLinkToken(userId: number, username: string): string {
  // Invalidate any existing token for this user
  for (const [token, link] of pendingLinks) {
    if (link.userId === userId) {
      pendingLinks.delete(token);
    }
  }

  const token = crypto.randomBytes(16).toString('hex'); // 32 chars
  pendingLinks.set(token, { userId, username, createdAt: Date.now() });

  // Auto-cleanup after TTL
  setTimeout(() => pendingLinks.delete(token), TOKEN_TTL_MS);

  return token;
}

/** Consume a link token. Returns the pending link info or null if invalid/expired. */
export function consumeLinkToken(token: string): PendingLink | null {
  const link = pendingLinks.get(token);
  if (!link) return null;

  // Check expiry
  if (Date.now() - link.createdAt > TOKEN_TTL_MS) {
    pendingLinks.delete(token);
    return null;
  }

  // Single-use: delete after consumption
  pendingLinks.delete(token);
  return link;
}

/** Get pending token count (for debugging). */
export function getPendingCount(): number {
  return pendingLinks.size;
}
