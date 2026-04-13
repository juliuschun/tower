/**
 * Automation Manager — Tasks + Schedules 통합 서비스
 *
 * 모든 AI 실행을 하나의 "automation" 엔티티로 관리:
 *   - trigger: manual (수동), cron (반복), once (일회), event (미래)
 *   - mode:    spawn (새 세션), inject (세션 주입), channel (채널 게시)
 *   - status:  idle → running → done/failed, archived
 *
 * 기존 task-manager.ts + unified-scheduler.ts를 대체한다.
 */

import { query, queryOne, execute, transaction, withClient } from '../db/pg-repo.js';
import { getAccessibleProjectIds } from './group-manager.js';
import { v4 as uuidv4 } from 'uuid';

// ── Types ──

export type AutomationMode = 'spawn' | 'inject' | 'channel';
export type AutomationTrigger = 'manual' | 'cron' | 'once' | 'event';
export type AutomationStatus = 'idle' | 'running' | 'done' | 'failed' | 'archived';

export interface CronConfig {
  type: 'daily' | 'weekdays' | 'weekly' | 'interval';
  hour?: number;
  minute?: number;
  day?: number;   // 0=Sun..6=Sat
  hours?: number; // interval mode
}

export interface Automation {
  id: string;
  userId: number;
  projectId: string | null;

  name: string;
  description: string;
  prompt: string;
  model: string;
  workflow: string;

  mode: AutomationMode;
  targetId: string | null;
  cwd: string | null;

  triggerType: AutomationTrigger;
  cronConfig: CronConfig | null;
  onceAt: string | null;

  status: AutomationStatus;
  enabled: boolean;
  sortOrder: number;

  sessionId: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  runCount: number;
  lastStatus: string | null;
  lastError: string | null;

  progressSummary: string[];
  todoSnapshot: any[] | null;
  parentId: string | null;
  worktreePath: string | null;

  roomId: string | null;
  triggeredBy: number | null;
  roomMessageId: string | null;

  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  status: string;
  mode: string;
  resultId: string | null;
  error: string | null;
  durationMs: number | null;
  ranAt: string;
}

export interface AutomationFilters {
  status?: AutomationStatus | AutomationStatus[];
  triggerType?: AutomationTrigger;
  projectId?: string;
  mode?: AutomationMode;
  workflow?: string;
  includeArchived?: boolean;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  nameKo: string;
  description: string;
  descriptionKo: string;
  icon: string;
  defaultTrigger: AutomationTrigger;
  defaultMode: AutomationMode;
  defaultCron?: CronConfig;
  promptTemplate: string;
  category: 'research' | 'development' | 'operations' | 'communication';
}

// ── Row mapping ──

function mapRow(row: any): Automation {
  let todoSnapshot = null;
  if (row.todo_snapshot) {
    try { todoSnapshot = JSON.parse(row.todo_snapshot); } catch {}
  }
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id || null,

    name: row.name,
    description: row.description || '',
    prompt: row.prompt || '',
    model: row.model || 'claude-sonnet-4-6',
    workflow: row.workflow || 'auto',

    mode: row.mode || 'spawn',
    targetId: row.target_id || null,
    cwd: row.cwd || null,

    triggerType: row.trigger_type || 'manual',
    cronConfig: row.cron_config || null,
    onceAt: row.once_at || null,

    status: row.status || 'idle',
    enabled: row.enabled ?? true,
    sortOrder: row.sort_order ?? 0,

    sessionId: row.session_id || null,
    nextRunAt: row.next_run_at || null,
    lastRunAt: row.last_run_at || null,
    runCount: row.run_count || 0,
    lastStatus: row.last_status || null,
    lastError: row.last_error || null,

    progressSummary: JSON.parse(row.progress_summary || '[]'),
    todoSnapshot,
    parentId: row.parent_id || null,
    worktreePath: row.worktree_path || null,

    roomId: row.room_id || null,
    triggeredBy: row.triggered_by || null,
    roomMessageId: row.room_message_id || null,

    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
  };
}

function mapRunRow(row: any): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    status: row.status,
    mode: row.mode,
    resultId: row.result_id || null,
    error: row.error || null,
    durationMs: row.duration_ms ?? null,
    ranAt: row.ran_at,
  };
}

// ── Next run calculation ──

