/**
 * Skill Registry — 3-tier skill management (company / project / personal).
 *
 * DB is the single source of truth. Filesystem is a compatibility cache
 * for Claude SDK (~/.claude/skills/) and Pi SDK (additionalSkillPaths).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute, transaction, withClient } from '../db/pg-repo.js';
import { config } from '../config.js';
import type { SkillMeta, SkillScope } from '@tower/shared';
import { syncSkillProviders } from './skill-credential.js';

// ── Filesystem layout ──
const DATA_SKILLS_DIR = path.join(path.dirname(config.dbPath), 'skills');
const COMPANY_SKILLS_DIR = path.join(DATA_SKILLS_DIR, 'company');
const PERSONAL_SKILLS_DIR = path.join(DATA_SKILLS_DIR, 'personal');
const CLAUDE_SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');
const PLUGINS_DIR = path.join(os.homedir(), '.claude', 'plugins');

// ═══════════════════════════════════════════════════════════════
// Seed bundled skills → DB (idempotent)
// ═══════════════════════════════════════════════════════════════

export async function seedBundledSkills(bundledDir: string): Promise<number> {
  if (!fs.existsSync(bundledDir)) {
    console.log(`[skills] Bundled skills dir not found: ${bundledDir}`);
    return 0;
  }

  const entries = fs.readdirSync(bundledDir, { withFileTypes: true });

  let count = 0;
  await transaction(async (client) => {
    const db = withClient(client);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(bundledDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;

      const content = fs.readFileSync(skillFile, 'utf-8');
      const name = parseFrontmatterField(content, 'name') || entry.name;
      const description = parseFrontmatterField(content, 'description') || `Skill: ${name}`;

      const skillId = uuidv4();
      const result = await db.queryOne<{ id: string }>(`
        INSERT INTO skill_registry (id, name, scope, description, category, content, source)
        VALUES ($1, $2, 'company', $3, 'general', $4, 'bundled')
        ON CONFLICT (name, scope, COALESCE(project_id,''), COALESCE(user_id, 0))
        DO UPDATE SET content = excluded.content, description = excluded.description,
                      updated_at = CURRENT_TIMESTAMP
        RETURNING id
      `, [skillId, name, description, content]);
      // Sync provider requirements from SKILL.md frontmatter
      if (result?.id) {
        await syncSkillProviders(result.id, content);
      }
      count++;
    }
  });

  if (count > 0) console.log(`[skills] Seeded ${count} bundled skills`);
  return count;
}

/**
 * Seed skills from ~/.claude/plugins/ (marketplace + installed).
 * Scans cache (versioned) and installed dirs. Stores skill_path for folder reference.
 */
export async function seedPluginSkills(): Promise<number> {
  // Sources to scan: [dir, source_tag, category_hint]
  const sources: [string, string, string][] = [
    [path.join(PLUGINS_DIR, 'cache', 'internal-skills'), 'marketplace', 'general'],
    [path.join(PLUGINS_DIR, 'installed', 'superpowers', 'skills'), 'marketplace', 'dev'],
  ];

  // Also scan official plugins
  const officialDir = path.join(PLUGINS_DIR, 'marketplaces', 'claude-plugins-official', 'plugins');
  if (fs.existsSync(officialDir)) {
    try {
      for (const plugin of fs.readdirSync(officialDir, { withFileTypes: true })) {
        if (!plugin.isDirectory()) continue;
        const skillsDir = path.join(officialDir, plugin.name, 'skills');
        if (fs.existsSync(skillsDir)) {
          sources.push([skillsDir, 'official', 'dev']);
        }
      }
    } catch {}
  }

  let count = 0;
  await transaction(async (client) => {
    const db = withClient(client);
    for (const [dir, sourceTag, categoryHint] of sources) {
      if (!fs.existsSync(dir)) continue;

      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const skillDir = path.join(dir, entry.name);

          // Cache entries have version subdirs: cache/internal-skills/offer-plan/1.0.0/
          let skillFile = path.join(skillDir, 'SKILL.md');
          let actualDir = skillDir;

          if (!fs.existsSync(skillFile)) {
            // Try version subdir
            try {
              const versions = fs.readdirSync(skillDir, { withFileTypes: true })
                .filter(v => v.isDirectory())
                .map(v => v.name)
                .sort()
                .reverse();
              if (versions.length > 0) {
                actualDir = path.join(skillDir, versions[0]);
                skillFile = path.join(actualDir, 'SKILL.md');
              }
            } catch {}
          }

          if (!fs.existsSync(skillFile)) continue;

          const content = fs.readFileSync(skillFile, 'utf-8');
          const name = parseFrontmatterField(content, 'name') || entry.name;
          const description = parseFrontmatterField(content, 'description') || `Skill: ${name}`;

          await db.execute(`
            INSERT INTO skill_registry (id, name, scope, description, category, content, source, skill_path)
            VALUES ($1, $2, 'company', $3, $4, $5, $6, $7)
            ON CONFLICT (name, scope, COALESCE(project_id,''), COALESCE(user_id, 0))
            DO UPDATE SET content = excluded.content, description = excluded.description,
                          skill_path = excluded.skill_path, source = excluded.source,
                          updated_at = CURRENT_TIMESTAMP
          `, [uuidv4(), name, description, categoryHint, content, sourceTag, actualDir]);
          count++;
        }
      } catch {}
    }
  });

  if (count > 0) console.log(`[skills] Seeded ${count} plugin skills`);
  return count;
}

