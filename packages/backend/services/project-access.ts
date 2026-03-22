/**
 * Project-centric access control.
 *
 * Core principle: "사람 기준 접근 제어"
 * - AI가 접근 가능한 폴더 = 그 사용자가 멤버인 모든 프로젝트의 root_path
 * - admin은 전체 접근
 * - 공용 영역(docs, decisions, published)은 모두 접근 가능
 */

import path from 'path';
import { getAccessibleProjectIds, isProjectMember } from './group-manager.js';
import { queryOne } from '../db/pg-repo.js';
import { buildDamageControl, buildPathEnforcement, type DamageCheckResult } from './damage-control.js';

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.join(process.env.HOME || '/tmp', 'workspace');

// Public areas accessible by all users
const PUBLIC_DIRS = [
  path.join(WORKSPACE_ROOT, 'docs'),
  path.join(WORKSPACE_ROOT, 'decisions'),
  path.join(WORKSPACE_ROOT, 'published'),
  path.join(WORKSPACE_ROOT, 'uploads'),
];

// ─── Cache: per-user accessible paths (TTL-based) ────────────────────────────
// Avoids N+1 DB queries on every file read/write API call.
// Cache key = userId, value = { paths, expiresAt }.
// TTL = 30s — short enough that membership changes reflect quickly,
// long enough to batch rapid file operations.

const PATH_CACHE_TTL = 30_000; // 30 seconds
const pathCache = new Map<number, { paths: string[] | null; expiresAt: number }>();

function getCachedPaths(userId: number): string[] | null | undefined {
  const entry = pathCache.get(userId);
  if (!entry || Date.now() > entry.expiresAt) {
    pathCache.delete(userId);
    return undefined; // miss
  }
  return entry.paths;
}

function setCachedPaths(userId: number, paths: string[] | null): void {
  pathCache.set(userId, { paths, expiresAt: Date.now() + PATH_CACHE_TTL });
}

/** Call when membership changes (add/remove member) to invalidate immediately */
export function invalidatePathCache(userId?: number): void {
  if (userId !== undefined) {
    pathCache.delete(userId);
  } else {
    pathCache.clear(); // full flush
  }
}

// ─── API-level access checks ─────────────────────────────────────────────────

/**
 * Check if a user can access a session (via its project_id).
 * Returns { allowed: true } or { allowed: false, status, message }.
 */
export async function canAccessSession(
  sessionId: string,
  userId: number,
  role: string,
): Promise<{ allowed: true } | { allowed: false; status: number; message: string }> {
  if (role === 'admin') return { allowed: true };

  const row = await queryOne<{ project_id: string | null; user_id: number }>(
    'SELECT project_id, user_id FROM sessions WHERE id = $1',
    [sessionId],
  );
  if (!row) return { allowed: false, status: 404, message: 'Session not found' };

  // Session owner can always access
  if (row.user_id === userId) return { allowed: true };

  // No project → only owner or admin
  if (!row.project_id) {
    return { allowed: false, status: 403, message: 'Access denied: session has no project' };
  }

  // Check project membership
  if (await isProjectMember(row.project_id, userId)) return { allowed: true };

  return { allowed: false, status: 403, message: 'Access denied: not a project member' };
}

/**
 * Check if a user can access a channel (via its project_id).
 */
export async function canAccessRoom(
  roomId: string,
  userId: number,
  role: string,
): Promise<{ allowed: true } | { allowed: false; status: number; message: string }> {
  if (role === 'admin') return { allowed: true };

  const row = await queryOne<{ project_id: string | null }>(
    'SELECT project_id FROM chat_rooms WHERE id = $1',
    [roomId],
  );
  if (!row) return { allowed: false, status: 404, message: 'Room not found' };

  // No project → allow (backward compat for rooms without project)
  if (!row.project_id) return { allowed: true };

  if (await isProjectMember(row.project_id, userId)) return { allowed: true };

  return { allowed: false, status: 403, message: 'Access denied: not a project member' };
}

/**
 * Check if a user can create a session in a project.
 */
export async function canCreateInProject(
  projectId: string | null | undefined,
  userId: number,
  role: string,
): Promise<{ allowed: true } | { allowed: false; status: number; message: string }> {
  if (role === 'admin') return { allowed: true };
  if (!projectId) return { allowed: true }; // no project = personal (allowed for now)

  if (await isProjectMember(projectId, userId)) return { allowed: true };

  return { allowed: false, status: 403, message: 'Access denied: not a project member' };
}

// ─── AI folder access (canUseTool path enforcement) ──────────────────────────

/**
 * Get all directory paths a user is allowed to access (for AI tool enforcement).
 * Returns null for admin (= unrestricted).
 */
