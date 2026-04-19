/**
 * Skill Registry — 3-tier skill management (company / project / personal).
 *
 * 2026-04-17 재설계 (workspace/decisions/2026-04-17-skill-db-simplification.md):
 *  - company 스킬은 DB에 저장하지 않음. library.yaml + ~/.claude/skills/ 가 단일 소스.
 *    (library-skills.ts 가 파싱/캐시 담당)
 *  - DB `skill_registry` 는 scope IN ('project','personal') 만 사용.
 *  - seed/sync 양방향 동기화 제거 → §21 같은 drift 사고 구조적으로 차단.
 *  - user_skill_prefs / skill_providers 는 `skill_name` natural key 기반
 *    (migration 028 참조) → library 스킬에도 동일하게 적용.
 */
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute } from '../db/pg-repo.js';
import { config } from '../config.js';
import type { SkillMeta, SkillScope } from '@tower/shared';
import {
  syncSkillProviders,
  reconcileSkillProviders,
} from './skill-credential.js';
import {
  loadLibrarySkills,
  getLibrarySkill,
  getLibrarySkillsDir,
} from './library-skills.js';

// ── Filesystem layout ──
const DATA_SKILLS_DIR = path.join(path.dirname(config.dbPath), 'skills');
const PERSONAL_SKILLS_DIR = path.join(DATA_SKILLS_DIR, 'personal');

// ═══════════════════════════════════════════════════════════════
// Library (company) skill provider bootstrap
// ═══════════════════════════════════════════════════════════════

/**
 * Seed `skill_providers` for library (company) skills on startup.
 *
 * library.yaml → parse each SKILL.md frontmatter `providers:` block → upsert
 * into `skill_providers` keyed by skill_name. Then cleanup orphan rows whose
 * skill_name no longer exists in library or DB.
 *
 * Safe to call on every startup — it only inserts/updates/prunes provider
 * metadata; the skill content itself is never written back to disk.
 */
export async function bootstrapLibraryProviders(): Promise<{ synced: number; orphansRemoved: number }> {
  const library = loadLibrarySkills();

  let synced = 0;
  for (const skill of library) {
    await syncSkillProviders(skill.name, skill.content);
    synced++;
  }

  // Also consider DB-backed personal/project skills so their providers aren't
  // treated as orphans. We only collect names — content sync for personal/project
  // happens during createSkill/updateSkill.
  const dbNames = await query<{ name: string }>(
    `SELECT DISTINCT name FROM skill_registry WHERE scope IN ('personal','project')`,
  );

  const active = new Set<string>([
    ...library.map(s => s.name),
    ...dbNames.map(r => r.name),
  ]);

  const orphansRemoved = await reconcileSkillProviders(active);

  console.log(
    `[skills] bootstrapLibraryProviders: library=${library.length}, ` +
    `providers_synced=${synced}, orphans_removed=${orphansRemoved}`,
  );
  return { synced, orphansRemoved };
}

// ═══════════════════════════════════════════════════════════════
// Filesystem sync (project/personal only)
// ═══════════════════════════════════════════════════════════════

/** Sync project skills: DB → {projectRootPath}/.claude/skills/ */
export async function syncProjectSkillsToFs(projectId: string, projectRootPath: string): Promise<void> {
  const skills = await query<{ name: string; content: string }>(
    `SELECT name, content FROM skill_registry WHERE scope = 'project' AND project_id = $1 AND enabled = 1`,
    [projectId]
  );

  if (skills.length === 0) return;

  const targetDir = path.join(projectRootPath, '.claude', 'skills');
  syncSkillsToDir(skills, targetDir);
}

/** Sync personal skills: DB → data/skills/personal/{userId}/ */
export async function syncPersonalSkillsToFs(userId: number): Promise<void> {
  const skills = await query<{ name: string; content: string }>(
    `SELECT name, content FROM skill_registry WHERE scope = 'personal' AND user_id = $1 AND enabled = 1`,
    [userId]
  );

  const targetDir = path.join(PERSONAL_SKILLS_DIR, String(userId));
  syncSkillsToDir(skills, targetDir);
}

