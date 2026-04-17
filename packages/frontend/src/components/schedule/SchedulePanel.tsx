/**
 * SchedulePanel — 통합 스케줄 관리 UI.
 *
 * 스케줄 목록, 생성/수정, 실행 로그를 한 화면에서 관리한다.
 * activeView = 'schedules' 일 때 표시.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScheduleEntry, ScheduleRun } from '@tower/shared';

const API_BASE = '/api';

// ── Helpers ──

function modeIcon(mode: string) {
  switch (mode) {
    case 'spawn': return '🚀';
    case 'inject': return '💬';
    case 'channel': return '📢';
    default: return '⏰';
  }
}

function modeLabel(mode: string, t: (k: string) => string) {
  switch (mode) {
    case 'spawn': return t('modeSpawn');
    case 'inject': return t('modeInject');
    case 'channel': return t('modeChannel');
    default: return mode;
  }
}

function triggerLabel(s: ScheduleEntry, t: (k: string) => string) {
  if (s.triggerType === 'once') {
    return s.onceAt ? new Date(s.onceAt).toLocaleString() : t('once');
  }
  if (!s.cronConfig) return t('cron');
  const c = s.cronConfig;
  const time = `${String(c.hour ?? 9).padStart(2, '0')}:${String(c.minute ?? 0).padStart(2, '0')}`;
  switch (c.type) {
    case 'daily': return `${t('daily')} ${time}`;
    case 'weekdays': return `${t('weekdays')} ${time}`;
    case 'weekly': {
      const days = [t('sun'), t('mon'), t('tue'), t('wed'), t('thu'), t('fri'), t('sat')];
      return `${t('every')} ${days[c.day ?? 1]} ${time}`;
    }
    case 'interval': return `${t('every')} ${c.hours ?? 1}${t('hours')}`;
    default: return t('cron');
  }
}

function statusDot(s: ScheduleEntry) {
  if (!s.enabled) return 'bg-gray-600';
  if (s.lastStatus === 'failed') return 'bg-red-500';
  if (s.lastStatus === 'success') return 'bg-green-500';
  return 'bg-yellow-500'; // pending / never run
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── API ──

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

// ── Component ──

export function SchedulePanel() {
  const { t } = useTranslation('schedule');
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);

  const loadSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchJson<ScheduleEntry[]>(`${API_BASE}/schedules`);
      setSchedules(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await fetchJson(`${API_BASE}/schedules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !enabled }),
      });
      loadSchedules();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('confirmDelete'))) return;
    try {
      await fetchJson(`${API_BASE}/schedules/${id}`, { method: 'DELETE' });
      loadSchedules();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRunNow = async (id: string) => {
    try {
      setError(null);
      await fetchJson(`${API_BASE}/schedules/${id}/run-now`, { method: 'POST' });
      loadSchedules();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    try {
      const data = await fetchJson<ScheduleRun[]>(`${API_BASE}/schedules/${id}/runs?limit=10`);
      setRuns(data);
    } catch {
      setRuns([]);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800">
        <div className="flex items-center gap-2">
          <span className="text-lg">⏰</span>
          <h1 className="text-sm font-bold text-gray-100">{t('title')}</h1>
          <span className="text-[10px] text-surface-500">({schedules.length})</span>
        </div>
        <button
          onClick={() => { setShowCreate(true); setEditingId(null); }}
          className="px-3 py-1.5 text-[11px] font-medium bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition-colors"
        >
          + {t('newSchedule')}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-2 px-3 py-1.5 text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="text-center text-surface-500 text-xs py-8">{t('loading')}</div>
        ) : schedules.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-3xl mb-3">⏰</div>
            <p className="text-sm text-surface-400">{t('empty')}</p>
            <p className="text-[10px] text-surface-600 mt-1">{t('emptyHint')}</p>
          </div>
        ) : (
          schedules.map((s) => (
            <div key={s.id} className="bg-surface-850 border border-surface-750 rounded-lg overflow-hidden">
              {/* Schedule row */}
              <div className="flex items-center gap-3 px-3 py-2.5">
                {/* Status dot */}
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(s)}`} />

                {/* Name + trigger */}
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => handleExpand(s.id)}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-gray-200 truncate">{s.name}</span>
                    <span className="text-[10px] text-surface-500">{modeIcon(s.mode)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-surface-500">{triggerLabel(s, t)}</span>
                    <span className="text-[10px] text-surface-600">·</span>
                    <span className="text-[10px] text-surface-500">{modeLabel(s.mode, t)}</span>
                    {s.lastRunAt && (
                      <>
                        <span className="text-[10px] text-surface-600">·</span>
                        <span className="text-[10px] text-surface-600">
                          {s.lastStatus === 'success' ? '✓' : s.lastStatus === 'failed' ? '✗' : '·'}{' '}
                          {relativeTime(s.lastRunAt)}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleRunNow(s.id)}
                    title={t('runNow')}
                    className="p-1 text-surface-500 hover:text-primary-400 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => { setEditingId(s.id); setShowCreate(true); }}
                    title={t('edit')}
                    className="p-1 text-surface-500 hover:text-primary-400 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleToggle(s.id, s.enabled)}
                    title={s.enabled ? t('disable') : t('enable')}
                    className={`p-1 transition-colors ${s.enabled ? 'text-green-500 hover:text-yellow-400' : 'text-surface-600 hover:text-green-400'}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      {s.enabled ? (
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      ) : (
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      )}
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    title={t('delete')}
                    className="p-1 text-surface-600 hover:text-red-400 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Expanded: run log */}
              {expandedId === s.id && (
                <div className="border-t border-surface-750 px-3 py-2 bg-surface-900/50">
                  <div className="text-[10px] font-semibold text-surface-500 mb-1.5">{t('runLog')}</div>
                  {runs.length === 0 ? (
                    <div className="text-[10px] text-surface-600 py-1">{t('noRuns')}</div>
                  ) : (
                    <div className="space-y-1">
                      {runs.map((r) => (
                        <div key={r.id} className="flex items-center gap-2 text-[10px]">
                          <span className={r.status === 'success' ? 'text-green-500' : 'text-red-400'}>
                            {r.status === 'success' ? '✓' : '✗'}
                          </span>
                          <span className="text-surface-500">{new Date(r.ranAt).toLocaleString()}</span>
                          <span className="text-surface-600">{r.mode}</span>
                          {r.durationMs != null && (
                            <span className="text-surface-600">{r.durationMs < 1000 ? `${r.durationMs}ms` : `${(r.durationMs / 1000).toFixed(1)}s`}</span>
                          )}
                          {r.error && <span className="text-red-400 truncate max-w-[200px]">{r.error}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Prompt preview */}
                  <div className="mt-2 pt-2 border-t border-surface-800">
                    <div className="text-[10px] font-semibold text-surface-500 mb-1">{t('prompt')}</div>
                    <div className="text-[10px] text-surface-400 whitespace-pre-wrap max-h-20 overflow-y-auto">
                      {s.prompt}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Create/Edit Modal */}
      {showCreate && (
        <ScheduleFormModal
          editId={editingId}
          schedules={schedules}
          onClose={() => { setShowCreate(false); setEditingId(null); }}
          onSaved={() => { setShowCreate(false); setEditingId(null); loadSchedules(); }}
        />
      )}
    </div>
  );
}

// ── Form Modal ──

function ScheduleFormModal({
  editId,
  schedules,
  onClose,
  onSaved,
}: {
  editId: string | null;
  schedules: ScheduleEntry[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation('schedule');
  const existing = editId ? schedules.find((s) => s.id === editId) : null;

  const [name, setName] = useState(existing?.name || '');
  const [prompt, setPrompt] = useState(existing?.prompt || '');
  const [model, setModel] = useState(existing?.model || 'claude-sonnet-4-6');
  const [mode, setMode] = useState<'spawn' | 'inject' | 'channel'>(existing?.mode || 'spawn');
  const [targetId, setTargetId] = useState(existing?.targetId || '');
  const [triggerType, setTriggerType] = useState<'cron' | 'once'>(existing?.triggerType || 'cron');
  const [cronType, setCronType] = useState(existing?.cronConfig?.type || 'daily');
  const [cronHour, setCronHour] = useState(existing?.cronConfig?.hour ?? 9);
  const [cronMinute, setCronMinute] = useState(existing?.cronConfig?.minute ?? 0);
  const [cronDay, setCronDay] = useState(existing?.cronConfig?.day ?? 1);
  const [cronHours, setCronHours] = useState(existing?.cronConfig?.hours ?? 3);
  const [onceAt, setOnceAt] = useState(() => {
    if (existing?.onceAt) return formatLocal(new Date(existing.onceAt));
    const d = new Date(Date.now() + 3600_000);
    return formatLocal(d);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function formatLocal(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  const handleSave = async () => {
    if (!name.trim() || !prompt.trim()) {
      setError(t('namePromptRequired'));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const cronConfig = triggerType === 'cron' ? {
        type: cronType as any,
        ...(cronType === 'interval' ? { hours: cronHours } : { hour: cronHour, minute: cronMinute }),
        ...(cronType === 'weekly' ? { day: cronDay } : {}),
      } : undefined;

      const body: any = {
        name: name.trim(),
        prompt: prompt.trim(),
        model,
        mode,
        targetId: (mode === 'inject' || mode === 'channel') ? targetId : undefined,
        triggerType,
        cronConfig,
        onceAt: triggerType === 'once' ? new Date(onceAt).toISOString() : undefined,
      };

      if (editId) {
        await fetchJson(`${API_BASE}/schedules/${editId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await fetchJson(`${API_BASE}/schedules`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }

      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-[calc(100vw-32px)] max-w-[420px] max-h-[85vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-800">
          <h2 className="text-sm font-bold text-gray-100">
            {editId ? t('editSchedule') : t('newSchedule')}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-300">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="px-3 py-1.5 text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-[11px] font-medium text-surface-400 mb-1">{t('name')}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              className="w-full px-3 py-2 text-xs bg-surface-800 border border-surface-700 rounded-lg text-gray-200 focus:outline-none focus:border-primary-500"
            />
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-[11px] font-medium text-surface-400 mb-1">{t('prompt')}</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('promptPlaceholder')}
              rows={3}
              className="w-full px-3 py-2 text-xs bg-surface-800 border border-surface-700 rounded-lg text-gray-200 focus:outline-none focus:border-primary-500 resize-none"
            />
          </div>

          {/* Model */}
          <div>
            <label className="block text-[11px] font-medium text-surface-400 mb-1">{t('model')}</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-surface-800 border border-surface-700 rounded-lg text-gray-200 focus:outline-none"
            >
              <option value="claude-opus-4-7">Opus 4.7</option>
              <option value="claude-sonnet-4-6">Sonnet</option>
              <option value="claude-haiku-4-5-20251001">Haiku</option>
            </select>
          </div>

          {/* Mode */}
          <div>
            <label className="block text-[11px] font-medium text-surface-400 mb-1.5">{t('executionMode')}</label>
            <div className="flex gap-2">
              {(['spawn', 'inject', 'channel'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 py-2 text-[11px] font-medium rounded-lg border transition-all flex flex-col items-center gap-0.5 ${
                    mode === m
                      ? 'bg-surface-800 border-primary-500 text-primary-400'
                      : 'bg-surface-900 border-surface-700 text-surface-500 hover:border-surface-600'
                  }`}
                >
                  <span>{modeIcon(m)}</span>
                  <span>{modeLabel(m, t)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Target ID (for inject/channel) */}
          {(mode === 'inject' || mode === 'channel') && (
            <div>
              <label className="block text-[11px] font-medium text-surface-400 mb-1">
                {mode === 'inject' ? t('targetSession') : t('targetChannel')}
              </label>
              <input
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder={mode === 'inject' ? t('sessionIdPlaceholder') : t('channelIdPlaceholder')}
                className="w-full px-3 py-2 text-xs bg-surface-800 border border-surface-700 rounded-lg text-gray-200 focus:outline-none focus:border-primary-500"
              />
            </div>
          )}

          {/* Trigger */}
          <div>
            <label className="block text-[11px] font-medium text-surface-400 mb-1.5">{t('schedule')}</label>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setTriggerType('cron')}
                className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg border transition-all ${
                  triggerType === 'cron'
                    ? 'bg-surface-800 border-primary-500 text-primary-400'
                    : 'bg-surface-900 border-surface-700 text-surface-500 hover:border-surface-600'
                }`}
              >
                {t('recurring')}
              </button>
              <button
                onClick={() => setTriggerType('once')}
                className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg border transition-all ${
                  triggerType === 'once'
                    ? 'bg-surface-800 border-primary-500 text-primary-400'
                    : 'bg-surface-900 border-surface-700 text-surface-500 hover:border-surface-600'
                }`}
              >
                {t('once')}
              </button>
            </div>

            {triggerType === 'cron' ? (
              <div className="bg-surface-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-surface-500 w-10">{t('every')}</span>
                  <select
                    value={cronType}
                    onChange={(e) => setCronType(e.target.value as 'daily' | 'weekdays' | 'weekly' | 'interval')}
                    className="flex-1 px-2 py-1 text-xs bg-surface-900 border border-surface-700 rounded text-gray-200 focus:outline-none"
                  >
                    <option value="daily">{t('daily')}</option>
                    <option value="weekdays">{t('weekdays')}</option>
                    <option value="weekly">{t('weekly')}</option>
                    <option value="interval">{t('everyNHours')}</option>
                  </select>
                </div>
                {cronType === 'weekly' && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-surface-500 w-10">{t('day')}</span>
                    <select
                      value={cronDay}
                      onChange={(e) => setCronDay(parseInt(e.target.value))}
                      className="flex-1 px-2 py-1 text-xs bg-surface-900 border border-surface-700 rounded text-gray-200 focus:outline-none"
                    >
                      {[t('sun'), t('mon'), t('tue'), t('wed'), t('thu'), t('fri'), t('sat')].map((d, i) => (
                        <option key={i} value={i}>{d}</option>
                      ))}
                    </select>
                  </div>
                )}
                {cronType === 'interval' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-surface-500 w-10">{t('hours')}</span>
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={cronHours}
                      onChange={(e) => setCronHours(parseInt(e.target.value) || 1)}
                      className="w-16 px-2 py-1 text-xs bg-surface-900 border border-surface-700 rounded text-gray-200 focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-surface-500 w-10">{t('at')}</span>
                    <input
                      type="time"
                      value={`${String(cronHour).padStart(2, '0')}:${String(cronMinute).padStart(2, '0')}`}
                      onChange={(e) => {
                        const [h, m] = e.target.value.split(':').map(Number);
                        setCronHour(h);
                        setCronMinute(m);
                      }}
                      className="flex-1 px-2 py-1 text-xs bg-surface-900 border border-surface-700 rounded text-gray-200 focus:outline-none"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div>
                <input
                  type="datetime-local"
                  value={onceAt}
                  onChange={(e) => setOnceAt(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-surface-800 border border-surface-700 rounded-lg text-gray-200 focus:outline-none focus:border-primary-500"
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-800">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[11px] bg-surface-800 hover:bg-surface-700 text-gray-300 rounded-lg transition-colors"
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-[11px] font-medium bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? '...' : editId ? t('save') : t('create')}
          </button>
        </div>
      </div>
    </div>
  );
}
