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
import { hasInternalShareAccess } from './session-share-manager.js';

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.join(process.env.HOME || '/tmp', 'workspace');

// Public areas accessible by all users
const PUBLIC_DIRS = [
  path.join(WORKSPACE_ROOT, 'docs'),
  path.join(WORKSPACE_ROOT, 'decisions'),
  path.join(WORKSPACE_ROOT, 'published'),
  path.join(WORKSPACE_ROOT, 'uploads'),
];

// Shared WRITE roots — explicit exceptions to the session-scope guard.
// Sessions are otherwise confined to their own project root for writes.
// These are the sanctioned cross-project output destinations.
const SHARED_WRITE_DIRS = [
  path.join(WORKSPACE_ROOT, 'published'),
  path.join(WORKSPACE_ROOT, 'decisions'),
  path.join(WORKSPACE_ROOT, 'docs'),
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

  // Check internal share access
  if (await hasInternalShareAccess(sessionId, userId)) return { allowed: true };

  // No project → only owner, admin, or internal share
  if (!row.project_id) {
    return { allowed: false, status: 403, message: 'Access denied: session has no project' };
  }

  // Check project membership
  if (await isProjectMember(row.project_id, userId)) return { allowed: true };

  return { allowed: false, status: 403, message: 'Access denied: not a project member' };
}

/**
 * Check if a user can DELETE a session.
 * Allowed: admin, session owner, or project owner.
 * Project members can view but NOT delete other users' sessions.
 */