// ═══════════════════════════════════════════════════════════════
// Filesystem sync (DB → disk)
// ═══════════════════════════════════════════════════════════════

/** Sync company skills: DB → data/skills/company/ + ~/.claude/skills/ */
export async function syncCompanySkillsToFs(): Promise<void> {
  const skills = await query<{ name: string; content: string }>(
    `SELECT name, content FROM skill_registry WHERE scope = 'company' AND enabled = 1`
  );

  // Write to data/skills/company/ (for Pi additionalSkillPaths)
  syncSkillsToDir(skills, COMPANY_SKILLS_DIR);

  // Write to ~/.claude/skills/ (for Claude SDK native discovery)
  syncSkillsToDir(skills, CLAUDE_SKILLS_DIR);

  console.log(`[skills] Company skills synced: ${skills.length} to filesystem`);
}

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

/** Write skills to a directory, removing orphans */
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
// CRUD
// ═══════════════════════════════════════════════════════════════

export async function listSkills(scope?: SkillScope, projectId?: string, userId?: number): Promise<SkillMeta[]> {
  let sql = 'SELECT * FROM skill_registry WHERE 1=1';
  const params: any[] = [];
  let idx = 1;

  if (scope) { sql += ` AND scope = $${idx++}`; params.push(scope); }
  if (projectId) { sql += ` AND project_id = $${idx++}`; params.push(projectId); }
  if (userId && scope === 'personal') { sql += ` AND user_id = $${idx++}`; params.push(userId); }

  sql += ' ORDER BY name';
  const rows = await query(sql, params);

  // Attach per-user pref if userId provided
  const userPrefs = userId ? await getUserSkillPrefs(userId) : new Map<string, boolean>();
  return rows.map(row => {
    const meta = rowToMeta(row);
    if (userId) {
      const pref = userPrefs.get(row.id);
      meta.userEnabled = pref ?? null;
    }
    return meta;
  });
}

export async function getSkill(id: string): Promise<(SkillMeta & { content: string }) | null> {
  const row = await queryOne('SELECT * FROM skill_registry WHERE id = $1', [id]);
  return row ? { ...rowToMeta(row), content: row.content } : null;
}

export async function createSkill(data: {
  name: string;
  scope: SkillScope;
  content: string;
  description?: string;
  category?: string;
  projectId?: string;
  userId?: number;
}): Promise<SkillMeta> {
  const id = uuidv4();
  await execute(`
    INSERT INTO skill_registry (id, name, scope, project_id, user_id, description, category, content, source)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'custom')
  `, [id, data.name, data.scope, data.projectId || null, data.userId || null,
    data.description || '', data.category || 'general', data.content]);

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
  const existing = await queryOne<any>('SELECT scope, project_id, user_id FROM skill_registry WHERE id = $1', [id]);
  if (!existing) return false;

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

  await syncAfterMutation(existing.scope, existing.project_id, existing.user_id);
  return true;
}

export async function deleteSkill(id: string): Promise<boolean> {
  const existing = await queryOne<any>('SELECT scope, project_id, user_id FROM skill_registry WHERE id = $1', [id]);
  if (!existing) return false;

  await execute('DELETE FROM skill_registry WHERE id = $1', [id]);
  await syncAfterMutation(existing.scope, existing.project_id, existing.user_id);
  return true;
}

async function syncAfterMutation(scope: string, projectId?: string, userId?: number) {
  if (scope === 'company') {
    await syncCompanySkillsToFs();
  } else if (scope === 'project' && projectId) {
    // Resolve project root path
    const project = await queryOne<any>('SELECT root_path FROM projects WHERE id = $1', [projectId]);
    if (project?.root_path) {
      await syncProjectSkillsToFs(projectId, project.root_path);
    }
  } else if (scope === 'personal' && userId) {
    await syncPersonalSkillsToFs(userId);
  }
}

// ═══════════════════════════════════════════════════════════════
// Query helpers (for engines and /api/commands)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// User skill preferences
// ═══════════════════════════════════════════════════════════════

/** Set user preference for a skill (overrides global enabled state) */
export async function setUserSkillPref(userId: number, skillId: string, enabled: boolean): Promise<void> {
  await execute(`
    INSERT INTO user_skill_prefs (user_id, skill_id, enabled) VALUES ($1, $2, $3)
    ON CONFLICT (user_id, skill_id) DO UPDATE SET enabled = excluded.enabled
  `, [userId, skillId, enabled ? 1 : 0]);
}

/** Get user preference for a skill. Returns null if no pref set (default = enabled). */
export async function getUserSkillPref(userId: number, skillId: string): Promise<boolean | null> {
  const row = await queryOne<any>('SELECT enabled FROM user_skill_prefs WHERE user_id = $1 AND skill_id = $2', [userId, skillId]);
  return row ? !!row.enabled : null;
}