export function calculateNextRun(cron: CronConfig, from: Date = new Date()): Date {
  const next = new Date(from);

  switch (cron.type) {
    case 'daily': {
      next.setHours(cron.hour ?? 9, cron.minute ?? 0, 0, 0);
      if (next <= from) next.setDate(next.getDate() + 1);
      return next;
    }
    case 'weekdays': {
      next.setHours(cron.hour ?? 9, cron.minute ?? 0, 0, 0);
      if (next <= from) next.setDate(next.getDate() + 1);
      while (next.getDay() === 0 || next.getDay() === 6) {
        next.setDate(next.getDate() + 1);
      }
      return next;
    }
    case 'weekly': {
      const targetDay = cron.day ?? 1;
      next.setHours(cron.hour ?? 9, cron.minute ?? 0, 0, 0);
      let daysUntil = targetDay - next.getDay();
      if (daysUntil < 0) daysUntil += 7;
      if (daysUntil === 0 && next <= from) daysUntil = 7;
      next.setDate(next.getDate() + daysUntil);
      return next;
    }
    case 'interval': {
      const intervalMs = (cron.hours ?? 1) * 60 * 60 * 1000;
      return new Date(from.getTime() + intervalMs);
    }
    default:
      return new Date(from.getTime() + 3600_000);
  }
}

// ── CRUD ──

export async function createAutomation(data: {
  userId: number;
  projectId?: string;
  name: string;
  description?: string;
  prompt: string;
  model?: string;
  workflow?: string;
  mode?: AutomationMode;
  targetId?: string;
  cwd?: string;
  triggerType?: AutomationTrigger;
  cronConfig?: CronConfig;
  onceAt?: string;
  parentId?: string;
  roomId?: string;
  triggeredBy?: number;
  roomMessageId?: string;
}): Promise<Automation> {
  const id = uuidv4();
  const triggerType = data.triggerType || 'manual';

  // Calculate initial next_run_at
  let nextRunAt: string | null = null;
  if (triggerType === 'once' && data.onceAt) {
    nextRunAt = new Date(data.onceAt).toISOString();
  } else if (triggerType === 'cron' && data.cronConfig) {
    nextRunAt = calculateNextRun(data.cronConfig).toISOString();
  }

  // Determine sort_order
  const maxOrder = await queryOne<any>('SELECT MAX(sort_order) as max_order FROM automations WHERE status = $1', ['idle']);
  const sortOrder = (maxOrder?.max_order ?? -1) + 1;

  // Auto-resolve project from cwd if not explicitly provided
  let resolvedProjectId = data.projectId ?? null;
  if (!resolvedProjectId && data.cwd) {
    resolvedProjectId = await resolveProjectFromCwd(data.cwd);
  }

  await execute(`
    INSERT INTO automations (
      id, user_id, project_id,
      name, description, prompt, model, workflow,
      mode, target_id, cwd,
      trigger_type, cron_config, once_at,
      status, enabled, sort_order,
      next_run_at,
      parent_id, room_id, triggered_by, room_message_id
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6, $7, $8,
      $9, $10, $11,
      $12, $13, $14,
      'idle', true, $15,
      $16,
      $17, $18, $19, $20
    )
  `, [
    id, data.userId, resolvedProjectId,
    data.name, data.description || '', data.prompt, data.model || 'claude-sonnet-4-6', data.workflow || 'auto',
    data.mode || 'spawn', data.targetId || null, data.cwd || null,
    triggerType, data.cronConfig ? JSON.stringify(data.cronConfig) : null, data.onceAt || null,
    sortOrder,
    nextRunAt,
    data.parentId || null, data.roomId || null, data.triggeredBy || null, data.roomMessageId || null,
  ]);

  return (await getAutomation(id))!;
}

