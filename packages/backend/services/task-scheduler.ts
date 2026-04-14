/**
 * Task Scheduler — checks for due scheduled tasks every 30s and spawns them.
 *
 * Design: see ~/workspace/decisions/2026-03-03-kanban-scheduled-tasks-design.md
 */
import { query } from '../db/pg-repo.js';
import { updateTask } from './task-manager.js';
import { spawnTask } from './task-runner.js';

const SCHEDULER_INTERVAL = 30_000; // 30 seconds

type BroadcastFn = (type: string, data: any) => void;

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

// calculateNextRun consolidated in schedule-utils.ts
import { calculateNextRun } from './schedule-utils.js';
export { calculateNextRun };

/**
 * Single tick — find due tasks and spawn them.
 */
async function tick(broadcastFn: BroadcastFn, userId?: number, userRole?: string, allowedPath?: string) {
  try {
    const now = new Date().toISOString();
    const dueTasks = await query<any>(`
      SELECT * FROM tasks
      WHERE status = 'todo'
        AND schedule_enabled = 1
        AND scheduled_at IS NOT NULL
        AND scheduled_at <= $1
        AND (archived IS NULL OR archived = 0)
      ORDER BY scheduled_at ASC
    `, [now]);

    if (dueTasks.length === 0) return;

    console.log(`[scheduler] Found ${dueTasks.length} due task(s)`);

    for (const row of dueTasks) {
      const taskId = row.id;
      try {
        // Disable schedule before spawn to prevent re-trigger on next tick.
        // For one-time schedules, clear everything.
        // For recurring, the reset happens in task-runner after completion.
        if (!row.schedule_cron) {
          // One-time: clear schedule entirely
          await updateTask(taskId, {
            scheduledAt: null as any,
            scheduleEnabled: false,
          });
        } else {
          // Recurring: just disable until task-runner re-enables after completion
          await updateTask(taskId, { scheduleEnabled: false });
        }

        spawnTask(taskId, broadcastFn, userId, userRole, allowedPath);
        console.log(`[scheduler] Spawned task "${row.title}" (${taskId.slice(0, 8)})`);
      } catch (err: any) {
        console.error(`[scheduler] Failed to spawn task ${taskId.slice(0, 8)}:`, err.message);
        // If spawn fails (e.g. max concurrent), re-enable so next tick retries
        if (row.schedule_cron) {
          await updateTask(taskId, { scheduleEnabled: true });
        }
      }
    }
  } catch (err: any) {
    console.error('[scheduler] Tick error:', err.message);
  }
}

/**
 * Start the scheduler. Call once from index.ts after server is ready.
 */
export function startScheduler(broadcastFn: BroadcastFn): void {
  if (schedulerTimer) {
    console.warn('[scheduler] Already running');
    return;
  }

  // Run first tick immediately to catch overdue tasks from downtime
  tick(broadcastFn);

  schedulerTimer = setInterval(() => tick(broadcastFn), SCHEDULER_INTERVAL);
  console.log(`[scheduler] Started (interval=${SCHEDULER_INTERVAL / 1000}s)`);
}

/**
 * Stop the scheduler (for graceful shutdown).
 */
export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[scheduler] Stopped');
  }
}
