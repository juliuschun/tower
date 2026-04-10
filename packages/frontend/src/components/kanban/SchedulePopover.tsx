import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface SchedulePopoverProps {
  taskId: string;
  currentScheduledAt: string | null;
  currentScheduleCron: string | null;
  currentScheduleEnabled: boolean;
  onSave: (schedule: {
    scheduledAt: string | null;
    scheduleCron: string | null;
    scheduleEnabled: boolean;
  }) => void;
  onClose: () => void;
}

interface CronConfig {
  type: 'daily' | 'weekdays' | 'weekly' | 'interval';
  hour: number;
  minute: number;
  day: number;
  hours: number;
}

function parseCron(json: string | null): CronConfig | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function formatLocalDatetime(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
}

export function SchedulePopover({
  taskId,
  currentScheduledAt,
  currentScheduleCron,
  currentScheduleEnabled,
  onSave,
  onClose,
}: SchedulePopoverProps) {
  const { t } = useTranslation('kanban');
  const popoverRef = useRef<HTMLDivElement>(null);

  // Parse existing schedule
  const existingCron = parseCron(currentScheduleCron);
  const existingDate = currentScheduledAt ? new Date(currentScheduledAt) : null;

  // State
  const [datetime, setDatetime] = useState(
    existingDate ? formatLocalDatetime(existingDate) : formatLocalDatetime(new Date(Date.now() + 3600_000))
  );
  const [isRecurring, setIsRecurring] = useState(!!existingCron);
  const [cronType, setCronType] = useState<CronConfig['type']>(existingCron?.type || 'daily');
  const [cronHour, setCronHour] = useState(existingCron?.hour ?? 9);
  const [cronMinute, setCronMinute] = useState(existingCron?.minute ?? 0);
  const [cronDay, setCronDay] = useState(existingCron?.day ?? 1);
  const [cronHours, setCronHours] = useState(existingCron?.hours ?? 3);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleQuick = (offsetMs: number) => {
    const dt = new Date(Date.now() + offsetMs);
    setDatetime(formatLocalDatetime(dt));
    setIsRecurring(false);
  };

  const handleTomorrow = (hour: number) => {
    const dt = new Date();
    dt.setDate(dt.getDate() + 1);
    dt.setHours(hour, 0, 0, 0);
    setDatetime(formatLocalDatetime(dt));
    setIsRecurring(false);
  };

  const handleSave = () => {
    if (isRecurring) {
      const cron: any = { type: cronType };
      if (cronType === 'interval') {
        cron.hours = cronHours;
      } else {
        cron.hour = cronHour;
        cron.minute = cronMinute;
        if (cronType === 'weekly') cron.day = cronDay;
      }
      // Calculate first run from cron
      const firstRun = calculateNextRunLocal(cron);
      onSave({
        scheduledAt: firstRun.toISOString(),
        scheduleCron: JSON.stringify(cron),
        scheduleEnabled: true,
      });
    } else {
      const scheduledAt = new Date(datetime).toISOString();
      onSave({
        scheduledAt,
        scheduleCron: null,
        scheduleEnabled: true,
      });
    }
  };

  const handleClear = () => {
    onSave({
      scheduledAt: null,
      scheduleCron: null,
      scheduleEnabled: false,
    });
  };

  return (
    <div
      ref={popoverRef}
      className="relative z-50 bg-surface-800 border border-surface-600 rounded-lg shadow-xl p-3 w-72"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-xs font-semibold text-gray-300 mb-2">{t('scheduleTask')}</div>

      {/* Quick presets */}
      <div className="flex flex-wrap gap-1 mb-2">
        {[
          { label: '1h', ms: 3600_000 },
          { label: '3h', ms: 3 * 3600_000 },
          { label: '6h', ms: 6 * 3600_000 },
        ].map((q) => (
          <button
            key={q.label}
            onClick={() => handleQuick(q.ms)}
            className="px-2 py-0.5 text-[10px] bg-surface-700 hover:bg-surface-600 text-gray-300 rounded transition-colors"
          >
            {q.label}
          </button>
        ))}
        <button
          onClick={() => handleTomorrow(9)}
          className="px-2 py-0.5 text-[10px] bg-surface-700 hover:bg-surface-600 text-gray-300 rounded transition-colors"
        >
          {t('tomorrowMorning')}
        </button>
        <button
          onClick={() => handleTomorrow(14)}
          className="px-2 py-0.5 text-[10px] bg-surface-700 hover:bg-surface-600 text-gray-300 rounded transition-colors"
        >
          {t('tomorrowAfternoon')}
        </button>
      </div>

      {/* Date/time picker */}
      <div className="mb-2">
        <div className="text-[10px] text-gray-500 mb-1">{t('orPickDateTime')}</div>
        <input
          type="datetime-local"
          value={datetime}
          onChange={(e) => setDatetime(e.target.value)}
          className="w-full px-2 py-1 text-xs bg-surface-900 border border-surface-600 rounded text-gray-200 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Recurring toggle */}
      <div className="border-t border-surface-700 pt-2 mb-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isRecurring}
            onChange={(e) => setIsRecurring(e.target.checked)}
            className="w-3 h-3 rounded border-surface-600 bg-surface-900 text-blue-500 focus:ring-0 focus:ring-offset-0"
          />
          <span className="text-xs text-gray-300">{t('repeat')}</span>
        </label>
      </div>

      {/* Recurring config */}
      {isRecurring && (
        <div className="bg-surface-900 rounded p-2 mb-2 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 w-10">{t('every')}</span>
            <select
              value={cronType}
              onChange={(e) => setCronType(e.target.value as CronConfig['type'])}
              className="flex-1 px-2 py-0.5 text-xs bg-surface-800 border border-surface-600 rounded text-gray-200 focus:outline-none"
            >
              <option value="daily">{t('daily')}</option>
              <option value="weekdays">{t('weekdays')}</option>
              <option value="weekly">{t('weekly')}</option>
              <option value="interval">{t('everyNHours')}</option>
            </select>
          </div>

          {cronType === 'weekly' && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 w-10">{t('day')}</span>
              <select
                value={cronDay}
                onChange={(e) => setCronDay(parseInt(e.target.value))}
                className="flex-1 px-2 py-0.5 text-xs bg-surface-800 border border-surface-600 rounded text-gray-200 focus:outline-none"
              >
                <option value={0}>Sunday</option>
                <option value={1}>Monday</option>
                <option value={2}>Tuesday</option>
                <option value={3}>Wednesday</option>
                <option value={4}>Thursday</option>
                <option value={5}>Friday</option>
                <option value={6}>Saturday</option>
              </select>
            </div>
          )}

          {cronType === 'interval' ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 w-10">{t('hours')}</span>
              <input
                type="number"
                min={1}
                max={168}
                value={cronHours}
                onChange={(e) => setCronHours(parseInt(e.target.value) || 1)}
                className="w-16 px-2 py-0.5 text-xs bg-surface-800 border border-surface-600 rounded text-gray-200 focus:outline-none"
              />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 w-10">{t('at')}</span>
              <input
                type="time"
                value={`${String(cronHour).padStart(2, '0')}:${String(cronMinute).padStart(2, '0')}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map(Number);
                  setCronHour(h);
                  setCronMinute(m);
                }}
                className="flex-1 px-2 py-0.5 text-xs bg-surface-800 border border-surface-600 rounded text-gray-200 focus:outline-none"
              />
            </div>
          )}
        </div>
      )}

      {/* Buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleClear}
          className="px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200 transition-colors"
        >
          {t('clear')}
        </button>
        <div className="flex gap-1.5">
          <button
            onClick={onClose}
            className="px-2.5 py-1 text-[10px] bg-surface-700 hover:bg-surface-600 text-gray-300 rounded transition-colors"
          >
            {t('common:cancel')}
          </button>
          <button
            onClick={handleSave}
            className="px-2.5 py-1 text-[10px] bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          >
            {t('common:save')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Client-side next-run calculator (mirrors backend calculateNextRun).
 */
function calculateNextRunLocal(cron: any): Date {
  const now = new Date();
  const next = new Date(now);

  switch (cron.type) {
    case 'daily':
      next.setHours(cron.hour ?? 9, cron.minute ?? 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next;

    case 'weekdays':
      next.setHours(cron.hour ?? 9, cron.minute ?? 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      while (next.getDay() === 0 || next.getDay() === 6) {
        next.setDate(next.getDate() + 1);
      }
      return next;

    case 'weekly': {
      const targetDay = cron.day ?? 1;
      next.setHours(cron.hour ?? 9, cron.minute ?? 0, 0, 0);
      let daysUntil = targetDay - next.getDay();
      if (daysUntil < 0) daysUntil += 7;
      if (daysUntil === 0 && next <= now) daysUntil = 7;
      next.setDate(next.getDate() + daysUntil);
      return next;
    }

    case 'interval':
      return new Date(now.getTime() + (cron.hours ?? 1) * 60 * 60 * 1000);

    default:
      return new Date(now.getTime() + 3600_000);
  }
}