export async function getAutomations(userId: number, role?: string, filters?: AutomationFilters): Promise<Automation[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  // Exclude archived by default
  if (!filters?.includeArchived) {
    conditions.push(`status != 'archived'`);
  }

  // Status filter
  if (filters?.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    conditions.push(`status IN (${statuses.map(() => `$${idx++}`).join(', ')})`);
    params.push(...statuses);
  }

  // Trigger filter
  if (filters?.triggerType) {
    conditions.push(`trigger_type = $${idx++}`);
    params.push(filters.triggerType);
  }

  // Project filter
  if (filters?.projectId) {
    conditions.push(`project_id = $${idx++}`);
    params.push(filters.projectId);
  }

  // Mode filter
  if (filters?.mode) {
    conditions.push(`mode = $${idx++}`);
    params.push(filters.mode);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query<any>(
    `SELECT * FROM automations ${whereClause} ORDER BY
      CASE status WHEN 'running' THEN 0 WHEN 'idle' THEN 1 WHEN 'done' THEN 2 WHEN 'failed' THEN 3 ELSE 4 END,
      sort_order ASC, updated_at DESC`,
    params,
  );

  // Permission scoping
  if (userId && role) {
    const accessibleIds = await getAccessibleProjectIds(userId, role);
    if (accessibleIds !== null) {
      return rows.filter((r: any) => {
        if (!r.project_id) return r.user_id === userId;
        return accessibleIds.includes(r.project_id);
      }).map(mapRow);
    }
  }

  // No group filtering: filter by user_id
  if (userId) {
    return rows.filter((r: any) => r.user_id === userId || r.user_id === null).map(mapRow);
  }
  return rows.map(mapRow);
}

export async function getAutomation(id: string): Promise<Automation | null> {
  const row = await queryOne<any>('SELECT * FROM automations WHERE id = $1', [id]);
  return row ? mapRow(row) : null;
}

export async function updateAutomation(id: string, updates: Partial<{
  name: string;
  description: string;
  prompt: string;
  model: string;
  workflow: string;
  mode: AutomationMode;
  targetId: string | null;
  cwd: string | null;
  triggerType: AutomationTrigger;
  cronConfig: CronConfig | null;
  onceAt: string | null;
  status: AutomationStatus;
  enabled: boolean;
  sortOrder: number;
  sessionId: string | null;
  progressSummary: string[];
  todoSnapshot: any[] | null;
  completedAt: string | null;
  parentId: string | null;
  worktreePath: string | null;
  projectId: string | null;
  roomId: string | null;
  triggeredBy: number | null;
  roomMessageId: string | null;
  lastRunAt: string | null;
  runCount: number;
  lastStatus: string | null;
  lastError: string | null;
}>): Promise<Automation | null> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  const addField = (col: string, val: any) => {
    fields.push(`${col} = $${paramIndex++}`);
    values.push(val);
  };

  if (updates.name !== undefined) addField('name', updates.name);
  if (updates.description !== undefined) addField('description', updates.description);
  if (updates.prompt !== undefined) addField('prompt', updates.prompt);
  if (updates.model !== undefined) addField('model', updates.model);
  if (updates.workflow !== undefined) addField('workflow', updates.workflow);
  if (updates.mode !== undefined) addField('mode', updates.mode);
  if (updates.targetId !== undefined) addField('target_id', updates.targetId);
  if (updates.cwd !== undefined) addField('cwd', updates.cwd);
  if (updates.triggerType !== undefined) addField('trigger_type', updates.triggerType);
  if (updates.cronConfig !== undefined) addField('cron_config', updates.cronConfig ? JSON.stringify(updates.cronConfig) : null);
  if (updates.onceAt !== undefined) addField('once_at', updates.onceAt);
  if (updates.status !== undefined) addField('status', updates.status);
  if (updates.enabled !== undefined) addField('enabled', updates.enabled);
  if (updates.sortOrder !== undefined) addField('sort_order', updates.sortOrder);
  if (updates.sessionId !== undefined) addField('session_id', updates.sessionId);
  if (updates.progressSummary !== undefined) addField('progress_summary', JSON.stringify(updates.progressSummary));
  if (updates.todoSnapshot !== undefined) addField('todo_snapshot', updates.todoSnapshot ? JSON.stringify(updates.todoSnapshot) : null);
  if (updates.completedAt !== undefined) addField('completed_at', updates.completedAt);
  if (updates.parentId !== undefined) addField('parent_id', updates.parentId);
  if (updates.worktreePath !== undefined) addField('worktree_path', updates.worktreePath);
  if (updates.projectId !== undefined) addField('project_id', updates.projectId);
  if (updates.roomId !== undefined) addField('room_id', updates.roomId);
  if (updates.triggeredBy !== undefined) addField('triggered_by', updates.triggeredBy);
  if (updates.roomMessageId !== undefined) addField('room_message_id', updates.roomMessageId);
  if (updates.lastRunAt !== undefined) addField('last_run_at', updates.lastRunAt);
  if (updates.runCount !== undefined) addField('run_count', updates.runCount);
  if (updates.lastStatus !== undefined) addField('last_status', updates.lastStatus);
  if (updates.lastError !== undefined) addField('last_error', updates.lastError);

  if (fields.length === 0) return getAutomation(id);

  // Recalculate next_run_at if schedule parameters changed
  if (updates.triggerType !== undefined || updates.cronConfig !== undefined || updates.onceAt !== undefined || updates.enabled !== undefined) {
    const existing = await getAutomation(id);
    if (existing) {
      const triggerType = updates.triggerType ?? existing.triggerType;
      const cronConfig = updates.cronConfig !== undefined ? updates.cronConfig : existing.cronConfig;
      const onceAt = updates.onceAt !== undefined ? updates.onceAt : existing.onceAt;
      const enabled = updates.enabled ?? existing.enabled;

      let nextRunAt: string | null = null;
      if (enabled) {
        if (triggerType === 'once' && onceAt) {
          nextRunAt = new Date(onceAt).toISOString();
        } else if (triggerType === 'cron' && cronConfig) {
          nextRunAt = calculateNextRun(cronConfig).toISOString();
        }
      }
      addField('next_run_at', nextRunAt);
    }
  }

  addField('updated_at', new Date().toISOString());
  values.push(id);

  await execute(`UPDATE automations SET ${fields.join(', ')} WHERE id = $${paramIndex}`, values);
  return getAutomation(id);
}

