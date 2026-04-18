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

/**
 * Single-pass cleanup that respects string boundaries — it never modifies
 * the contents of a quoted string. Handles:
 *   - JSON5-style `'...'` strings → `"..."` (bare `"` inside get escaped)
 *   - `//` and `/* block *\/` comments → stripped
 *   - trailing commas before `]` / `}` → stripped
 *
 * Previously a blind `.replace(/'/g, '"')` corrupted strings containing
 * apostrophes (e.g. "'덱'이" → ""덱""이" → parser dies mid-string).
 */
function cleanLoose(raw: string): string {
  let out = '';
  let delim: '"' | "'" | null = null;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (delim) {
      if (escape) { out += c; escape = false; continue; }
      if (c === '\\') { out += c; escape = true; continue; }
      if (c === delim) { delim = null; out += '"'; continue; }
      if (c === '"') { out += '\\"'; continue; }
      out += c;
      continue;
    }
    if (c === '"' || c === "'") { delim = c; out += '"'; continue; }
    if (c === '/' && raw[i + 1] === '/') {
      while (i < raw.length && raw[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && raw[i + 1] === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i += 1; // skip '/'
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j++;
      if (raw[j] === ']' || raw[j] === '}') continue; // drop trailing comma
    }
    out += c;
  }
  return out;
}

/**
 * Repair mismatched / missing closers. Handles the common LLM mistake of
 * closing the outer `{` before closing the inner `[`:
 *
 *   { "steps": [ {...}, {...} }   →   { "steps": [ {...}, {...} ] }
 *
 * Strategy: walk tokens string-aware with a bracket stack. When a closer
 * doesn't match the stack top, emit the missing closer first, then the
 * intended one. Any still-open brackets are closed at EOF.
 */
function autoCloseBrackets(s: string): string {
  let out = '';
  const stack: Array<'{' | '['> = [];
  let delim: '"' | "'" | null = null;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (delim) {
      if (escape) { out += c; escape = false; continue; }
      if (c === '\\') { out += c; escape = true; continue; }
      if (c === delim) { delim = null; out += c; continue; }
      out += c;
      continue;
    }
    if (c === '"' || c === "'") { delim = c; out += c; continue; }
    if (c === '{' || c === '[') { stack.push(c); out += c; continue; }
    if (c === '}' || c === ']') {
      const want: '{' | '[' = c === '}' ? '{' : '[';
      while (stack.length > 0 && stack[stack.length - 1] !== want) {
        const top = stack.pop()!;
        out += top === '{' ? '}' : ']';
      }
      if (stack.length > 0) {
        stack.pop();
        out += c;
      }
      // orphan closer → drop
      continue;
    }
    out += c;
  }
  while (stack.length > 0) {
    const top = stack.pop()!;
    out += top === '{' ? '}' : ']';
  }
  return out;
}

export function parseLooseJson(raw: string): JsonResult {
  // Stage 0: strict
  try { return { ok: true, data: JSON.parse(raw) }; } catch { /* fall through */ }
  // Stage 1: string-aware cleanup (quotes, comments, trailing commas)
  const stage1 = cleanLoose(raw);
  try { return { ok: true, data: JSON.parse(stage1) }; } catch { /* fall through */ }
  // Stage 2: auto-close mismatched / missing brackets
  const stage2 = autoCloseBrackets(stage1);
  try {
    return { ok: true, data: JSON.parse(stage2) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
}
