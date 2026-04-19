/**
 * skill-credential.ts — Skill ↔ Credential binding service.
 *
 * Connects two systems:
 * - library.yaml + ~/.claude/skills/<name>/SKILL.md  (what skills exist — company)
 * - skill_registry (what skills exist — personal/project, DB-backed)
 * - user_oauth_tokens (what credentials users have)
 *
 * via the skill_providers table (what credentials skills need).
 *
 * 2026-04-17: `skill_providers`는 `skill_name` PK로 재설계됨
 *  (workspace/decisions/2026-04-17-skill-db-simplification.md 참조).
 *  company 스킬이 DB에 row가 없어도 skill_name만 있으면 provider 바인딩 가능.
 *
 * "인턴 프레임워크": 스킬 실행 시 요청자의 credential을 자동 바인딩.
 * - Level 0 (🆓): credential 불필요 → providers 없음 → 바로 실행
 * - Level 2 (🔑): 개인 credential 필요 → 있으면 실행, 없으면 연동 안내
 */

import { query, execute, transaction, withClient } from '../db/pg-repo.js';
import type { SkillProvider, SkillReadiness, ConnectionStatus } from '@tower/shared';

// ── Provider metadata (display names, OAuth config hints) ──

export const PROVIDER_META: Record<string, {
  label: string;
  oauthSupported: boolean;
  scopes?: string[];
}> = {
  google: {
    label: 'Google (Gmail, Calendar, Drive)',
    oauthSupported: true,
    scopes: ['gmail.readonly', 'gmail.send', 'calendar.events.readonly'],
  },
  kakao: {
    label: 'KakaoTalk',
    oauthSupported: true,
    scopes: ['talk_message'],
  },
  slack: {
    label: 'Slack',
    oauthSupported: true,
  },
  telegram: {
    label: 'Telegram',
    oauthSupported: false, // link-based, not OAuth
  },
  github: {
    label: 'GitHub',
    oauthSupported: true,
  },
};

// ═══════════════════════════════════════════════════════════════
// Skill → Provider mapping CRUD (skill_name-based)
// ═══════════════════════════════════════════════════════════════

/** Get providers required by a skill (by skill name). */
export async function getSkillProviders(skillName: string): Promise<SkillProvider[]> {
  const rows = await query<{ provider: string; required: boolean; scope_hint: string }>(
    'SELECT provider, required, scope_hint FROM skill_providers WHERE skill_name = $1',
    [skillName],
  );
  return rows.map(r => ({
    provider: r.provider,
    required: r.required,
    scopeHint: r.scope_hint,
  }));
}

/** Set providers for a skill (replaces all existing). */
export async function setSkillProviders(
  skillName: string,
  providers: Array<{ provider: string; required?: boolean; scopeHint?: string }>
): Promise<void> {
  await transaction(async (client) => {
    const db = withClient(client);
    await db.execute('DELETE FROM skill_providers WHERE skill_name = $1', [skillName]);
    for (const p of providers) {
      await db.execute(
        `INSERT INTO skill_providers (skill_name, provider, required, scope_hint)
         VALUES ($1, $2, $3, $4)`,
        [skillName, p.provider, p.required ?? true, p.scopeHint ?? ''],
      );
    }
  });
}

/** Upsert a single provider for a skill (used during seed / manifest sync). */
export async function upsertSkillProvider(
  skillName: string,
  provider: string,
  required = true,
  scopeHint = '',
): Promise<void> {
  await execute(
    `INSERT INTO skill_providers (skill_name, provider, required, scope_hint)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (skill_name, provider) DO UPDATE SET
       required = EXCLUDED.required,
       scope_hint = EXCLUDED.scope_hint`,
    [skillName, provider, required, scopeHint],
  );
}

// ═══════════════════════════════════════════════════════════════
// User connection status
// ═══════════════════════════════════════════════════════════════

