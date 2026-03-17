import { query, queryOne, execute } from '../db/pg-repo.js';

export interface Group {
  id: number;
  name: string;
  description: string | null;
  isGlobal: boolean;
  createdAt: string;
}

export interface GroupWithMembers extends Group {
  members: { id: number; username: string }[];
}

function rowToGroup(row: any): Group {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isGlobal: !!row.is_global,
    createdAt: row.created_at,
  };
}

// ── Group CRUD ──

export async function createGroup(name: string, description?: string, isGlobal = false): Promise<Group> {
  const row = await queryOne<any>(
    'INSERT INTO groups (name, description, is_global) VALUES ($1, $2, $3) RETURNING *',
    [name, description ?? null, isGlobal ? 1 : 0]
  );
  return rowToGroup(row);
}

export async function getGroup(id: number): Promise<Group | null> {
  const row = await queryOne<any>('SELECT * FROM groups WHERE id = $1', [id]);
  return row ? rowToGroup(row) : null;
}

export async function listGroups(): Promise<GroupWithMembers[]> {
  const rows = await query<any>('SELECT * FROM groups ORDER BY name');
  const groups = rows.map(rowToGroup);

  const result: GroupWithMembers[] = [];
  for (const g of groups) {
    const members = await query<{ id: number; username: string }>(
      `SELECT u.id, u.username FROM users u
       JOIN user_groups ug ON ug.user_id = u.id
       WHERE ug.group_id = $1 AND u.disabled = 0
       ORDER BY u.username`,
      [g.id]
    );
    result.push({ ...g, members });
  }
  return result;
}

export async function updateGroup(id: number, updates: { name?: string; description?: string; isGlobal?: boolean }): Promise<Group | null> {
  const sets: string[] = [];
  const vals: any[] = [];
  let idx = 1;
  if (updates.name !== undefined) { sets.push(`name = $${idx++}`); vals.push(updates.name); }
  if (updates.description !== undefined) { sets.push(`description = $${idx++}`); vals.push(updates.description); }
  if (updates.isGlobal !== undefined) { sets.push(`is_global = $${idx++}`); vals.push(updates.isGlobal ? 1 : 0); }
  if (sets.length === 0) return getGroup(id);
  vals.push(id);
  await execute(`UPDATE groups SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
  return getGroup(id);
}

export async function deleteGroup(id: number): Promise<boolean> {
  const result = await execute('DELETE FROM groups WHERE id = $1', [id]);
  return result.changes > 0;
}

// ── User ↔ Group ──

export async function addUserToGroup(userId: number, groupId: number): Promise<void> {
  await execute('INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, groupId]);
}

export async function removeUserFromGroup(userId: number, groupId: number): Promise<void> {
  await execute('DELETE FROM user_groups WHERE user_id = $1 AND group_id = $2', [userId, groupId]);
}

export async function getUserGroups(userId: number): Promise<Group[]> {
  const rows = await query<any>(
    `SELECT g.* FROM groups g
     JOIN user_groups ug ON ug.group_id = g.id
     WHERE ug.user_id = $1
     ORDER BY g.name`,
    [userId]
  );
  return rows.map(rowToGroup);
}

// ── Project Members ──

export interface ProjectMember {
  userId: number;
  username: string;
  role: string;
  addedAt: string;
}

export async function getProjectMembers(projectId: string): Promise<ProjectMember[]> {
  return await query<ProjectMember>(`
    SELECT pm.user_id as userId, u.username, pm.role, pm.added_at as addedAt
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = $1 AND u.disabled = 0
    ORDER BY pm.role DESC, u.username
  `, [projectId]);
}

export async function addProjectMember(projectId: string, userId: number, role = 'member'): Promise<void> {
  await execute(
    'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [projectId, userId, role]
  );
}

export async function removeProjectMember(projectId: string, userId: number): Promise<boolean> {
  // Prevent removing last owner
  const ownerCountRow = await queryOne<any>(
    `SELECT COUNT(*) as cnt FROM project_members WHERE project_id = $1 AND role = 'owner'`,
    [projectId]
  );
  const ownerCount = ownerCountRow?.cnt ?? 0;
  const isOwner = await queryOne(
    `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = 'owner'`,
    [projectId, userId]
  );
  if (isOwner && ownerCount <= 1) return false; // Can't remove last owner

  await execute('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
  return true;
}

export async function isProjectOwner(projectId: string, userId: number): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = 'owner'`,
    [projectId, userId]
  );
  return !!row;
}

export async function isProjectMember(projectId: string, userId: number): Promise<boolean> {
  const row = await queryOne(
    'SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2',
    [projectId, userId]
  );
  return !!row;
}

export async function inviteGroupToProject(groupId: number, projectId: string): Promise<number> {
  const result = await execute(`
    INSERT INTO project_members (project_id, user_id, role)
    SELECT $1, ug.user_id, 'member'
    FROM user_groups ug
    JOIN users u ON u.id = ug.user_id
    WHERE ug.group_id = $2 AND u.disabled = 0
    ON CONFLICT DO NOTHING
  `, [projectId, groupId]);
  return result.changes;
}

// ── Core: 사용자가 접근 가능한 프로젝트 ID 목록 ──

export async function getAccessibleProjectIds(userId: number, role: string): Promise<string[] | null> {
  // admin → 전부 접근 가능
  if (role === 'admin') return null;

  // project_members에 있는 프로젝트 + 본인이 만든 프로젝트
  const rows = await query<{ id: string }>(`
    SELECT DISTINCT p.id FROM projects p
    WHERE p.archived = 0
      AND (
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = p.id AND pm.user_id = $1
        )
        OR p.user_id = $2
      )
  `, [userId, userId]);

  return rows.map(r => r.id);
}