/** Get all user prefs as a Map<skillId, enabled> */
async function getUserSkillPrefs(userId: number): Promise<Map<string, boolean>> {
  const rows = await query<any>('SELECT skill_id, enabled FROM user_skill_prefs WHERE user_id = $1', [userId]);
  const map = new Map<string, boolean>();
  for (const r of rows) map.set(r.skill_id, !!r.enabled);
  return map;
}

/** Check if a skill is active for a user (global enabled AND user pref) */
function isSkillActiveForUser(row: any, userPrefs: Map<string, boolean>): boolean {
  if (!row.enabled) return false; // globally disabled by admin
  const pref = userPrefs.get(row.id);
  return pref !== false; // default = enabled (null/true → active, false → inactive)
}

/** Get merged skills for a session: company + project + personal, filtered by user prefs */
export async function getSkillsForSession(userId?: number, projectId?: string | null): Promise<SkillMeta[]> {
  const params: any[] = [];
  let idx = 1;

  let projectClause = '';
  if (projectId) { projectClause = `OR (scope = 'project' AND project_id = $${idx++})`; params.push(projectId); }
  let userClause = '';
  if (userId) { userClause = `OR (scope = 'personal' AND user_id = $${idx++})`; params.push(userId); }

  const sql = `
    SELECT * FROM skill_registry
    WHERE enabled = 1 AND (
      scope = 'company'
      ${projectClause}
      ${userClause}
    )
    ORDER BY CASE scope WHEN 'personal' THEN 0 WHEN 'project' THEN 1 WHEN 'company' THEN 2 END, name
  `;

  const rows = await query(sql, params);
  const userPrefs = userId ? await getUserSkillPrefs(userId) : new Map<string, boolean>();

  // Deduplicate + filter by user prefs
  const seen = new Set<string>();
  const result: SkillMeta[] = [];
  for (const row of rows) {
    if (seen.has(row.name)) continue;
    seen.add(row.name);
    if (!isSkillActiveForUser(row, userPrefs)) continue;
    result.push(rowToMeta(row));
  }
  return result;
}

/** Get commands for /api/commands endpoint (with fullContent for dropdown) */
export async function getCommandsForUser(userId?: number, projectId?: string | null): Promise<{
  name: string; description: string; fullContent: string; source: string; scope: SkillScope;
}[]> {
  const params: any[] = [];
  let idx = 1;

  let projectClause = '';
  if (projectId) { projectClause = `OR (scope = 'project' AND project_id = $${idx++})`; params.push(projectId); }
  let userClause = '';
  if (userId) { userClause = `OR (scope = 'personal' AND user_id = $${idx++})`; params.push(userId); }

  const sql = `
    SELECT * FROM skill_registry
    WHERE enabled = 1 AND (
      scope = 'company'
      ${projectClause}
      ${userClause}
    )
    ORDER BY CASE scope WHEN 'personal' THEN 0 WHEN 'project' THEN 1 WHEN 'company' THEN 2 END, name
  `;

  const rows = await query(sql, params);
  const userPrefs = userId ? await getUserSkillPrefs(userId) : new Map<string, boolean>();

  const seen = new Set<string>();
  const result: { name: string; description: string; fullContent: string; source: string; scope: SkillScope }[] = [];

  for (const row of rows) {
    if (seen.has(row.name)) continue;
    seen.add(row.name);
    if (!isSkillActiveForUser(row, userPrefs)) continue;
    result.push({
      name: `/${row.name}`,
      description: row.description || `Skill: ${row.name}`,
      fullContent: row.content,
      source: 'skills',
      scope: row.scope,
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

/** Get skill by name from any scope (for Pi engine prepend fallback) */
export async function getSkillByName(name: string, userId?: number, projectId?: string | null): Promise<{ content: string; scope: string } | null> {
  // Check in priority order: personal → project → company
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
  const company = await queryOne<any>(
    `SELECT content, scope FROM skill_registry WHERE name = $1 AND scope = 'company' AND enabled = 1`,
    [name]
  );
  return company || null;
}

/** Get filesystem paths for personal skills (for Pi additionalSkillPaths) */
export function getPersonalSkillPaths(userId?: number): string[] {
  if (!userId) return [];
  const dir = path.join(PERSONAL_SKILLS_DIR, String(userId));
  return fs.existsSync(dir) ? [dir] : [];
}

/** Get project-local .claude/skills path when present (for Pi parity with Claude project skills). */
export function getProjectSkillPaths(cwd?: string): string[] {
  if (!cwd) return [];
  const dir = path.join(cwd, '.claude', 'skills');
  return fs.existsSync(dir) ? [dir] : [];
}

/** Get company skills directory path (for Pi additionalSkillPaths) */
export function getCompanySkillsDir(): string {
  return COMPANY_SKILLS_DIR;
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
    source: row.source || 'bundled',
    skillPath: row.skill_path || null,
    projectId: row.project_id || null,
    userId: row.user_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
