export type JsonResult =
  | { ok: true; data: any }
  | { ok: false; error: string };

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
