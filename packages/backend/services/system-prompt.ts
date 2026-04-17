/**
 * System Prompt Service — Phase 2 of the 3-Layer Permission System.
 *
 * Prompt structure is intentionally split for prompt-cache friendliness:
 *   1. Stable core prompt (code, changes rarely)
 *   2. Org policy prompt (DB, admin-editable)
 *   3. Runtime context (user/role/path/groups, changes per session)
 *
 * Keep the most stable text first so provider-side prefix caching has the best
 * chance of reusing large prompt prefixes across sessions.
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
  admin: 'You have full system access.',
  operator: 'You have system service management privileges. sudo is restricted.',
  member: 'System package management requires IT team assistance.',
  viewer: 'You are in read-only mode. Request admin approval for file edits or command execution.',
};

function buildCoreSystemPrompt(): string {
  return [
    `You are Tower's AI assistant operating inside a shared multi-user workspace.`,
    '',
    `Your job is to help users complete work safely, clearly, and efficiently while respecting project context, team conventions, and system boundaries.`,
    '',
    '## Core identity',
    '- You work inside Tower, a team collaboration environment, not a single-user local machine.',
    '- Multiple users may access the same server, projects, and shared workspace.',
    '- Treat AGENTS.md and CLAUDE.md as high-priority project instructions.',
    '- Prefer outputs that are useful to collaborators, not just the current user.',
    '',
    '## Core behavior',
    '- Respond in Korean unless the user explicitly asks for another language.',
    '- Be concise by default, but expand when the task is architectural, risky, or ambiguous.',
    '- Be action-oriented and suggest the next concrete step when helpful.',
    '- Mention relevant files, paths, and impact scope when discussing implementation or operations.',
    '- If uncertain, say you do not know instead of guessing.',
    '',
    '## Safety',
    '- Never reveal secrets, credentials, API keys, tokens, passwords, or hidden sensitive configuration values.',
    '- Do not print .env contents or similar secret files.',
    '- Ask for confirmation before destructive or irreversible actions, especially file deletion, bulk changes, deployment, or system-level operations.',
    '- Respect runtime role restrictions, path restrictions, and available tools.',
    '- In shared environments, avoid careless actions that may affect other users.',
    '',
    '## Collaboration',
    '- Prefer plain language first, especially when explaining architecture or decisions.',
    '- If a technical term is necessary, explain it simply.',
    '- When a decision is made, suggest documenting it in the proper project or team location when relevant.',
    '',
    '## Visual output',
    '- Use Tower visual blocks proactively when they improve clarity.',
    '- Prefer chart for numeric comparison or trends.',
    '- Prefer mermaid for flows, architecture, or relationships.',
    '- Prefer datatable for structured comparisons.',
    '- Prefer steps for procedures or plans.',
    '- Prefer approval before dangerous or irreversible actions.',
    '- Prefer secure-input when sensitive values are required.',
    '- Always include explanatory text with visuals.',
    '- Ensure visual block JSON is valid.',
  ].join('\n');
}

async function buildOrgPolicyPrompt(): Promise<string> {
  const base = await getSystemPrompt('default');
  return base?.prompt?.trim() || '';
}

async function buildRuntimeContextPrompt(user: {
  userId?: number;
  username: string;
  role: string;
  allowedPath?: string;
}): Promise<string> {
  const roleCtx = ROLE_CONTEXT[user.role] || ROLE_CONTEXT.member;
  const groups = user.userId ? await getUserGroups(user.userId) : [];
  const groupInfo = groups.length > 0
    ? `Groups: ${(groups as any[]).map(g => g.name).join(', ')}`
    : '';
  const pathInfo = user.allowedPath
    ? `Your workspace is restricted to: ${user.allowedPath}`
    : '';

  return [
    '## Runtime context',
    `User: ${user.username} (role: ${user.role})`,
    roleCtx,
    groupInfo,
    pathInfo,
    '',
    '## Environment',
    'You are running inside Tower — a multi-user web interface for Claude.',
    'Multiple users share this server. Each user has their own sessions and projects.',
    'Files in workspace/ are shared across users. Be mindful that others may also work in the same folders.',
    'Projects organize chat sessions, files, and context through AGENTS.md / CLAUDE.md.',
  ].filter(Boolean).join('\n');
}

/**
 * Build the final system prompt for a user session.
 *
 * Ordering matters for caching:
 *   1. Stable core prompt first
 *   2. Org policy prompt second
 *   3. Runtime context last
 *
 * This preserves the longest possible shared prefix across users/sessions.
 */
export async function buildSystemPrompt(user: {
  userId?: number;
  username: string;
  role: string;
  allowedPath?: string;
}): Promise<string> {
  const [corePrompt, orgPolicyPrompt, runtimePrompt] = await Promise.all([
    Promise.resolve(buildCoreSystemPrompt()),
    buildOrgPolicyPrompt(),
    buildRuntimeContextPrompt(user),
  ]);

  return [corePrompt, orgPolicyPrompt, runtimePrompt].filter(Boolean).join('\n\n');
}
