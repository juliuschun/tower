export type JsonResult =
  | { ok: true; data: any }
  | { ok: false; error: string };

/**
 * Safely convert any value to a renderable string.
 * Prevents React error #31 ("Objects are not valid as a React child")
 * when AI-generated JSON contains unexpected nested objects.
 */
export function safeStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

export function parseLooseJson(raw: string): JsonResult {
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch {
    const cleaned = raw
      .replace(/,\s*([\]}])/g, '$1')
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/'/g, '"');
    try {
      return { ok: true, data: JSON.parse(cleaned) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Invalid JSON' };
    }
  }
}