export async function deleteAutomation(id: string): Promise<boolean> {
  // Soft-delete: archive
  const result = await execute(
    `UPDATE automations SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id],
  );
  return result.changes > 0;
}

export async function permanentlyDeleteAutomation(id: string): Promise<boolean> {
  const result = await execute('DELETE FROM automations WHERE id = $1', [id]);
  return result.changes > 0;
}

export async function restoreAutomation(id: string): Promise<boolean> {
  const result = await execute(
    `UPDATE automations SET status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'archived'`,
    [id],
  );
  return result.changes > 0;
}

export async function getChildAutomations(parentId: string): Promise<Automation[]> {
  const rows = await query<any>(
    `SELECT * FROM automations WHERE parent_id = $1 AND status != 'archived' ORDER BY sort_order`,
    [parentId],
  );
  return rows.map(mapRow);
}

export async function reorderAutomations(automationIds: string[], status: string): Promise<void> {
  // Map frontend status → automation status
  const mappedStatus = status === 'todo' ? 'idle' : status === 'in_progress' ? 'running' : status;

  await transaction(async (client) => {
    const db = withClient(client);
    for (let i = 0; i < automationIds.length; i++) {
      await db.execute(
        'UPDATE automations SET sort_order = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [i, mappedStatus, automationIds[i]],
      );
    }
  });
}

export async function getArchivedAutomations(userId?: number): Promise<Automation[]> {
  const rows = userId
    ? await query<any>(`SELECT * FROM automations WHERE user_id = $1 AND status = 'archived' ORDER BY updated_at DESC`, [userId])
    : await query<any>(`SELECT * FROM automations WHERE status = 'archived' ORDER BY updated_at DESC`);
  return rows.map(mapRow);
}

// ── Run history ──

export async function getAutomationRuns(automationId: string, limit = 20): Promise<AutomationRun[]> {
  const rows = await query<any>(
    'SELECT * FROM automation_runs WHERE automation_id = $1 ORDER BY ran_at DESC LIMIT $2',
    [automationId, limit],
  );
  return rows.map(mapRunRow);
}

export async function logRun(
  automationId: string,
  status: string,
  mode: string,
  resultId: string | null,
  error: string | null,
  durationMs: number,
): Promise<void> {
  await execute(`
    INSERT INTO automation_runs (id, automation_id, status, mode, result_id, error, duration_ms)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [uuidv4(), automationId, status, mode, resultId, error, durationMs]);
}

// ── Schedule advancement ──

export async function advanceSchedule(automation: Automation, status: string, error: string | null): Promise<void> {
  if (automation.triggerType === 'once') {
    await execute(`
      UPDATE automations
      SET enabled = false, last_run_at = NOW(), run_count = run_count + 1,
          last_status = $1, last_error = $2, updated_at = NOW()
      WHERE id = $3
    `, [status, error, automation.id]);
  } else if (automation.triggerType === 'cron' && automation.cronConfig) {
    const nextRun = calculateNextRun(automation.cronConfig);
    await execute(`
      UPDATE automations
      SET next_run_at = $1, last_run_at = NOW(), run_count = run_count + 1,
          last_status = $2, last_error = $3, updated_at = NOW()
      WHERE id = $4
    `, [nextRun.toISOString(), status, error, automation.id]);
  }
}

