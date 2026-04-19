/**
 * Library Skills — library.yaml + ~/.claude/skills/<name>/SKILL.md 를 단일 소스로 한
 * company 스킬 로더.
 *
 * 2026-04-17 결정 (workspace/decisions/2026-04-17-skill-db-simplification.md):
 *  - company 스킬은 DB에서 제거하고 library.yaml + 디스크를 단일 소스로 사용한다.
 *  - DB는 personal/project 스킬과 user_skill_prefs, skill_providers만 담당한다.
 *  - seed/sync 양방향 동기화를 제거해 §21 같은 drift 사고를 구조적으로 차단한다.
 *
 * 이 모듈은 library.yaml을 파싱하여 company 스킬 메타데이터 목록을 반환하고,
 * 각 스킬의 SKILL.md 내용을 즉시 로드 가능하게 한다. 결과는 메모리 캐시되며
 * library.yaml 또는 SKILL.md 의 mtime 이 바뀌면 자동 무효화된다.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseFrontmatterField } from './skill-registry.js';

// ── Paths ─────────────────────────────────────────────────────────────
const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');
const LIBRARY_YAML = path.join(SKILLS_DIR, 'library', 'library.yaml');

// ── Types ─────────────────────────────────────────────────────────────
export interface LibrarySkill {
  /** Unique skill name — matches directory name under ~/.claude/skills/ */
  name: string;
  /** Short human-readable description (from SKILL.md frontmatter) */
  description: string;
  /** Full SKILL.md content (used by getSkillByName for Pi engine prepend, etc.) */
  content: string;
  /** Tags declared in library.yaml (used for profile filtering) */
  tags: string[];
  /** Version declared in library.yaml (optional) */
  version: string;
  /** Path to the SKILL.md file on disk */
  skillPath: string;
}

interface LibraryYamlEntry {
  name: string;
  tags: string[];
  version: string;
}

// ── Cache ─────────────────────────────────────────────────────────────
interface Cache {
  yamlMtime: number;
  entries: LibraryYamlEntry[];
  /** name → SKILL.md mtime, for invalidating individual skills */
  skillMtimes: Map<string, number>;
  /** name → fully-hydrated LibrarySkill */
  skills: Map<string, LibrarySkill>;
}

let cache: Cache | null = null;

// ── YAML parsing (regex-based — no js-yaml dependency) ────────────────
/**
 * Extract skill entries from `library.yaml` under the `library.skills:` key.
 * The file is a structured YAML, but we only need a narrow slice. We parse it
 * with regex to avoid adding a runtime YAML dependency. `fleet-manager.ts`
 * uses python3 for the same purpose — we pick regex here because this runs on
 * every startup path and we want to keep it synchronous.
 *
 * Expected shape (simplified):
 *   library:
 *     skills:
 *       - name: ideate
 *         version: "1.0.0"
 *         description: "..."
 *         tags: [core]
 *       - name: gws
 *         ...
 */
function parseLibraryYaml(yamlContent: string): LibraryYamlEntry[] {
  // Narrow to the `library:` block (ignore everything above, e.g. profiles/customers)
  const libMatch = yamlContent.match(/\nlibrary:\s*\n([\s\S]*)$/);
  if (!libMatch) return [];
  const libBlock = libMatch[1];

  const entries: LibraryYamlEntry[] = [];

  // Locate each `- name:` line with its line position
  const nameRegex = /^([ \t]+)- name:[ \t]+([A-Za-z0-9_-]+)[ \t]*$/gm;
  const matches: Array<{ name: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = nameRegex.exec(libBlock)) !== null) {
    matches.push({ name: m[2], start: m.index, end: m.index + m[0].length });
  }

  // Body of an entry is everything between its `- name:` line and the start of
  // the next `- name:` line (or, for the last entry, until a non-indented top-level
  // key like `^[A-Za-z_]` — but we just take everything to EOF which is safe
  // because parseLibraryYaml has already narrowed to the `library:` block).
  for (let i = 0; i < matches.length; i++) {
    const { name, end } = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].start : libBlock.length;
    const body = libBlock.slice(end, nextStart);

    const versionMatch = body.match(/^\s*version:\s*["']?([^"'\n]+?)["']?\s*$/m);
    const tagsMatch = body.match(/^\s*tags:\s*\[([^\]]+)\]\s*$/m);
    const tags = tagsMatch
      ? tagsMatch[1].split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    entries.push({
      name,
      tags,
      version: versionMatch ? versionMatch[1].trim() : '',
    });
  }
  return entries;
}

