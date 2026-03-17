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

import { query, queryOne, execute } from '../db/pg-repo.js';
import { getUserGroups } from './group-manager.js';

// ─── DB Operations ──────────────────────────────────────────────────────────

export interface SystemPrompt {
  id: number;
  name: string;
  prompt: string;
  updated_at: string;
}

/** Get a system prompt by name. Returns null if not found. */
export async function getSystemPrompt(name: string): Promise<SystemPrompt | null> {
  const row = await queryOne<SystemPrompt>('SELECT * FROM system_prompts WHERE name = $1', [name]);
  return row ?? null;
}

/** List all system prompts. */
export async function listSystemPrompts(): Promise<SystemPrompt[]> {
  return await query<SystemPrompt>('SELECT * FROM system_prompts ORDER BY id');
}

/** Create or update a system prompt by name. */
export async function upsertSystemPrompt(name: string, prompt: string): Promise<SystemPrompt> {
  await execute(`
    INSERT INTO system_prompts (name, prompt, updated_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET prompt = excluded.prompt, updated_at = CURRENT_TIMESTAMP
  `, [name, prompt]);
  return (await getSystemPrompt(name))!;
}

/** Delete a system prompt by name. Cannot delete 'default'. */
export async function deleteSystemPrompt(name: string): Promise<boolean> {
  if (name === 'default') return false;
  const result = await execute('DELETE FROM system_prompts WHERE name = $1', [name]);
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
export async function buildSystemPrompt(user: {
  userId?: number;
  username: string;
  role: string;
  allowedPath?: string;
}): Promise<string> {
  // 1. Team base prompt
  const base = await getSystemPrompt('default');
  const teamPrompt = base?.prompt || '';

  // 2. Tower environment context
  const towerCtx = [
    '## Environment',
    'You are running inside Tower — a multi-user web interface for Claude.',
    'Multiple users share this server. Each user has their own sessions and projects.',
    'Files in workspace/ are shared across users. Be mindful that others may also work in the same folders.',
    'Projects organize chat sessions and provide context via AGENTS.md files.',
  ].join('\n');

  // 3. Role context
  const roleCtx = ROLE_CONTEXT[user.role] || ROLE_CONTEXT.member;

  // 4. User identity + groups
  const groups = user.userId ? await getUserGroups(user.userId) : [];
  const groupInfo = groups.length > 0
    ? `Groups: ${(groups as any[]).map(g => g.name).join(', ')}`
    : '';

  // 5. Path restriction info
  const pathInfo = user.allowedPath
    ? `Your workspace is restricted to: ${user.allowedPath}`
    : '';

  // 6. Visualization format guide
  const vizGuide = [
    '## Visualization',
    'When presenting data visually, use these code block formats:',
    '',
    '- Diagrams: ```mermaid (flowchart, sequence, class, ER)',
    '- Charts: ```chart with JSON body: { "type": "bar|line|area|pie|scatter|radar|composed", "data": [...], "xKey": "...", "yKey": "..." }',
    '- Math: $$block LaTeX$$ (do NOT use single $ for inline math)',
    '',
    'Chart types: bar, line, area, pie, scatter, radar, composed.',
    'Use charts when comparing 3+ numeric values. Use tables for detailed comparisons.',
    'JSON must be valid — no trailing commas, no comments.',
  ].join('\n');

  // Assemble
  const parts = [
    teamPrompt,
    '',
    towerCtx,
    '',
    `User: ${user.username} (role: ${user.role})`,
    roleCtx,
    groupInfo,
    pathInfo,
    '',
    vizGuide,
  ].filter(Boolean);

  return parts.join('\n');
}
