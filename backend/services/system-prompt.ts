/**
 * System Prompt Service — Phase 2 of the 3-Layer Permission System.
 *
 * Builds a composite system prompt from:
 *   1. Team-wide base prompt (from DB, admin-editable)
 *   2. Role-specific context (auto-generated from user role)
 *
 * The resulting prompt is injected into Claude SDK's `systemPrompt` option
 * so all conversations start with consistent team rules + user context.
 */

import { getDb } from '../db/schema.js';

// ─── DB Operations ──────────────────────────────────────────────────────────

export interface SystemPrompt {
  id: number;
  name: string;
  prompt: string;
  updated_at: string;
}

/** Get a system prompt by name. Returns null if not found. */
export function getSystemPrompt(name: string): SystemPrompt | null {
  const db = getDb();
  return db.prepare('SELECT * FROM system_prompts WHERE name = ?').get(name) as SystemPrompt | null;
}

/** List all system prompts. */
export function listSystemPrompts(): SystemPrompt[] {
  const db = getDb();
  return db.prepare('SELECT * FROM system_prompts ORDER BY id').all() as SystemPrompt[];
}

/** Create or update a system prompt by name. */
export function upsertSystemPrompt(name: string, prompt: string): SystemPrompt {
  const db = getDb();
  db.prepare(`
    INSERT INTO system_prompts (name, prompt, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET prompt = excluded.prompt, updated_at = CURRENT_TIMESTAMP
  `).run(name, prompt);
  return getSystemPrompt(name)!;
}

/** Delete a system prompt by name. Cannot delete 'default'. */
export function deleteSystemPrompt(name: string): boolean {
  if (name === 'default') return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM system_prompts WHERE name = ?').run(name);
  return result.changes > 0;
}

// ─── Prompt Builder ─────────────────────────────────────────────────────────

const ROLE_CONTEXT: Record<string, string> = {
  admin:    'You have full system access.',
  operator: 'You have system service management privileges. sudo is restricted.',
  member:   'System package management requires IT team assistance.',
  viewer:   'You are in read-only mode. Request admin approval for file edits or command execution.',
};

/**
 * Build the final system prompt for a user session.
 *
 * Combines:
 *   - Team base prompt (from `system_prompts.default`)
 *   - User identity + role context
 *   - Allowed path info (if restricted)
 */
export function buildSystemPrompt(user: {
  username: string;
  role: string;
  allowedPath?: string;
}): string {
  // 1. Team base prompt
  const base = getSystemPrompt('default');
  const teamPrompt = base?.prompt || '';

  // 2. Role context
  const roleCtx = ROLE_CONTEXT[user.role] || ROLE_CONTEXT.member;

  // 3. Path restriction info
  const pathInfo = user.allowedPath
    ? `Your workspace is restricted to: ${user.allowedPath}`
    : '';

  // Assemble
  const parts = [
    teamPrompt,
    '',
    `User: ${user.username} (role: ${user.role})`,
    roleCtx,
    pathInfo,
  ].filter(Boolean);

  return parts.join('\n');
}
