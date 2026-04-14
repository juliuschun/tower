import { type SessionMeta } from '../../../stores/session-store';

export const PROJECT_PREVIEW_MIN = 3;
export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
export const LABEL_PREVIEW_COUNT = 5;

/** Parse date string to UTC ms (cached per string to avoid repeated parsing) */
const _tsCache = new Map<string, number>();
export function parseTs(dateStr: string): number {
  let v = _tsCache.get(dateStr);
  if (v !== undefined) return v;
  let d = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
  if (!d.endsWith('Z') && !/[+-]\d{2}(:\d{2})?$/.test(d)) d += 'Z';
  v = new Date(d).getTime();
  _tsCache.set(dateStr, v);
  if (_tsCache.size > 2000) _tsCache.clear(); // prevent unbounded growth
  return v;
}

/** Preview count: at least 3, plus any sessions updated within the last 24h */
export function getPreviewCount(sessions: SessionMeta[]): number {
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  let count = 0;
  for (const s of sessions) {
    if (parseTs(s.updatedAt) >= cutoff) count++;
  }
  return Math.max(PROJECT_PREVIEW_MIN, count);
}

/** Label display name mapping */
export function labelDisplay(label: string): { name: string } {
  const map: Record<string, string> = {
    'channel_ai': 'Channel AI',
    'temp': 'Temp',
    'task': '⚡ Tasks',
  };
  return { name: map[label] || label };
}