// ── Project resolution (from task-manager) ──

export async function resolveProjectFromCwd(cwd: string): Promise<string | null> {
  const projects = await query<{ id: string; root_path: string }>(
    'SELECT id, root_path FROM projects WHERE root_path IS NOT NULL AND (archived IS NULL OR archived = 0)'
  );
  let bestMatch: string | null = null;
  let bestLen = 0;
  for (const p of projects) {
    const rp = p.root_path.endsWith('/') ? p.root_path.slice(0, -1) : p.root_path;
    if ((cwd === rp || cwd.startsWith(rp + '/')) && rp.length > bestLen) {
      bestMatch = p.id;
      bestLen = rp.length;
    }
  }
  return bestMatch;
}

export async function backfillAutomationProjects(): Promise<{ updated: number; total: number }> {
  const orphans = await query<{ id: string; cwd: string }>(
    `SELECT id, cwd FROM automations WHERE project_id IS NULL AND cwd IS NOT NULL AND status != 'archived'`
  );
  let updated = 0;
  for (const a of orphans) {
    const projectId = await resolveProjectFromCwd(a.cwd);
    if (projectId) {
      await execute('UPDATE automations SET project_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [projectId, a.id]);
      updated++;
    }
  }
  return { updated, total: orphans.length };
}

// ── Distinct CWDs (for UI filters) ──

export async function getDistinctCwds(userId?: number): Promise<string[]> {
  const rows = userId
    ? await query<any>('SELECT DISTINCT cwd FROM automations WHERE user_id = $1 AND cwd IS NOT NULL ORDER BY cwd', [userId])
    : await query<any>('SELECT DISTINCT cwd FROM automations WHERE cwd IS NOT NULL ORDER BY cwd');
  return rows.map((r: any) => r.cwd);
}

// ── Workflow Templates ──

const TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'research',
    name: 'Research',
    nameKo: '리서치',
    description: 'Deep research on a topic with web search and summary report',
    descriptionKo: '주제에 대해 웹 검색 + 요약 리포트 생성',
    icon: '🔍',
    defaultTrigger: 'manual',
    defaultMode: 'spawn',
    promptTemplate: '다음 주제에 대해 심층 리서치를 진행하세요:\n\n{{topic}}\n\n웹 검색으로 최신 정보를 수집하고, 핵심 발견사항을 요약 리포트로 정리해주세요.',
    category: 'research',
  },
  {
    id: 'monitoring',
    name: 'Monitoring',
    nameKo: '모니터링',
    description: 'Periodic status check with anomaly alerts',
    descriptionKo: 'URL/서비스 상태를 주기적으로 확인하고 이상 시 알림',
    icon: '📊',
    defaultTrigger: 'cron',
    defaultMode: 'channel',
    defaultCron: { type: 'interval', hours: 1 },
    promptTemplate: '다음 서비스/URL의 상태를 확인하세요:\n\n{{target}}\n\n정상이면 간단히 보고, 이상이 있으면 상세히 알려주세요.',
    category: 'operations',
  },
  {
    id: 'code-impl',
    name: 'Code Implementation',
    nameKo: '코드 구현',
    description: 'Implement features based on requirements',
    descriptionKo: '요구사항 기반 코드 작성 + 테스트',
    icon: '🏗',
    defaultTrigger: 'manual',
    defaultMode: 'spawn',
    promptTemplate: '다음 요구사항을 구현하세요:\n\n{{requirements}}\n\n코드 작성 후 테스트도 함께 작성해주세요.',
    category: 'development',
  },
  {
    id: 'daily-briefing',
    name: 'Daily Briefing',
    nameKo: '데일리 브리핑',
    description: 'Daily project status summary',
    descriptionKo: '매일 프로젝트 현황 + 할일 요약',
    icon: '📰',
    defaultTrigger: 'cron',
    defaultMode: 'inject',
    defaultCron: { type: 'daily', hour: 9, minute: 0 },
    promptTemplate: '오늘의 프로젝트 현황을 브리핑해주세요:\n\n1. 어제 완료된 작업\n2. 오늘 해야 할 작업\n3. 블로커나 주의사항\n\n간결하게 정리해주세요.',
    category: 'operations',
  },
  {
    id: 'report',
    name: 'Report Generation',
    nameKo: '보고서 생성',
    description: 'Data analysis and document generation',
    descriptionKo: '데이터 분석 + 문서 생성',
    icon: '📋',
    defaultTrigger: 'manual',
    defaultMode: 'spawn',
    promptTemplate: '다음 데이터/주제에 대한 보고서를 작성하세요:\n\n{{subject}}\n\n분석 결과와 인사이트를 포함해주세요.',
    category: 'research',
  },
  {
    id: 'team-notify',
    name: 'Team Notification',
    nameKo: '팀 알림',
    description: 'Send periodic notifications to a channel',
    descriptionKo: '채널에 정기 알림 메시지 전송',
    icon: '🔔',
    defaultTrigger: 'cron',
    defaultMode: 'channel',
    defaultCron: { type: 'weekly', day: 1, hour: 10, minute: 0 },
    promptTemplate: '팀에게 다음 내용을 알려주세요:\n\n{{message}}',
    category: 'communication',
  },
  {
    id: 'code-review',
    name: 'Code Review',
    nameKo: '코드 리뷰',
    description: 'Analyze code changes and suggest improvements',
    descriptionKo: 'PR/diff 분석 + 개선점 제안',
    icon: '🔎',
    defaultTrigger: 'manual',
    defaultMode: 'spawn',
    promptTemplate: '다음 코드 변경사항을 리뷰해주세요:\n\n{{target}}\n\n버그, 성능, 가독성 관점에서 개선점을 제안해주세요.',
    category: 'development',
  },
  {
    id: 'data-pipeline',
    name: 'Data Pipeline',
    nameKo: '데이터 파이프라인',
    description: 'Periodic data collection and processing',
    descriptionKo: '정기 데이터 수집/가공',
    icon: '⚙️',
    defaultTrigger: 'cron',
    defaultMode: 'spawn',
    defaultCron: { type: 'daily', hour: 6, minute: 0 },
    promptTemplate: '다음 데이터 파이프라인을 실행하세요:\n\n{{pipeline}}\n\n수집 → 변환 → 저장 순서로 진행해주세요.',
    category: 'operations',
  },
];

