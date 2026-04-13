/**
 * Unified Scheduler — 30초마다 due 스케줄을 체크하고 모드별로 실행.
 *
 * 세 가지 실행 모드:
 *   - spawn:   새 태스크 생성 → 칸반 보드에 결과
 *   - inject:  기존 세션에 AI 메시지 주입 → 세션 내 대화 계속
 *   - channel: 새 proactive 세션 생성 → 채널에 요약 게시
 *
 * 기존 task-scheduler.ts를 대체한다.
 */

import { query, queryOne, execute } from '../db/pg-repo.js';
import { createTask } from './task-manager.js';
import { spawnTask } from './task-runner.js';
import { fireProactive } from './proactive-agent.js';
import { config } from '../config.js';
import { v4 as uuidv4 } from 'uuid';

// ── Types ──

export interface ScheduleEntry {
  id: string;
  userId: number;
  projectId: string | null;
  name: string;
  prompt: string;
  model: string;
  mode: 'spawn' | 'inject' | 'channel';
  targetId: string | null;
  triggerType: 'cron' | 'once';
  cronConfig: CronConfig | null;
  onceAt: string | null;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  runCount: number;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CronConfig {
  type: 'daily' | 'weekdays' | 'weekly' | 'interval';
  hour?: number;
  minute?: number;
  day?: number;   // 0=Sun..6=Sat (for 'weekly')
  hours?: number; // for 'interval'
}

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  status: string;
  mode: string;
  resultId: string | null;
  error: string | null;
  durationMs: number | null;
  ranAt: string;
}

type BroadcastFn = (type: string, data: any) => void;

// ── Constants ──

const TICK_INTERVAL = 30_000; // 30 seconds
const MAX_PER_TICK = 20;


let tickTimer: ReturnType<typeof setInterval> | null = null;
let broadcastRef: BroadcastFn | null = null;

// ── Row mapping ──

