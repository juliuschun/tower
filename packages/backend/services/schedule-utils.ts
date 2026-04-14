/**
 * schedule-utils.ts — Shared scheduling utilities.
 *
 * Extracted to break the circular dependency:
 *   task-runner → unified-scheduler → task-runner
 *
 * Now both import calculateNextRun from here instead.
 */

export interface CronConfig {
  type: 'daily' | 'weekdays' | 'weekly' | 'interval';
  hour?: number;
  minute?: number;
  day?: number;   // 0=Sun..6=Sat (for 'weekly')
  hours?: number; // for 'interval'
}

/**
 * Calculate the next run time for a cron-like schedule.
 */
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
