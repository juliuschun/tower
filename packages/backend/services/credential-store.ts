/**
 * Claude Account Credential Store
 *
 * Manages multiple Claude Max/Pro accounts for project-based credential rotation.
 * Each account has its own CLAUDE_CONFIG_DIR with separate OAuth tokens.
 *
 * When no accounts are registered, returns undefined → SDK uses default ~/.claude/
 */

import { query, queryOne, execute } from '../db/pg-repo.js';

export interface ClaudeAccount {
  id: string;
  label: string;
  configDir: string;
  tier: 'max' | 'pro' | 'api';
  isDefault: boolean;
  enabled: boolean;
  createdAt?: string;
}

// ── CRUD ──

export async function listAccounts(): Promise<ClaudeAccount[]> {
  const rows = await query(
    'SELECT * FROM claude_accounts ORDER BY is_default DESC, created_at ASC'
  );
  return rows.map(mapRow);
}

export async function getAccount(id: string): Promise<ClaudeAccount | null> {
  const row = await queryOne('SELECT * FROM claude_accounts WHERE id = $1', [id]);
  return row ? mapRow(row) : null;
}

export async function addAccount(account: {
  id: string;
  label: string;
  configDir: string;
  tier?: string;
  isDefault?: boolean;
}): Promise<ClaudeAccount> {
  // If setting as default, clear existing default first
  if (account.isDefault) {
    await execute('UPDATE claude_accounts SET is_default = false WHERE is_default = true');
  }
  await execute(
    `INSERT INTO claude_accounts (id, label, config_dir, tier, is_default)
     VALUES ($1, $2, $3, $4, $5)`,
    [account.id, account.label, account.configDir, account.tier || 'max', account.isDefault ?? false]
  );
  return (await getAccount(account.id))!;
}

export async function updateAccount(id: string, updates: {
  label?: string;
  configDir?: string;
  tier?: string;
  isDefault?: boolean;
  enabled?: boolean;
}): Promise<ClaudeAccount | null> {
  const sets: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (updates.label !== undefined) { sets.push(`label = $${idx++}`); params.push(updates.label); }
  if (updates.configDir !== undefined) { sets.push(`config_dir = $${idx++}`); params.push(updates.configDir); }
  if (updates.tier !== undefined) { sets.push(`tier = $${idx++}`); params.push(updates.tier); }
  if (updates.enabled !== undefined) { sets.push(`enabled = $${idx++}`); params.push(updates.enabled); }

  if (updates.isDefault === true) {
    await execute('UPDATE claude_accounts SET is_default = false WHERE is_default = true');
    sets.push(`is_default = $${idx++}`); params.push(true);
  } else if (updates.isDefault === false) {
    sets.push(`is_default = $${idx++}`); params.push(false);
  }

  if (sets.length === 0) return getAccount(id);

  params.push(id);
  await execute(`UPDATE claude_accounts SET ${sets.join(', ')} WHERE id = $${idx}`, params);
  return getAccount(id);
}

export async function removeAccount(id: string): Promise<boolean> {
  // Clear project references first (ON DELETE SET NULL handles this, but be explicit)
  await execute('UPDATE projects SET claude_account_id = NULL WHERE claude_account_id = $1', [id]);
  const result = await execute('DELETE FROM claude_accounts WHERE id = $1', [id]);
  return result.changes > 0;
}

// ── Core: resolve configDir for a project ──

/**
 * Get the CLAUDE_CONFIG_DIR for a given project.
 *
 * Resolution order:
 * 1. Project's assigned account (if enabled)
 * 2. Default account (is_default = true, if enabled)
 * 3. undefined → SDK uses process.env / ~/.claude/ (existing behavior)
 */
export async function getConfigDir(projectId?: string | null): Promise<string | undefined> {
  if (projectId) {
    const row = await queryOne(
      `SELECT ca.config_dir FROM projects p
       JOIN claude_accounts ca ON p.claude_account_id = ca.id
       WHERE p.id = $1 AND ca.enabled = true`,
      [projectId]
    );
    if (row) return (row as any).config_dir;
  }

  // Fallback to default account
  const defaultRow = await queryOne(
    'SELECT config_dir FROM claude_accounts WHERE is_default = true AND enabled = true'
  );
  if (defaultRow) return (defaultRow as any).config_dir;

  // No accounts registered → use existing behavior
  return undefined;
}

// ── Project ↔ Account assignment ──

export async function assignAccountToProject(projectId: string, accountId: string | null): Promise<void> {
  await execute(
    'UPDATE projects SET claude_account_id = $1 WHERE id = $2',
    [accountId, projectId]
  );
}

export async function getProjectAccountId(projectId: string): Promise<string | null> {
  const row = await queryOne('SELECT claude_account_id FROM projects WHERE id = $1', [projectId]);
  return (row as any)?.claude_account_id || null;
}

// ── Helpers ──

function mapRow(row: any): ClaudeAccount {
  return {
    id: row.id,
    label: row.label,
    configDir: row.config_dir,
    tier: row.tier || 'max',
    isDefault: !!row.is_default,
    enabled: row.enabled !== false,
    createdAt: row.created_at,
  };
}