/** Write skills to a directory, removing orphans. Used for personal/project only. */
function syncSkillsToDir(skills: { name: string; content: string }[], targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });

  const expectedNames = new Set(skills.map(s => s.name));

  // Write/update
  for (const skill of skills) {
    const skillDir = path.join(targetDir, skill.name);
    const skillFile = path.join(skillDir, 'SKILL.md');
    fs.mkdirSync(skillDir, { recursive: true });

    // Only write if content differs
    try {
      if (fs.existsSync(skillFile) && fs.readFileSync(skillFile, 'utf-8') === skill.content) continue;
    } catch {}

    fs.writeFileSync(skillFile, skill.content, 'utf-8');
  }

  // Remove orphans (skills on disk but not in DB)
  // Only remove directories that look like skill dirs (contain SKILL.md)
  try {
    for (const item of fs.readdirSync(targetDir, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      if (expectedNames.has(item.name)) continue;
      const maybeSkill = path.join(targetDir, item.name, 'SKILL.md');
      if (fs.existsSync(maybeSkill)) {
        fs.rmSync(path.join(targetDir, item.name), { recursive: true, force: true });
      }
    }
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
// CRUD — project/personal only (company is read-only from library.yaml)
// ═══════════════════════════════════════════════════════════════

/**
 * List skills visible to a user. Merges:
 *  - company scope → library.yaml / ~/.claude/skills/
 *  - project scope → DB row filtered by projectId (if provided)
 *  - personal scope → DB row filtered by userId (if provided)
 */
export async function listSkills(scope?: SkillScope, projectId?: string, userId?: number): Promise<SkillMeta[]> {
  const results: SkillMeta[] = [];

  // Library (company) skills
  if (!scope || scope === 'company') {
    const library = loadLibrarySkills();
    for (const s of library) {
      results.push({
        id: s.name, // synthetic: library skills use name as stable id
        name: s.name,
        scope: 'company',
        description: s.description,
        category: inferCategoryFromTags(s.tags),
        enabled: true,
        source: 'library',
        skillPath: s.skillPath,
        projectId: null,
        userId: null,
        createdAt: '',
        updatedAt: '',
      } as SkillMeta);
    }
  }

  // DB-backed skills (project/personal)
  if (!scope || scope === 'project' || scope === 'personal') {
    let sql = `SELECT * FROM skill_registry WHERE scope IN ('project','personal')`;
    const params: any[] = [];
    let idx = 1;

    if (scope) { sql += ` AND scope = $${idx++}`; params.push(scope); }
    if (projectId) { sql += ` AND project_id = $${idx++}`; params.push(projectId); }
    if (userId && (scope === 'personal' || !scope)) {
      sql += ` AND (scope != 'personal' OR user_id = $${idx++})`;
      params.push(userId);
    }

    sql += ' ORDER BY scope, name';
    const rows = await query(sql, params);
    for (const row of rows) results.push(rowToMeta(row));
  }

  // Attach per-user pref if userId provided
  if (userId) {
    const userPrefs = await getUserSkillPrefs(userId);
    for (const meta of results) {
      const pref = userPrefs.get(meta.name);
      meta.userEnabled = pref ?? null;
    }
  }
  return results;
}

/**
 * Get a single skill by id (UUID for project/personal) or name (library).
 * Returns content embedded in the result.
 */
export async function getSkill(idOrName: string): Promise<(SkillMeta & { content: string }) | null> {
  // Library first (name-based)
  const lib = getLibrarySkill(idOrName);
  if (lib) {
    return {
      id: lib.name,
      name: lib.name,
      scope: 'company',
      description: lib.description,
      category: inferCategoryFromTags(lib.tags),
      enabled: true,
      source: 'library',
      skillPath: lib.skillPath,
      projectId: null,
      userId: null,
      createdAt: '',
      updatedAt: '',
      content: lib.content,
    } as SkillMeta & { content: string };
  }

  // DB (UUID-based)
  const row = await queryOne('SELECT * FROM skill_registry WHERE id = $1', [idOrName]);
  return row ? { ...rowToMeta(row), content: row.content } : null;
}

/**
 * Create a new skill. Company scope is NOT allowed — edit library.yaml /
 * ~/.claude/skills/<name>/SKILL.md directly instead.
 */
export async function createSkill(data: {
  name: string;
  scope: SkillScope;
  content: string;
  description?: string;
  category?: string;
  projectId?: string;
  userId?: number;
}): Promise<SkillMeta> {
  if (data.scope === 'company') {
    throw new Error("Company skills are read-only. Edit library.yaml and ~/.claude/skills/<name>/SKILL.md directly.");
  }
  const id = uuidv4();
  await execute(`
    INSERT INTO skill_registry (id, name, scope, project_id, user_id, description, category, content, source)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'custom')
  `, [id, data.name, data.scope, data.projectId || null, data.userId || null,
    data.description || '', data.category || 'general', data.content]);

  // Sync providers for this skill (from its frontmatter)
  await syncSkillProviders(data.name, data.content);

  await syncAfterMutation(data.scope, data.projectId, data.userId);
  return (await getSkill(id))!;
}

export async function updateSkill(id: string, data: {
  name?: string;
  content?: string;
  description?: string;
  category?: string;
  enabled?: boolean;
}): Promise<boolean> {
  const existing = await queryOne<any>(
    'SELECT scope, project_id, user_id, name FROM skill_registry WHERE id = $1',
    [id],
  );
  if (!existing) return false;
  if (existing.scope === 'company') {
    throw new Error("Company skills are read-only. Edit library.yaml and SKILL.md directly.");
  }

  const sets: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const params: any[] = [];
  let idx = 1;

  if (data.name !== undefined) { sets.push(`name = $${idx++}`); params.push(data.name); }
  if (data.content !== undefined) { sets.push(`content = $${idx++}`); params.push(data.content); }
  if (data.description !== undefined) { sets.push(`description = $${idx++}`); params.push(data.description); }
  if (data.category !== undefined) { sets.push(`category = $${idx++}`); params.push(data.category); }
  if (data.enabled !== undefined) { sets.push(`enabled = $${idx++}`); params.push(data.enabled ? 1 : 0); }

  params.push(id);
  await execute(`UPDATE skill_registry SET ${sets.join(', ')} WHERE id = $${idx++}`, params);

  // If content changed, re-sync providers for the skill name
  if (data.content !== undefined) {
    const updatedName = data.name ?? existing.name;
    await syncSkillProviders(updatedName, data.content);
  }

  await syncAfterMutation(existing.scope, existing.project_id, existing.user_id);
  return true;
}

export async function deleteSkill(id: string): Promise<boolean> {
  const existing = await queryOne<any>(
    'SELECT scope, project_id, user_id, name FROM skill_registry WHERE id = $1',
    [id],
  );
  if (!existing) return false;
  if (existing.scope === 'company') {
    throw new Error("Company skills are read-only. Remove from library.yaml instead.");
  }

  await execute('DELETE FROM skill_registry WHERE id = $1', [id]);
  // Remove provider rows for this name if nobody else owns the same name
  const remaining = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM skill_registry WHERE name = $1`,
    [existing.name],
  );
  const alsoInLibrary = !!getLibrarySkill(existing.name);
  if ((remaining[0]?.n ?? 0) === 0 && !alsoInLibrary) {
    await execute('DELETE FROM skill_providers WHERE skill_name = $1', [existing.name]);
  }

  await syncAfterMutation(existing.scope, existing.project_id, existing.user_id);
  return true;
}

async function syncAfterMutation(scope: string, projectId?: string, userId?: number) {
  if (scope === 'project' && projectId) {
    const project = await queryOne<any>('SELECT root_path FROM projects WHERE id = $1', [projectId]);
    if (project?.root_path) {
      await syncProjectSkillsToFs(projectId, project.root_path);
    }
  } else if (scope === 'personal' && userId) {
    await syncPersonalSkillsToFs(userId);
  }
}

// ═══════════════════════════════════════════════════════════════
// User skill preferences (now keyed by skill_name)
// ═══════════════════════════════════════════════════════════════

/** Set user preference for a skill (overrides global enabled state). */
export async function setUserSkillPref(userId: number, skillName: string, enabled: boolean): Promise<void> {
  await execute(`
    INSERT INTO user_skill_prefs (user_id, skill_name, enabled) VALUES ($1, $2, $3)
    ON CONFLICT (user_id, skill_name) DO UPDATE SET enabled = excluded.enabled
  `, [userId, skillName, enabled ? 1 : 0]);
}

/** Get user preference for a skill. Returns null if no pref set (default = enabled). */
export async function getUserSkillPref(userId: number, skillName: string): Promise<boolean | null> {
  const row = await queryOne<any>(
    'SELECT enabled FROM user_skill_prefs WHERE user_id = $1 AND skill_name = $2',
    [userId, skillName],
  );
  return row ? !!row.enabled : null;
}

/** Get all user prefs as a Map<skillName, enabled> */
async function getUserSkillPrefs(userId: number): Promise<Map<string, boolean>> {
  const rows = await query<any>(
    'SELECT skill_name, enabled FROM user_skill_prefs WHERE user_id = $1',
    [userId],
  );
  const map = new Map<string, boolean>();
  for (const r of rows) map.set(r.skill_name, !!r.enabled);
  return map;
}

/**
 * Merge visibility check: library/DB-native enabled state AND per-user pref.
 * Library skills default to `enabled=true`; DB skills honor the `enabled` column.
 */
function isSkillActiveForUser(enabledInSource: boolean, name: string, userPrefs: Map<string, boolean>): boolean {
  if (!enabledInSource) return false;
  const pref = userPrefs.get(name);
  return pref !== false; // default = enabled (null/true → active, false → inactive)
}

// ═══════════════════════════════════════════════════════════════
// Session / command helpers (library + DB merged)
// ═══════════════════════════════════════════════════════════════

/**
 * Get merged skills for a session: library(company) + project + personal.
 * Deduplicated by name, ordered personal > project > company.
 */
export async function getSkillsForSession(userId?: number, projectId?: string | null): Promise<SkillMeta[]> {
  const userPrefs = userId ? await getUserSkillPrefs(userId) : new Map<string, boolean>();

  // DB rows: project + personal
  const params: any[] = [];
  let idx = 1;
  let projectClause = '';
  if (projectId) { projectClause = `OR (scope = 'project' AND project_id = $${idx++})`; params.push(projectId); }
  let userClause = '';
  if (userId) { userClause = `OR (scope = 'personal' AND user_id = $${idx++})`; params.push(userId); }

  const dbRows = projectClause || userClause
    ? await query(
        `SELECT * FROM skill_registry WHERE enabled = 1 AND (1=0 ${projectClause} ${userClause})
         ORDER BY CASE scope WHEN 'personal' THEN 0 WHEN 'project' THEN 1 ELSE 2 END, name`,
        params,
      )
    : [];

  const seen = new Set<string>();
  const result: SkillMeta[] = [];

  // First pass: DB (personal/project take priority over library)
  for (const row of dbRows) {
    if (seen.has(row.name)) continue;
    seen.add(row.name);
    if (!isSkillActiveForUser(!!row.enabled, row.name, userPrefs)) continue;
    result.push(rowToMeta(row));
  }

  // Second pass: library (company)
  const library = loadLibrarySkills();
  for (const s of library) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    if (!isSkillActiveForUser(true, s.name, userPrefs)) continue;
    result.push({
      id: s.name,
      name: s.name,
      scope: 'company',
      description: s.description,
      category: inferCategoryFromTags(s.tags),
      enabled: true,
      source: 'library',
      skillPath: s.skillPath,
      projectId: null,
      userId: null,
      createdAt: '',
      updatedAt: '',
    } as SkillMeta);
  }

  return result;
}

/** Get commands for /api/commands endpoint (with fullContent for dropdown). */
export async function getCommandsForUser(userId?: number, projectId?: string | null): Promise<{
  name: string; description: string; fullContent: string; source: string; scope: SkillScope;
}[]> {
  const userPrefs = userId ? await getUserSkillPrefs(userId) : new Map<string, boolean>();

  const params: any[] = [];
  let idx = 1;
  let projectClause = '';
  if (projectId) { projectClause = `OR (scope = 'project' AND project_id = $${idx++})`; params.push(projectId); }
  let userClause = '';
  if (userId) { userClause = `OR (scope = 'personal' AND user_id = $${idx++})`; params.push(userId); }

  const dbRows = projectClause || userClause
    ? await query(
        `SELECT name, scope, description, content FROM skill_registry
         WHERE enabled = 1 AND (1=0 ${projectClause} ${userClause})
         ORDER BY CASE scope WHEN 'personal' THEN 0 WHEN 'project' THEN 1 ELSE 2 END, name`,
        params,
      )
    : [];

  const seen = new Set<string>();
  const result: { name: string; description: string; fullContent: string; source: string; scope: SkillScope }[] = [];

  for (const row of dbRows) {
    if (seen.has(row.name)) continue;
    seen.add(row.name);
    if (!isSkillActiveForUser(true, row.name, userPrefs)) continue;
    result.push({
      name: `/${row.name}`,
      description: row.description || `Skill: ${row.name}`,
      fullContent: row.content,
      source: 'skills',
      scope: row.scope as SkillScope,
    });
  }

  const library = loadLibrarySkills();
  for (const s of library) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    if (!isSkillActiveForUser(true, s.name, userPrefs)) continue;
    result.push({
      name: `/${s.name}`,
      description: s.description,
      fullContent: s.content,
      source: 'skills',
      scope: 'company',
    });
  }

  return result;
}

/** Get a personal skill by name (for Claude message prepend) */
export async function getPersonalSkill(userId: number, name: string): Promise<{ content: string } | null> {
  const row = await queryOne<any>(
    `SELECT content FROM skill_registry WHERE scope = 'personal' AND user_id = $1 AND name = $2 AND enabled = 1`,
    [userId, name]
  );
  return row || null;
}

/** Get skill by name from any scope (for Pi engine prepend fallback). */
export async function getSkillByName(name: string, userId?: number, projectId?: string | null): Promise<{ content: string; scope: string } | null> {
  // Priority: personal → project → library(company)
  if (userId) {
    const personal = await queryOne<any>(
      `SELECT content, scope FROM skill_registry WHERE name = $1 AND scope = 'personal' AND user_id = $2 AND enabled = 1`,
      [name, userId]
    );
    if (personal) return personal;
  }
  if (projectId) {
    const project = await queryOne<any>(
      `SELECT content, scope FROM skill_registry WHERE name = $1 AND scope = 'project' AND project_id = $2 AND enabled = 1`,
      [name, projectId]
    );
    if (project) return project;
  }
  const lib = getLibrarySkill(name);
  if (lib) return { content: lib.content, scope: 'company' };
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Paths for Pi additionalSkillPaths
// ═══════════════════════════════════════════════════════════════

/** Filesystem paths for personal skills (for Pi additionalSkillPaths) */
export function getPersonalSkillPaths(userId?: number): string[] {
  if (!userId) return [];
  const dir = path.join(PERSONAL_SKILLS_DIR, String(userId));
  return fs.existsSync(dir) ? [dir] : [];
}

/** Project-local .claude/skills path when present (for Pi parity with Claude project skills). */
export function getProjectSkillPaths(cwd?: string): string[] {
  if (!cwd) return [];
  const dir = path.join(cwd, '.claude', 'skills');
  return fs.existsSync(dir) ? [dir] : [];
}

/**
 * Company skills directory — points directly at `~/.claude/skills/`.
 *
 * Before the 2026-04-17 simplification this was `data/skills/company/` which
 * Tower synced from the DB. Now the SKILL.md files on disk are the canonical
 * source (rsync'd from library.yaml by deploy-profile.sh), and Claude SDK picks
 * them up natively. Pi SDK uses this path via additionalSkillPaths.
 */
export function getCompanySkillsDir(): string {
  return getLibrarySkillsDir();
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function rowToMeta(row: any): SkillMeta {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    description: row.description || '',
    category: row.category || 'general',
    enabled: !!row.enabled,
    source: row.source || 'custom',
    skillPath: row.skill_path || null,
    projectId: row.project_id || null,
    userId: row.user_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function inferCategoryFromTags(tags: string[]): string {
  if (!tags || tags.length === 0) return 'general';
  // First tag wins (core, business, docs, presentation, browser, dev, meta, tower-ops, internal)
  return tags[0];
}

/** Extract a frontmatter field from SKILL.md content */
export function parseFrontmatterField(content: string, field: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return '';
  const fm = fmMatch[1];

  // Block scalar (| or >)
  const block = fm.match(new RegExp(`^${field}:\\s*[|>][^\n]*\n((?:[ \\t]+[^\n]*\n?)+)`, 'm'));
  if (block) {
    return block[1].replace(/^[ \t]+/gm, '').trim().split('\n')[0];
  }

  // Single line
  const single = fm.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  if (single) {
    const val = single[1].trim();
    if (val.startsWith('"') && val.endsWith('"')) return val.slice(1, -1);
    return val;
  }

  return '';
}