export function getTemplates(): WorkflowTemplate[] {
  return TEMPLATES;
}

export async function createFromTemplate(
  templateId: string,
  userId: number,
  overrides?: Partial<{
    name: string;
    prompt: string;
    model: string;
    projectId: string;
    cwd: string;
    triggerType: AutomationTrigger;
    cronConfig: CronConfig;
    mode: AutomationMode;
    targetId: string;
  }>,
): Promise<Automation> {
  const template = TEMPLATES.find(t => t.id === templateId);
  if (!template) throw new Error(`Template not found: ${templateId}`);

  return createAutomation({
    userId,
    name: overrides?.name || template.nameKo,
    description: template.descriptionKo,
    prompt: overrides?.prompt || template.promptTemplate,
    model: overrides?.model || 'claude-sonnet-4-6',
    workflow: templateId,
    mode: overrides?.mode || template.defaultMode,
    targetId: overrides?.targetId,
    cwd: overrides?.cwd,
    triggerType: overrides?.triggerType || template.defaultTrigger,
    cronConfig: overrides?.cronConfig || template.defaultCron,
    projectId: overrides?.projectId,
  });
}

// ── Backward-compatible helpers (for task-runner.ts migration) ──

/** Create a spawn-mode automation (replaces createTask) */
export async function createSpawnAutomation(
  title: string,
  description: string,
  cwd: string,
  userId?: number,
  model?: string,
  workflow?: string,
  parentId?: string,
  projectId?: string,
  roomInfo?: { roomId: string; triggeredBy: number; roomMessageId: string },
): Promise<Automation> {
  return createAutomation({
    userId: userId ?? 1,
    name: title,
    description,
    prompt: description || title,
    model,
    workflow,
    mode: 'spawn',
    cwd,
    triggerType: 'manual',
    parentId,
    projectId,
    roomId: roomInfo?.roomId,
    triggeredBy: roomInfo?.triggeredBy,
    roomMessageId: roomInfo?.roomMessageId,
  });
}