// ── Loader ────────────────────────────────────────────────────────────
function hydrateSkill(entry: LibraryYamlEntry): LibrarySkill | null {
  const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
  if (!fs.existsSync(skillPath)) return null;
  const content = fs.readFileSync(skillPath, 'utf-8');
  const description =
    parseFrontmatterField(content, 'description') || `Skill: ${entry.name}`;
  return {
    name: entry.name,
    description,
    content,
    tags: entry.tags,
    version: entry.version,
    skillPath,
  };
}

function ensureCache(): void {
  if (!fs.existsSync(LIBRARY_YAML)) {
    cache = { yamlMtime: 0, entries: [], skillMtimes: new Map(), skills: new Map() };
    return;
  }

  const yamlStat = fs.statSync(LIBRARY_YAML);
  const yamlMtime = yamlStat.mtimeMs;

  // Fast path: library.yaml unchanged → verify per-skill SKILL.md mtimes
  if (cache && cache.yamlMtime === yamlMtime) {
    let anyStale = false;
    for (const entry of cache.entries) {
      const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
      let mtime = 0;
      try {
        mtime = fs.statSync(skillPath).mtimeMs;
      } catch {
        mtime = 0; // file deleted
      }
      const cached = cache.skillMtimes.get(entry.name) ?? 0;
      if (mtime !== cached) {
        anyStale = true;
        const hydrated = hydrateSkill(entry);
        if (hydrated) {
          cache.skills.set(entry.name, hydrated);
          cache.skillMtimes.set(entry.name, mtime);
        } else {
          cache.skills.delete(entry.name);
          cache.skillMtimes.delete(entry.name);
        }
      }
    }
    if (!anyStale) return;
    return;
  }

  // Slow path: library.yaml changed → full reparse
  const yamlContent = fs.readFileSync(LIBRARY_YAML, 'utf-8');
  const entries = parseLibraryYaml(yamlContent);

  const skills = new Map<string, LibrarySkill>();
  const skillMtimes = new Map<string, number>();
  for (const entry of entries) {
    const hydrated = hydrateSkill(entry);
    if (!hydrated) continue;
    skills.set(entry.name, hydrated);
    try {
      skillMtimes.set(entry.name, fs.statSync(hydrated.skillPath).mtimeMs);
    } catch {
      skillMtimes.set(entry.name, 0);
    }
  }

  cache = { yamlMtime, entries, skillMtimes, skills };
}

// ── Public API ────────────────────────────────────────────────────────
/** Returns all library (company) skills as an array. Memoized. */
export function loadLibrarySkills(): LibrarySkill[] {
  ensureCache();
  return Array.from(cache!.skills.values());
}

/** Returns a map keyed by skill name. Useful for quick lookups. */
export function loadLibrarySkillsMap(): Map<string, LibrarySkill> {
  ensureCache();
  return new Map(cache!.skills);
}

/** Returns a single skill by name, or null. */
export function getLibrarySkill(name: string): LibrarySkill | null {
  ensureCache();
  return cache!.skills.get(name) ?? null;
}

/** Path of the company skills directory (for Pi additionalSkillPaths). */
export function getLibrarySkillsDir(): string {
  return SKILLS_DIR;
}

/** For tests / reconcile endpoints: force a reload on next access. */
export function invalidateLibraryCache(): void {
  cache = null;
}