export async function getUserAccessiblePaths(
  userId: number,
  role: string,
): Promise<string[] | null> {
  if (role === 'admin') return null; // unrestricted

  // Check cache first
  const cached = getCachedPaths(userId);
  if (cached !== undefined) return cached;

  // Cache miss — query DB
  const projectIds = await getAccessibleProjectIds(userId, role);
  if (projectIds === null) {
    setCachedPaths(userId, null);
    return null; // admin path
  }

  // Single query instead of N getProject() calls
  const { query: pgQuery } = await import('../db/pg-repo.js');
  const rows = await pgQuery<{ root_path: string }>(
    `SELECT root_path FROM projects WHERE id = ANY($1) AND root_path IS NOT NULL`,
    [projectIds],
  );
  const projectPaths = rows.map(r => path.resolve(r.root_path));
  const result = [...projectPaths, ...PUBLIC_DIRS.map(d => path.resolve(d))];

  setCachedPaths(userId, result);
  return result;
}

/**
 * Build a canUseTool-compatible path enforcement function
 * that restricts file access to user's accessible project folders.
 *
 * Unlike buildPathEnforcement (single root), this supports multiple allowed roots.
 */
export function buildProjectPathEnforcement(
  allowedPaths: string[],
): (toolName: string, input: Record<string, unknown>) => DamageCheckResult {
  const roots = allowedPaths.map(p => path.resolve(p));

  return (toolName: string, input: Record<string, unknown>): DamageCheckResult => {
    const paths: string[] = [];

    // File tools: file_path, path, notebook_path
    for (const key of ['file_path', 'path', 'notebook_path']) {
      if (typeof input[key] === 'string') paths.push(input[key] as string);
    }

    // Bash: extract absolute paths
    if (toolName === 'Bash' && typeof input.command === 'string') {
      const absPaths = (input.command as string).match(
        /(?:^|\s)(\/(?!dev\/null|dev\/stderr|dev\/stdout|tmp\/|usr\/bin\/|bin\/|proc\/|sys\/)[^\s;&|>"']+)/g,
      );
      if (absPaths) paths.push(...absPaths.map(p => p.trim()));
    }

    for (const p of paths) {
      const resolved = path.resolve(p);
      const isAllowed = roots.some(root => resolved === root || resolved.startsWith(root + path.sep));
      if (!isAllowed) {
        console.warn(`[Project ACL] Denied: "${p}" not in user's accessible paths (tool: ${toolName})`);
        return {
          allowed: false,
          message: `[Access Control] "${p}" is outside your accessible project folders. Ask your admin for access.`,
        };
      }
    }

    return { allowed: true };
  };
}

// ─── ToolGuard: unified engine-agnostic tool gate ─────────────────────────────
// Combines: damage control + legacy path enforcement + project path enforcement.
// Each engine connects this differently:
//   Claude → canUseTool callback
//   Pi     → wrapPiTools(tools, guard)
//   Future → whatever hook the engine exposes

export type ToolGuardResult =
  | { allowed: true }
  | { allowed: false; message: string };

export type ToolGuard = (toolName: string, input: Record<string, unknown>) => ToolGuardResult;

/**
 * Build a unified tool guard that combines all access checks.
 * Call once per session/task, reuse for every tool call.
 */
export function buildToolGuard(opts: {
  role: string;
  allowedPath?: string;
  accessiblePaths?: string[] | null;
}): ToolGuard {
  const damageCheck = buildDamageControl(opts.role);
  const pathCheck = opts.allowedPath ? buildPathEnforcement(opts.allowedPath) : null;
  const projectPathCheck = (opts.accessiblePaths && Array.isArray(opts.accessiblePaths))
    ? buildProjectPathEnforcement(opts.accessiblePaths)
    : null;

  return (toolName: string, input: Record<string, unknown>): ToolGuardResult => {
    // 1. Damage control (role-based restrictions)
    const dc = damageCheck(toolName, input);
    if (!dc.allowed) return dc;

    // 2. Block agent teams (CPU spike risk)
    if (toolName === 'TeamCreate') {
      return { allowed: false, message: 'Agent teams are disabled on this server.' };
    }

    // 3. Block EnterWorktree in task context (managed by task-runner)
    // Note: callers can add extra checks on top of this guard

    // 4. Legacy per-user path enforcement
    if (pathCheck) {
      const pc = pathCheck(toolName, input);
      if (!pc.allowed) return pc;
    }

    // 5. Project-based path enforcement
    if (projectPathCheck) {
      const ppc = projectPathCheck(toolName, input);
      if (!ppc.allowed) return ppc;
    }

    return { allowed: true };
  };
}

/**
 * Wrap Pi SDK tools with a ToolGuard.
 * Pi tools have { name, parameters, execute(args, context) } shape.
 * Returns new tool objects with guarded execute().
 */
export function wrapPiTools(tools: any[], guard: ToolGuard): any[] {
  return tools.map(tool => {
    const toolName = tool.name || '';

    // Tools that have a 'path' parameter
    const hasPathParam = ['read', 'write', 'edit', 'grep', 'find', 'ls'].includes(toolName);
    const isBash = toolName === 'bash';

    if (!hasPathParam && !isBash) return tool; // no path to check

    const origExecute = tool.execute;

    return {
      ...tool,
      execute: async (args: any, context: any) => {
        // Map Pi param names → guard expected format
        const input: Record<string, unknown> = {};
        if (hasPathParam && args.path) {
          input.file_path = args.path;
        }
        if (isBash && args.command) {
          input.command = args.command;
        }

        // Capitalize tool name for consistency with Claude tool names
        const guardName = toolName.charAt(0).toUpperCase() + toolName.slice(1);
        const check = guard(guardName, input);
        if (!check.allowed) {
          return {
            content: [{ type: 'text', text: `[Access Denied] ${check.message}` }],
          };
        }

        return origExecute.call(tool, args, context);
      },
    };
  });
}

// ─── File browser filtering ──────────────────────────────────────────────────

/**
 * Get the list of project folders a user can see in the file browser.
 * Returns folder paths under workspace/projects/ that the user has access to,
 * plus public areas.
 */
export async function getVisibleFilePaths(
  userId: number,
  role: string,
): Promise<{ projectPaths: string[]; publicPaths: string[]; isAdmin: boolean }> {
  if (role === 'admin') {
    return {
      projectPaths: [], // empty = show all (admin)
      publicPaths: PUBLIC_DIRS,
      isAdmin: true,
    };
  }

  const accessiblePaths = await getUserAccessiblePaths(userId, role);
  return {
    projectPaths: accessiblePaths || [],
    publicPaths: PUBLIC_DIRS,
    isAdmin: false,
  };
}

/**
 * Check if a specific file path is accessible to a user.
 * Used by file read/write/delete APIs.
 */
export async function isPathAccessible(
  filePath: string,
  userId: number,
  role: string,
): Promise<boolean> {
  if (role === 'admin') return true;

  const resolved = path.resolve(filePath);
  const projectsDir = path.resolve(path.join(WORKSPACE_ROOT, 'projects'));

  // If not under projects/, check public areas and workspace root
  if (!resolved.startsWith(projectsDir + path.sep)) {
    // Public areas
    for (const pub of PUBLIC_DIRS) {
      const pubResolved = path.resolve(pub);
      if (resolved === pubResolved || resolved.startsWith(pubResolved + path.sep)) return true;
    }
    // Workspace root files (principles.md etc)
    if (resolved === path.resolve(WORKSPACE_ROOT) || (resolved.startsWith(path.resolve(WORKSPACE_ROOT) + path.sep) && !resolved.startsWith(projectsDir + path.sep))) {
      return true;
    }
    return false;
  }

  // Under projects/ → check project membership
  const accessiblePaths = await getUserAccessiblePaths(userId, role);
  if (accessiblePaths === null) return true; // admin

  return accessiblePaths.some(root => {
    const rootResolved = path.resolve(root);
    return resolved === rootResolved || resolved.startsWith(rootResolved + path.sep);
  });
}

// ─── Auto-mapping: cwd → project_id ──────────────────────────────────────────

/**
 * Find the project whose root_path matches (or contains) a given cwd.
 * Used to auto-assign project_id when creating sessions without explicit projectId.
 * Returns project id or null if no match.
 */
export async function findProjectByPath(cwd: string): Promise<string | null> {
  const resolved = path.resolve(cwd);
  const { query: pgQuery } = await import('../db/pg-repo.js');
  const rows = await pgQuery<{ id: string; root_path: string }>(
    `SELECT id, root_path FROM projects WHERE root_path IS NOT NULL AND (archived IS NULL OR archived = 0)`,
    [],
  );
  // Find the most specific (longest) root_path that contains the cwd
  let bestMatch: { id: string; len: number } | null = null;
  for (const row of rows) {
    const rootResolved = path.resolve(row.root_path);
    if (resolved === rootResolved || resolved.startsWith(rootResolved + path.sep)) {
      if (!bestMatch || rootResolved.length > bestMatch.len) {
        bestMatch = { id: row.id, len: rootResolved.length };
      }
    }
  }
  return bestMatch?.id ?? null;
}