function mapRow(row: any): ScheduleEntry {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id || null,
    name: row.name,
    prompt: row.prompt,
    model: row.model || 'claude-sonnet-4-6',
    mode: row.mode || 'spawn',
    targetId: row.target_id || null,
    triggerType: row.trigger_type || 'cron',
    cronConfig: row.cron_config || null,
    onceAt: row.once_at || null,
    enabled: row.enabled ?? true,
    nextRunAt: row.next_run_at || null,
    lastRunAt: row.last_run_at || null,
    runCount: row.run_count || 0,
    lastStatus: row.last_status || null,
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Next run calculation (reused from task-scheduler) ──

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

// ── Tick ──

async function tick() {
  if (!broadcastRef) return;

  try {
    const now = new Date().toISOString();
    const dueRows = await query<any>(`
      SELECT * FROM schedules
      WHERE enabled = true
        AND next_run_at IS NOT NULL
        AND next_run_at <= $1
      ORDER BY next_run_at ASC
      LIMIT $2
    `, [now, MAX_PER_TICK]);

    if (dueRows.length === 0) return;

    console.log(`[unified-scheduler] Found ${dueRows.length} due schedule(s)`);

    for (const row of dueRows) {
      const schedule = mapRow(row);
      const startTime = Date.now();

      try {
        let resultId: string | null = null;

        switch (schedule.mode) {
          case 'spawn':
            resultId = await executeSpawn(schedule);
            break;
          case 'inject':
            resultId = await executeInject(schedule);
            break;
          case 'channel':
            resultId = await executeChannel(schedule);
            break;
          default:
            throw new Error(`Unknown schedule mode: ${schedule.mode}`);
        }

        const durationMs = Date.now() - startTime;
        await logRun(schedule.id, 'success', schedule.mode, resultId, null, durationMs);
        await advanceSchedule(schedule, 'success', null);

        console.log(`[unified-scheduler] ✓ ${schedule.mode} "${schedule.name}" (${durationMs}ms)`);

      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        await logRun(schedule.id, 'failed', schedule.mode, null, err.message, durationMs);
        await advanceSchedule(schedule, 'failed', err.message);

        console.error(`[unified-scheduler] ✗ ${schedule.mode} "${schedule.name}":`, err.message);
      }
    }
  } catch (err: any) {
    console.error('[unified-scheduler] Tick error:', err.message);
  }
}

// ── Also handle legacy tasks (backward compat during transition) ──

async function tickLegacyTasks() {
  if (!broadcastRef) return;

  try {
    const now = new Date().toISOString();
    const dueTasks = await query<any>(`
      SELECT * FROM tasks
      WHERE status = 'todo'
        AND schedule_enabled = 1
        AND scheduled_at IS NOT NULL
        AND scheduled_at <= $1
        AND (archived IS NULL OR archived = 0)
        AND id NOT IN (SELECT COALESCE(target_id, '') FROM schedules WHERE mode = 'spawn')
      ORDER BY scheduled_at ASC
    `, [now]);

    for (const row of dueTasks) {
      try {
        if (!row.schedule_cron) {
          await execute(`UPDATE tasks SET scheduled_at = NULL, schedule_enabled = 0 WHERE id = $1`, [row.id]);
        } else {
          await execute(`UPDATE tasks SET schedule_enabled = 0 WHERE id = $1`, [row.id]);
        }
        spawnTask(row.id, broadcastRef, row.user_id);
        console.log(`[unified-scheduler] Legacy task spawned: "${row.title}"`);
      } catch (err: any) {
        console.error(`[unified-scheduler] Legacy task error: ${err.message}`);
        if (row.schedule_cron) {
          await execute(`UPDATE tasks SET schedule_enabled = 1 WHERE id = $1`, [row.id]);
        }
      }
    }
  } catch {
    // silent
  }
}

// ── Mode executors ──

async function executeSpawn(schedule: ScheduleEntry): Promise<string> {
  const cwd = schedule.projectId
    ? `${config.workspaceRoot}/projects/${schedule.projectId}`
    : config.workspaceRoot;

  const task = await createTask(
    schedule.name,
    schedule.prompt,
    cwd,
    schedule.userId,
    schedule.model,
    undefined, // no schedule on task itself
    'auto',
    undefined,
    schedule.projectId || undefined,
  );

  spawnTask(task.id, broadcastRef!, schedule.userId);
  return task.id;
}

async function executeInject(schedule: ScheduleEntry): Promise<string> {
  if (!schedule.targetId) {
    throw new Error('inject mode requires target_id (session_id)');
  }

  const result = await fireProactive(
    schedule.userId,
    {
      id: `schedule-${schedule.id}`,
      name: schedule.name,
      prompt: schedule.prompt,
      model: schedule.model,
      projectId: schedule.projectId || undefined,
    },
    {
      summary: `스케줄 실행: ${schedule.name}`,
      triggerMeta: { scheduleId: schedule.id },
    },
    { targetSessionId: schedule.targetId },
  );

  return result.sessionId;
}

async function executeChannel(schedule: ScheduleEntry): Promise<string> {
  if (!schedule.targetId) {
    throw new Error('channel mode requires target_id (room_id)');
  }

  const result = await fireProactive(
    schedule.userId,
    {
      id: `schedule-${schedule.id}`,
      name: schedule.name,
      prompt: schedule.prompt,
      model: schedule.model,
      projectId: schedule.projectId || undefined,
    },
    {
      summary: `채널 스케줄: ${schedule.name}`,
      triggerMeta: { scheduleId: schedule.id, roomId: schedule.targetId },
    },
  );

  // TODO: Phase 2 — post summary to room as ai message

  return result.sessionId;
}

// ── Schedule advancement ──

async function advanceSchedule(schedule: ScheduleEntry, status: string, error: string | null) {
  if (schedule.triggerType === 'once') {
    await execute(`
      UPDATE schedules
      SET enabled = false, last_run_at = NOW(), run_count = run_count + 1,
          last_status = $1, last_error = $2, updated_at = NOW()
      WHERE id = $3
    `, [status, error, schedule.id]);
  } else if (schedule.triggerType === 'cron' && schedule.cronConfig) {
    const nextRun = calculateNextRun(schedule.cronConfig);
    await execute(`
      UPDATE schedules
      SET next_run_at = $1, last_run_at = NOW(), run_count = run_count + 1,
          last_status = $2, last_error = $3, updated_at = NOW()
      WHERE id = $4
    `, [nextRun.toISOString(), status, error, schedule.id]);
  }
}

// ── Run logging ──

async function logRun(
  scheduleId: string,
  status: string,
  mode: string,
  resultId: string | null,
  error: string | null,
  durationMs: number,
) {
  await execute(`
    INSERT INTO schedule_runs (id, schedule_id, status, mode, result_id, error, duration_ms)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [uuidv4(), scheduleId, status, mode, resultId, error, durationMs]);
}

// ── CRUD ──

export async function getSchedules(userId: number): Promise<ScheduleEntry[]> {
  const rows = await query<any>(
    'SELECT * FROM schedules WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );
  return rows.map(mapRow);
}

export async function getSchedule(id: string): Promise<ScheduleEntry | null> {
  const row = await queryOne<any>('SELECT * FROM schedules WHERE id = $1', [id]);
  return row ? mapRow(row) : null;
}

export async function createSchedule(data: {
  userId: number;
  projectId?: string;
  name: string;
  prompt: string;
  model?: string;
  mode: 'spawn' | 'inject' | 'channel';
  targetId?: string;
  triggerType: 'cron' | 'once';
  cronConfig?: CronConfig;
  onceAt?: string;
}): Promise<ScheduleEntry> {
  const id = uuidv4();

  // Calculate initial next_run_at
  let nextRunAt: string | null = null;
  if (data.triggerType === 'once' && data.onceAt) {
    nextRunAt = new Date(data.onceAt).toISOString();
  } else if (data.triggerType === 'cron' && data.cronConfig) {
    nextRunAt = calculateNextRun(data.cronConfig).toISOString();
  }

  await execute(`
    INSERT INTO schedules (id, user_id, project_id, name, prompt, model, mode, target_id, trigger_type, cron_config, once_at, next_run_at, enabled)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
  `, [
    id,
    data.userId,
    data.projectId || null,
    data.name,
    data.prompt,
    data.model || 'claude-sonnet-4-6',
    data.mode,
    data.targetId || null,
    data.triggerType,
    data.cronConfig ? JSON.stringify(data.cronConfig) : null,
    data.onceAt || null,
    nextRunAt,
  ]);

  return (await getSchedule(id))!;
}

export async function updateSchedule(id: string, updates: Partial<{
  name: string;
  prompt: string;
  model: string;
  mode: 'spawn' | 'inject' | 'channel';
  targetId: string | null;
  triggerType: 'cron' | 'once';
  cronConfig: CronConfig | null;
  onceAt: string | null;
  enabled: boolean;
}>): Promise<ScheduleEntry | null> {
  const existing = await getSchedule(id);
  if (!existing) return null;

  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  const addField = (field: string, val: any) => {
    sets.push(`${field} = $${idx}`);
    values.push(val);
    idx++;
  };

  if (updates.name !== undefined) addField('name', updates.name);
  if (updates.prompt !== undefined) addField('prompt', updates.prompt);
  if (updates.model !== undefined) addField('model', updates.model);
  if (updates.mode !== undefined) addField('mode', updates.mode);
  if (updates.targetId !== undefined) addField('target_id', updates.targetId);
  if (updates.triggerType !== undefined) addField('trigger_type', updates.triggerType);
  if (updates.cronConfig !== undefined) addField('cron_config', updates.cronConfig ? JSON.stringify(updates.cronConfig) : null);
  if (updates.onceAt !== undefined) addField('once_at', updates.onceAt);
  if (updates.enabled !== undefined) addField('enabled', updates.enabled);

  // Recalculate next_run_at if schedule parameters changed
  const triggerType = updates.triggerType ?? existing.triggerType;
  const cronConfig = updates.cronConfig !== undefined ? updates.cronConfig : existing.cronConfig;
  const onceAt = updates.onceAt !== undefined ? updates.onceAt : existing.onceAt;
  const enabled = updates.enabled ?? existing.enabled;

  if (enabled) {
    let nextRunAt: string | null = null;
    if (triggerType === 'once' && onceAt) {
      nextRunAt = new Date(onceAt).toISOString();
    } else if (triggerType === 'cron' && cronConfig) {
      nextRunAt = calculateNextRun(cronConfig).toISOString();
    }
    addField('next_run_at', nextRunAt);
  } else {
    addField('next_run_at', null);
  }

  addField('updated_at', new Date().toISOString());

  if (sets.length === 0) return existing;

  values.push(id);
  await execute(`UPDATE schedules SET ${sets.join(', ')} WHERE id = $${idx}`, values);

  return getSchedule(id);
}

export async function deleteSchedule(id: string): Promise<boolean> {
  await execute('DELETE FROM schedules WHERE id = $1', [id]);
  return true;
}

export async function getScheduleRuns(scheduleId: string, limit = 20): Promise<ScheduleRun[]> {
  const rows = await query<any>(
    'SELECT * FROM schedule_runs WHERE schedule_id = $1 ORDER BY ran_at DESC LIMIT $2',
    [scheduleId, limit],
  );
  return rows.map((r: any) => ({
    id: r.id,
    scheduleId: r.schedule_id,
    status: r.status,
    mode: r.mode,
    resultId: r.result_id,
    error: r.error,
    durationMs: r.duration_ms,
    ranAt: r.ran_at,
  }));
}

/** Run a schedule immediately (for testing / manual trigger) */
export async function runScheduleNow(id: string): Promise<{ resultId: string | null; status: string }> {
  const schedule = await getSchedule(id);
  if (!schedule) throw new Error('Schedule not found');
  if (!broadcastRef) throw new Error('Scheduler not initialized');

  const startTime = Date.now();

  try {
    let resultId: string | null = null;

    switch (schedule.mode) {
      case 'spawn':
        resultId = await executeSpawn(schedule);
        break;
      case 'inject':
        resultId = await executeInject(schedule);
        break;
      case 'channel':
        resultId = await executeChannel(schedule);
        break;
    }

    const durationMs = Date.now() - startTime;
    await logRun(id, 'success', schedule.mode, resultId, null, durationMs);

    // Update last_run but don't advance next_run (manual run doesn't affect schedule)
    await execute(`
      UPDATE schedules SET last_run_at = NOW(), run_count = run_count + 1,
        last_status = 'success', last_error = NULL, updated_at = NOW()
      WHERE id = $1
    `, [id]);

    return { resultId, status: 'success' };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    await logRun(id, 'failed', schedule.mode, null, err.message, durationMs);

    await execute(`
      UPDATE schedules SET last_run_at = NOW(), run_count = run_count + 1,
        last_status = 'failed', last_error = $1, updated_at = NOW()
      WHERE id = $2
    `, [err.message, id]);

    throw err;
  }
}

// ── Lifecycle ──

export function startUnifiedScheduler(broadcast: BroadcastFn): void {
  if (tickTimer) {
    console.warn('[unified-scheduler] Already running');
    return;
  }

  broadcastRef = broadcast;

  // Run first tick immediately
  tick();
  tickLegacyTasks();

  tickTimer = setInterval(() => {
    tick();
    tickLegacyTasks();
  }, TICK_INTERVAL);

  console.log(`[unified-scheduler] Started (interval=${TICK_INTERVAL / 1000}s)`);
}

export function stopUnifiedScheduler(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
    broadcastRef = null;
    console.log('[unified-scheduler] Stopped');
  }
}
