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
import { getDb } from '../db/schema.js';
import { config } from '../config.js';
import type { SkillMeta, SkillScope } from '@tower/shared';

// ── Filesystem layout ──
const DATA_SKILLS_DIR = path.join(path.dirname(config.dbPath), 'skills');
const COMPANY_SKILLS_DIR = path.join(DATA_SKILLS_DIR, 'company');
const PERSONAL_SKILLS_DIR = path.join(DATA_SKILLS_DIR, 'personal');
const CLAUDE_SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');

// ═══════════════════════════════════════════════════════════════
// Seed bundled skills → DB (idempotent)
// ═══════════════════════════════════════════════════════════════

export function seedBundledSkills(bundledDir: string): number {
  if (!fs.existsSync(bundledDir)) {
    console.log(`[skills] Bundled skills dir not found: ${bundledDir}`);
    return 0;
  }

  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO skill_registry (id, name, scope, description, category, content, source)
    VALUES (?, ?, 'company', ?, 'general', ?, 'bundled')
    ON CONFLICT (name, scope, COALESCE(project_id,''), COALESCE(user_id, 0))
    DO UPDATE SET content = excluded.content, description = excluded.description,
                  updated_at = CURRENT_TIMESTAMP
  `);

  let count = 0;
  const entries = fs.readdirSync(bundledDir, { withFileTypes: true });

  const tx = db.transaction(() => {
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(bundledDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;

      const content = fs.readFileSync(skillFile, 'utf-8');
      const name = parseFrontmatterField(content, 'name') || entry.name;
      const description = parseFrontmatterField(content, 'description') || `Skill: ${name}`;

      upsert.run(uuidv4(), name, description, content);
      count++;
    }
  });

  tx();
  if (count > 0) console.log(`[skills] Seeded ${count} bundled skills`);
  return count;
}

// ═══════════════════════════════════════════════════════════════
// Filesystem sync (DB → disk)
// ═══════════════════════════════════════════════════════════════

/** Sync company skills: DB → data/skills/company/ + ~/.claude/skills/ */
export function syncCompanySkillsToFs(): void {
  const db = getDb();
  const skills = db.prepare(
    `SELECT name, content FROM skill_registry WHERE scope = 'company' AND enabled = 1`
  ).all() as { name: string; content: string }[];

  // Write to data/skills/company/ (for Pi additionalSkillPaths)
  syncSkillsToDir(skills, COMPANY_SKILLS_DIR);

  // Write to ~/.claude/skills/ (for Claude SDK native discovery)
  syncSkillsToDir(skills, CLAUDE_SKILLS_DIR);

  console.log(`[skills] Company skills synced: ${skills.length} to filesystem`);
}

/** Sync project skills: DB → {projectRootPath}/.claude/skills/ */
export function syncProjectSkillsToFs(projectId: string, projectRootPath: string): void {
  const db = getDb();
  const skills = db.prepare(
    `SELECT name, content FROM skill_registry WHERE scope = 'project' AND project_id = ? AND enabled = 1`
  ).all(projectId) as { name: string; content: string }[];

  if (skills.length === 0) return;

  const targetDir = path.join(projectRootPath, '.claude', 'skills');
  syncSkillsToDir(skills, targetDir);
}

/** Sync personal skills: DB → data/skills/personal/{userId}/ */
export function syncPersonalSkillsToFs(userId: number): void {
  const db = getDb();
  const skills = db.prepare(
    `SELECT name, content FROM skill_registry WHERE scope = 'personal' AND user_id = ? AND enabled = 1`
  ).all(userId) as { name: string; content: string }[];

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

export function listSkills(scope?: SkillScope, projectId?: string, userId?: number): SkillMeta[] {
  const db = getDb();
  let sql = 'SELECT * FROM skill_registry WHERE 1=1';
  const params: any[] = [];

  if (scope) { sql += ' AND scope = ?'; params.push(scope); }
  if (projectId) { sql += ' AND project_id = ?'; params.push(projectId); }
  if (userId && scope === 'personal') { sql += ' AND user_id = ?'; params.push(userId); }

  sql += ' ORDER BY name';
  const rows = db.prepare(sql).all(...params) as any[];

  // Attach per-user pref if userId provided
  const userPrefs = userId ? getUserSkillPrefs(userId) : new Map<string, boolean>();
  return rows.map(row => {
    const meta = rowToMeta(row);
    if (userId) {
      const pref = userPrefs.get(row.id);
      meta.userEnabled = pref ?? null;
    }
    return meta;
  });
}

export function getSkill(id: string): (SkillMeta & { content: string }) | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM skill_registry WHERE id = ?').get(id) as any;
  return row ? { ...rowToMeta(row), content: row.content } : null;
}

export function createSkill(data: {
  name: string;
  scope: SkillScope;
  content: string;
  description?: string;
  category?: string;
  projectId?: string;
  userId?: number;
}): SkillMeta {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO skill_registry (id, name, scope, project_id, user_id, description, category, content, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'custom')
  `).run(id, data.name, data.scope, data.projectId || null, data.userId || null,
    data.description || '', data.category || 'general', data.content);

  syncAfterMutation(data.scope, data.projectId, data.userId);
  return getSkill(id)!;
}