export async function canDeleteSession(
  sessionId: string,
  userId: number,
  role: string,
): Promise<{ allowed: true } | { allowed: false; status: number; message: string }> {
  if (role === 'admin') return { allowed: true };

  const row = await queryOne<{ user_id: number; project_id: string | null }>(
    'SELECT user_id, project_id FROM sessions WHERE id = $1',
    [sessionId],
  );
  if (!row) return { allowed: false, status: 404, message: 'Session not found' };

  if (row.user_id === userId) return { allowed: true };

  // Project owners can delete any session within their project
  if (row.project_id) {
    const membership = await queryOne<{ role: string }>(
      'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2',
      [row.project_id, userId],
    );
    if (membership?.role === 'owner') return { allowed: true };
  }

  return { allowed: false, status: 403, message: 'Access denied: only the session owner can delete' };
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

/**
 * Check if a user can access a task (owner, or project member).
 */
export async function canAccessTask(
  taskId: string,
  userId: number,
  role: string,
): Promise<{ allowed: true } | { allowed: false; status: number; message: string }> {
  if (role === 'admin') return { allowed: true };

  const row = await queryOne<{ user_id: number | null; project_id: string | null }>(
    'SELECT user_id, project_id FROM tasks WHERE id = $1',
    [taskId],
  );
  if (!row) return { allowed: false, status: 404, message: 'Task not found' };

  // Owner always has access
  if (row.user_id === userId) return { allowed: true };

  // Project member can access project tasks
  if (row.project_id && await isProjectMember(row.project_id, userId)) return { allowed: true };

  return { allowed: false, status: 403, message: 'Access denied' };
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

    // File tools: file_path, path, notebook_path, files[]
    for (const key of ['file_path', 'path', 'notebook_path']) {
      if (typeof input[key] === 'string') paths.push(input[key] as string);
    }
    if (Array.isArray(input.files)) {
      paths.push(...input.files.filter((p): p is string => typeof p === 'string'));
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

// ─── Session-scoped write guard (役割 무관) ──────────────────────────────────
//
// The accessible-paths guard above restricts by USER (all projects the user is a
// member of). This guard restricts by SESSION (the project this session is bound
// to). Without it, a session rooted in project A can still write into project B
// just because the user is a member of both — or, worse, create a brand-new
// `workspace/projects/<invented-name>/` folder that's not registered in the DB
// and becomes invisible to every project UI.
//
// Applies to admin as well — session boundaries are an orthogonal axis to roles.
// Writes under `workspace/projects/` MUST stay inside the session's project root.
// Writes into SHARED_WRITE_DIRS (`published/`, `decisions/`, `docs/`, `uploads/`)
// remain allowed as the sanctioned cross-project output destinations.
// Writes anywhere outside `workspace/projects/` are delegated to the existing
// accessible-paths guard below (which handles e.g. `~/tower/` vs `workspace/`).

/**
 * Resolve a cwd to its enclosing project root under `workspace/projects/<slug>/`.
 * Returns null if cwd is not under workspace/projects/ (non-project session, etc).
 * Never escapes the slug boundary — e.g. cwd=`projects/okusystem/strategy/` → `projects/okusystem/`.
 */
export function resolveSessionProjectRoot(cwd: string | undefined): string | null {
  if (!cwd) return null;
  const resolved = path.resolve(cwd);
  const projectsDir = path.resolve(WORKSPACE_ROOT, 'projects');
  if (!resolved.startsWith(projectsDir + path.sep)) return null;
  const rel = path.relative(projectsDir, resolved);
  const slug = rel.split(path.sep)[0];
  if (!slug || slug === '..' || slug === '.') return null;
  return path.join(projectsDir, slug);
}

/** Tools that can mutate the filesystem (direct write path). */
const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit']);

/** Bash subcommands that mutate the filesystem — used for shallow detection. */
const BASH_MUTATOR_RE = /\b(mkdir|touch|mv|cp|rm|tee|ln|install|rsync|chmod|chown)\b/;
const BASH_REDIRECT_RE = /(?:^|[^0-9&])(>>?|\|\s*tee\b)/;

/**
 * Build a guard that blocks writes outside the current session's project root.
 * Role-independent: admin is NOT exempt. Sessions ARE their project boundary.
 *
 * Allowed write destinations:
 *   1. Anywhere under `sessionProjectRoot/`
 *   2. SHARED_WRITE_DIRS (published/decisions/docs/uploads)
 *   3. Outside `workspace/projects/` entirely — delegated to accessible-paths guard
 *
 * Denied:
 *   - `workspace/projects/<other>/...` (different project)
 *   - `workspace/projects/<new-invented-name>/...` (never-registered folder)
 */
export function buildSessionWriteGuard(
  sessionProjectRoot: string,
): (toolName: string, input: Record<string, unknown>) => DamageCheckResult {
  const projectRoot = path.resolve(sessionProjectRoot);
  const projectsDir = path.resolve(WORKSPACE_ROOT, 'projects');
  const sharedRoots = SHARED_WRITE_DIRS.map(d => path.resolve(d));

  const isWriteToolPath = (resolved: string): boolean => {
    // If the target is NOT under workspace/projects/, this guard is silent —
    // the accessible-paths guard decides. (We don't want to double-restrict
    // legitimate shared writes or workspace root files.)
    if (resolved !== projectsDir && !resolved.startsWith(projectsDir + path.sep)) {
      return true;
    }
    // Under projects/ → must be inside the session's own project root.
    if (resolved === projectRoot || resolved.startsWith(projectRoot + path.sep)) {
      return true;
    }
    // Shared-write exceptions (belt & suspenders — shared dirs are not under projects/,
    // so this branch is unreachable in practice, but keeps the rule explicit).
    if (sharedRoots.some(r => resolved === r || resolved.startsWith(r + path.sep))) {
      return true;
    }
    return false;
  };

  return (toolName: string, input: Record<string, unknown>): DamageCheckResult => {
    const isWriteTool = WRITE_TOOLS.has(toolName);
    const isBash = toolName === 'Bash';
    if (!isWriteTool && !isBash) return { allowed: true };

    const paths: string[] = [];

    if (isWriteTool) {
      for (const key of ['file_path', 'path', 'notebook_path']) {
        if (typeof input[key] === 'string') paths.push(input[key] as string);
      }
      // MultiEdit may pass edits with file_path; also handle top-level file_path above.
      if (Array.isArray(input.files)) {
        paths.push(...input.files.filter((p): p is string => typeof p === 'string'));
      }
    }

    if (isBash && typeof input.command === 'string') {
      const cmd = input.command as string;
      const looksMutating = BASH_MUTATOR_RE.test(cmd) || BASH_REDIRECT_RE.test(cmd);
      if (looksMutating) {
        // Extract plausible absolute paths from the command (same heuristic as
        // buildProjectPathEnforcement, but we only care about mutation commands here).
        const absPaths = cmd.match(
          /(?:^|\s)(\/(?!dev\/null|dev\/stderr|dev\/stdout|tmp\/|usr\/bin\/|bin\/|proc\/|sys\/)[^\s;&|>"']+)/g,
        );
        if (absPaths) paths.push(...absPaths.map(p => p.trim()));
      }
    }

    for (const p of paths) {
      const resolved = path.resolve(p);
      if (!isWriteToolPath(resolved)) {
        const slug = path.basename(projectRoot);
        console.warn(
          `[Session Write Guard] Denied: "${p}" — session is scoped to ${projectRoot} (tool: ${toolName})`,
        );
        return {
          allowed: false,
          message:
            `[Session Boundary] Cannot write "${p}". This session is scoped to project "${slug}" ` +
            `(${projectRoot}). Writes to other project folders — or creating a brand-new ` +
            `workspace/projects/<name>/ folder — are not allowed from within this session. ` +
            `If you need a new project, ask the user to create it from the UI. ` +
            `If you need to edit another project, open a session there. ` +
            `Shared outputs can go under workspace/{published,decisions,docs,uploads}/.`,
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
  /**
   * The project root this session is bound to (resolved from cwd).
   * When present, writes under `workspace/projects/` are confined to this root —
   * applies to ALL roles including admin. See buildSessionWriteGuard().
   * Pass undefined for non-project sessions (no session-scope restriction).
   */
  sessionProjectRoot?: string;
}): ToolGuard {
  const damageCheck = buildDamageControl(opts.role);
  const pathCheck = opts.allowedPath ? buildPathEnforcement(opts.allowedPath) : null;
  const projectPathCheck = (opts.accessiblePaths && Array.isArray(opts.accessiblePaths))
    ? buildProjectPathEnforcement(opts.accessiblePaths)
    : null;
  const sessionWriteCheck = opts.sessionProjectRoot
    ? buildSessionWriteGuard(opts.sessionProjectRoot)
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

    // 4. Session-scoped WRITE guard (role-independent; blocks cross-project writes
    //    and creation of new workspace/projects/<x>/ folders from inside a session).
    if (sessionWriteCheck) {
      const sw = sessionWriteCheck(toolName, input);
      if (!sw.allowed) return sw;
    }

    // 5. Legacy per-user path enforcement
    if (pathCheck) {
      const pc = pathCheck(toolName, input);
      if (!pc.allowed) return pc;
    }

    // 6. Project-based path enforcement (user-level accessible paths)
    if (projectPathCheck) {
      const ppc = projectPathCheck(toolName, input);
      if (!ppc.allowed) return ppc;
    }

    return { allowed: true };
  };
}

/**
 * Wrap Pi SDK tools with a ToolGuard.
 * Pi tools have { name, parameters, execute(toolCallId, args, signal) } shape.
 * Returns new tool objects with guarded execute().
 *
 * ALL tools are wrapped — damage control (role-based whitelist) applies to every tool,
 * not just file/bash tools. Path extraction only runs for known file tools.
 */
export function wrapPiTools(tools: any[], guard: ToolGuard): any[] {
  const normalizeToolName = (name: string) => {
    if (!name.includes('_')) return name.charAt(0).toUpperCase() + name.slice(1);
    return name
      .split('_')
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  };

  return tools.map(tool => {
    const toolName: string = tool.name || '';
    if (!tool.execute) return tool; // safety: skip if no execute

    const origExecute = tool.execute;
    const isBash = toolName === 'bash';

    return {
      ...tool,
      execute: async (...execArgs: any[]) => {
        // Pi tool execute signature: (toolCallId, params, signal)
        // Custom tools may also use (toolCallId, params, signal)
        const args = execArgs[1] ?? execArgs[0] ?? {};

        // Map Pi param names → guard expected format
        const input: Record<string, unknown> = {};
        if (args.path) input.file_path = args.path;
        if (args.file_path) input.file_path = args.file_path;
        if (args.notebook_path) input.notebook_path = args.notebook_path;
        if (Array.isArray(args.files)) input.files = args.files;
        if (isBash && args.command) input.command = args.command;

        const guardName = normalizeToolName(toolName);
        const check = guard(guardName, input);
        if (!check.allowed) {
          return {
            content: [{ type: 'text', text: `[Access Denied] ${check.message}` }],
          };
        }

        return origExecute.call(tool, ...execArgs);
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

  // If not under projects/, check public areas, workspace root, and external project root_paths
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
    // External project root_paths (codebase browsing for project members)
    const accessiblePaths = await getUserAccessiblePaths(userId, role);
    if (accessiblePaths === null) return true; // admin
    return accessiblePaths.some(root => {
      const rootResolved = path.resolve(root);
      return resolved === rootResolved || resolved.startsWith(rootResolved + path.sep);
    });
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
