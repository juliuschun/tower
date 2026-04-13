/**
 * skill-credential.ts — Skill ↔ Credential binding service.
 *
 * Connects two existing systems:
 * - skill_registry (what skills exist)
 * - user_oauth_tokens (what credentials users have)
 *
 * via the new skill_providers table (what credentials skills need).
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
// Skill → Provider mapping CRUD
// ═══════════════════════════════════════════════════════════════

/** Get providers required by a skill */
export async function getSkillProviders(skillId: string): Promise<SkillProvider[]> {
  const rows = await query<{ provider: string; required: boolean; scope_hint: string }>(
    'SELECT provider, required, scope_hint FROM skill_providers WHERE skill_id = $1',
    [skillId],
  );
  return rows.map(r => ({
    provider: r.provider,
    required: r.required,
    scopeHint: r.scope_hint,
  }));
}

/** Set providers for a skill (replaces all existing) */
export async function setSkillProviders(
  skillId: string,
  providers: Array<{ provider: string; required?: boolean; scopeHint?: string }>
): Promise<void> {
  await transaction(async (client) => {
    const db = withClient(client);
    await db.execute('DELETE FROM skill_providers WHERE skill_id = $1', [skillId]);
    for (const p of providers) {
      await db.execute(
        `INSERT INTO skill_providers (skill_id, provider, required, scope_hint)
         VALUES ($1, $2, $3, $4)`,
        [skillId, p.provider, p.required ?? true, p.scopeHint ?? ''],
      );
    }
  });
}

/** Upsert a single provider for a skill (used during seed) */
export async function upsertSkillProvider(
  skillId: string,
  provider: string,
  required = true,
  scopeHint = '',
): Promise<void> {
  await execute(
    `INSERT INTO skill_providers (skill_id, provider, required, scope_hint)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (skill_id, provider) DO UPDATE SET
       required = EXCLUDED.required,
       scope_hint = EXCLUDED.scope_hint`,
    [skillId, provider, required, scopeHint],
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
 */
export async function checkSkillReadiness(
  skillId: string,
  userId: number,
): Promise<SkillReadiness> {
  // 1. What does this skill need?
  const skillRow = await query<{ name: string }>(
    'SELECT name FROM skill_registry WHERE id = $1',
    [skillId],
  );
  const skillName = skillRow[0]?.name ?? 'unknown';

  const requiredProviders = await getSkillProviders(skillId);

  // No providers needed → Level 0 (🆓), always ready
  if (requiredProviders.length === 0) {
    return { skillId, skillName, ready: true, missing: [], providers: [] };
  }

  // 2. What does this user have?
  const userProviders = await query<{ provider: string }>(
    'SELECT provider FROM user_oauth_tokens WHERE user_id = $1',
    [userId],
  );
  const connectedSet = new Set(userProviders.map(r => r.provider));

  // 3. Match
  const providers = requiredProviders.map(p => ({
    ...p,
    connected: connectedSet.has(p.provider),
  }));

  const missing = providers
    .filter(p => p.required && !p.connected)
    .map(p => p.provider);

  return {
    skillId,
    skillName,
    ready: missing.length === 0,
    missing,
    providers,
  };
}

/**
 * Batch check: readiness of all skills that require credentials.
 * Used for "My Connections" dashboard.
 */
export async function getUserSkillReadiness(userId: number): Promise<SkillReadiness[]> {
  // Find all skills that have at least one provider requirement
  const skillsWithProviders = await query<{ skill_id: string; name: string }>(
    `SELECT DISTINCT sr.id AS skill_id, sr.name
     FROM skill_registry sr
     JOIN skill_providers sp ON sr.id = sp.skill_id
     WHERE sr.enabled = 1
     ORDER BY sr.name`,
  );

  const results: SkillReadiness[] = [];
  for (const skill of skillsWithProviders) {
    results.push(await checkSkillReadiness(skill.skill_id, userId));
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// SKILL.md frontmatter → skill_providers sync
// ═══════════════════════════════════════════════════════════════

/**
 * Parse providers from SKILL.md frontmatter and sync to skill_providers table.
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
 * Called during seedBundledSkills / seedPluginSkills.
 */
export async function syncSkillProviders(skillId: string, content: string): Promise<void> {
  const providers = parseProvidersFromFrontmatter(content);
  if (providers.length === 0) return;

  for (const p of providers) {
    await upsertSkillProvider(skillId, p.provider, p.required, p.scopeHint);
  }
}