export function updateSkill(id: string, data: {
  name?: string;
  content?: string;
  description?: string;
  category?: string;
  enabled?: boolean;
}): boolean {
  const db = getDb();
  const existing = db.prepare('SELECT scope, project_id, user_id FROM skill_registry WHERE id = ?').get(id) as any;
  if (!existing) return false;

  const sets: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const params: any[] = [];

  if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
  if (data.content !== undefined) { sets.push('content = ?'); params.push(data.content); }
  if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
  if (data.category !== undefined) { sets.push('category = ?'); params.push(data.category); }
  if (data.enabled !== undefined) { sets.push('enabled = ?'); params.push(data.enabled ? 1 : 0); }

  params.push(id);
  db.prepare(`UPDATE skill_registry SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  syncAfterMutation(existing.scope, existing.project_id, existing.user_id);
  return true;
}

export function deleteSkill(id: string): boolean {
  const db = getDb();
  const existing = db.prepare('SELECT scope, project_id, user_id FROM skill_registry WHERE id = ?').get(id) as any;
  if (!existing) return false;

  db.prepare('DELETE FROM skill_registry WHERE id = ?').run(id);
  syncAfterMutation(existing.scope, existing.project_id, existing.user_id);
  return true;
}

function syncAfterMutation(scope: string, projectId?: string, userId?: number) {
  if (scope === 'company') {
    syncCompanySkillsToFs();
  } else if (scope === 'project' && projectId) {
    // Resolve project root path
    const db = getDb();
    const project = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId) as any;
    if (project?.root_path) {
      syncProjectSkillsToFs(projectId, project.root_path);
    }
  } else if (scope === 'personal' && userId) {
    syncPersonalSkillsToFs(userId);
  }
}

// ═══════════════════════════════════════════════════════════════
// Query helpers (for engines and /api/commands)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// User skill preferences
// ═══════════════════════════════════════════════════════════════

/** Set user preference for a skill (overrides global enabled state) */
export function setUserSkillPref(userId: number, skillId: string, enabled: boolean): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO user_skill_prefs (user_id, skill_id, enabled) VALUES (?, ?, ?)
    ON CONFLICT (user_id, skill_id) DO UPDATE SET enabled = excluded.enabled
  `).run(userId, skillId, enabled ? 1 : 0);
}

/** Get user preference for a skill. Returns null if no pref set (default = enabled). */
export function getUserSkillPref(userId: number, skillId: string): boolean | null {
  const db = getDb();
  const row = db.prepare('SELECT enabled FROM user_skill_prefs WHERE user_id = ? AND skill_id = ?').get(userId, skillId) as any;
  return row ? !!row.enabled : null;
}

/** Get all user prefs as a Map<skillId, enabled> */
function getUserSkillPrefs(userId: number): Map<string, boolean> {
  const db = getDb();
  const rows = db.prepare('SELECT skill_id, enabled FROM user_skill_prefs WHERE user_id = ?').all(userId) as any[];
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
export function getSkillsForSession(userId?: number, projectId?: string | null): SkillMeta[] {
  const db = getDb();
  let sql = `
    SELECT * FROM skill_registry
    WHERE enabled = 1 AND (
      scope = 'company'
      ${projectId ? "OR (scope = 'project' AND project_id = ?)" : ''}
      ${userId ? "OR (scope = 'personal' AND user_id = ?)" : ''}
    )
    ORDER BY CASE scope WHEN 'personal' THEN 0 WHEN 'project' THEN 1 WHEN 'company' THEN 2 END, name
  `;

  const params: any[] = [];
  if (projectId) params.push(projectId);
  if (userId) params.push(userId);

  const rows = db.prepare(sql).all(...params) as any[];
  const userPrefs = userId ? getUserSkillPrefs(userId) : new Map<string, boolean>();

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
export function getCommandsForUser(userId?: number, projectId?: string | null): {
  name: string; description: string; fullContent: string; source: string; scope: SkillScope;
}[] {
  const db = getDb();
  let sql = `
    SELECT * FROM skill_registry
    WHERE enabled = 1 AND (
      scope = 'company'
      ${projectId ? "OR (scope = 'project' AND project_id = ?)" : ''}
      ${userId ? "OR (scope = 'personal' AND user_id = ?)" : ''}
    )
    ORDER BY CASE scope WHEN 'personal' THEN 0 WHEN 'project' THEN 1 WHEN 'company' THEN 2 END, name
  `;

  const params: any[] = [];
  if (projectId) params.push(projectId);
  if (userId) params.push(userId);

  const rows = db.prepare(sql).all(...params) as any[];
  const userPrefs = userId ? getUserSkillPrefs(userId) : new Map<string, boolean>();

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
export function getPersonalSkill(userId: number, name: string): { content: string } | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT content FROM skill_registry WHERE scope = 'personal' AND user_id = ? AND name = ? AND enabled = 1`
  ).get(userId, name) as any;
  return row || null;
}

/** Get skill by name from any scope (for Pi engine prepend fallback) */
export function getSkillByName(name: string, userId?: number, projectId?: string | null): { content: string; scope: string } | null {
  const db = getDb();
  // Check in priority order: personal → project → company
  if (userId) {
    const personal = db.prepare(
      `SELECT content, scope FROM skill_registry WHERE name = ? AND scope = 'personal' AND user_id = ? AND enabled = 1`
    ).get(name, userId) as any;
    if (personal) return personal;
  }
  if (projectId) {
    const project = db.prepare(
      `SELECT content, scope FROM skill_registry WHERE name = ? AND scope = 'project' AND project_id = ? AND enabled = 1`
    ).get(name, projectId) as any;
    if (project) return project;
  }
  const company = db.prepare(
    `SELECT content, scope FROM skill_registry WHERE name = ? AND scope = 'company' AND enabled = 1`
  ).get(name) as any;
  return company || null;
}

/** Get filesystem paths for personal skills (for Pi additionalSkillPaths) */
export function getPersonalSkillPaths(userId?: number): string[] {
  if (!userId) return [];
  const dir = path.join(PERSONAL_SKILLS_DIR, String(userId));
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