/** Get all connection statuses for a user */
export async function getUserConnections(userId: number): Promise<ConnectionStatus[]> {
  const rows = await query<{
    provider: string;
    provider_nickname: string | null;
    token_expires_at: number | null;
  }>(
    'SELECT provider, provider_nickname, token_expires_at FROM user_oauth_tokens WHERE user_id = $1',
    [userId],
  );

  // Return all known providers, marking which are connected
  const connected = new Map(rows.map(r => [r.provider, r]));
  const allProviders = Object.keys(PROVIDER_META);

  return allProviders.map(provider => {
    const token = connected.get(provider);
    return {
      provider,
      connected: !!token,
      nickname: token?.provider_nickname ?? null,
      expiresAt: token?.token_expires_at ?? null,
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// Skill readiness check (the core binding logic)
// ═══════════════════════════════════════════════════════════════

/**
 * Check if a user has all required credentials for a skill.
 *
 * Returns:
 * - ready=true → all required providers connected, skill can execute
 * - ready=false → missing providers listed, frontend shows connection guide
 *
 * `skillName` is used as the natural key across library (company) and DB
 * (personal/project). `SkillReadiness.skillId` is populated with the same
 * name since the React UI only needs a stable unique key, not a UUID.
 */
export async function checkSkillReadiness(
  skillName: string,
  userId: number,
): Promise<SkillReadiness> {
  const requiredProviders = await getSkillProviders(skillName);

  // No providers needed → Level 0 (🆓), always ready
  if (requiredProviders.length === 0) {
    return { skillId: skillName, skillName, ready: true, missing: [], providers: [] };
  }

  // What does this user have?
  const userProviders = await query<{ provider: string }>(
    'SELECT provider FROM user_oauth_tokens WHERE user_id = $1',
    [userId],
  );
  const connectedSet = new Set(userProviders.map(r => r.provider));

  // Match
  const providers = requiredProviders.map(p => ({
    ...p,
    connected: connectedSet.has(p.provider),
  }));

  const missing = providers
    .filter(p => p.required && !p.connected)
    .map(p => p.provider);

  return {
    skillId: skillName,
    skillName,
    ready: missing.length === 0,
    missing,
    providers,
  };
}

/**
 * Batch check: readiness of all skills that require credentials.
 * Used for "My Connections" dashboard.
 *
 * Queries skill_providers directly (skill_name-based), so library/company
 * skills are included naturally without any JOIN on skill_registry.
 */
export async function getUserSkillReadiness(userId: number): Promise<SkillReadiness[]> {
  const skillNames = await query<{ skill_name: string }>(
    `SELECT DISTINCT skill_name FROM skill_providers ORDER BY skill_name`,
  );

  const results: SkillReadiness[] = [];
  for (const row of skillNames) {
    results.push(await checkSkillReadiness(row.skill_name, userId));
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// SKILL.md frontmatter → skill_providers sync
// ═══════════════════════════════════════════════════════════════

/**
 * Parse providers block from a SKILL.md frontmatter.
 *
 * Expected SKILL.md format:
 * ```yaml
 * ---
 * name: gmail
 * providers:
 *   - provider: google
 *     required: true
 *     scope_hint: gmail.readonly gmail.send
 * ---
 * ```
 */
export function parseProvidersFromFrontmatter(content: string): Array<{
  provider: string;
  required: boolean;
  scopeHint: string;
}> {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const fm = fmMatch[1];

  // Find providers block
  const providersMatch = fm.match(/^providers:\s*\n((?:\s+-[^\n]*\n?(?:\s+[^\n]*\n?)*)*)/m);
  if (!providersMatch) return [];

  const block = providersMatch[1];
  const providers: Array<{ provider: string; required: boolean; scopeHint: string }> = [];

  // Parse YAML list items (simple parser, no library dependency)
  const items = block.split(/\n\s*-\s+/).filter(Boolean);
  for (const item of items) {
    const providerMatch = item.match(/provider:\s*(\S+)/);
    if (!providerMatch) continue;

    const requiredMatch = item.match(/required:\s*(true|false)/);
    const scopeMatch = item.match(/scope_hint:\s*(.+)/);

    providers.push({
      provider: providerMatch[1],
      required: requiredMatch ? requiredMatch[1] === 'true' : true,
      scopeHint: scopeMatch ? scopeMatch[1].trim() : '',
    });
  }

  return providers;
}

/**
 * Sync providers from a skill's content to skill_providers table.
 * Called during library load and personal/project skill seeding.
 */
export async function syncSkillProviders(skillName: string, content: string): Promise<void> {
  const providers = parseProvidersFromFrontmatter(content);
  if (providers.length === 0) return;

  for (const p of providers) {
    await upsertSkillProvider(skillName, p.provider, p.required, p.scopeHint);
  }
}

/**
 * Reconcile skill_providers against the full set of library + DB skills.
 * Removes rows for skill_name values that no longer exist anywhere (orphans).
 *
 * Typical call site: after loading library.yaml + personal/project skills
 * on startup, or after a `/api/skills/*` mutation.
 */
export async function reconcileSkillProviders(activeSkillNames: Set<string>): Promise<number> {
  if (activeSkillNames.size === 0) return 0;
  const names = Array.from(activeSkillNames);
  const placeholders = names.map((_, i) => `$${i + 1}`).join(',');
  const result = await execute(
    `DELETE FROM skill_providers WHERE skill_name NOT IN (${placeholders})`,
    names,
  );
  return (result as any)?.rowCount ?? 0;
}
