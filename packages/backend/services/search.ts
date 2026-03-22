import { query as pgQuery } from '../db/pg-repo.js';
import { getAccessibleProjectIds } from './group-manager.js';

export interface SearchResult {
  type: 'session' | 'message';
  sessionId: string;
  sessionName: string;
  snippet: string;
  rank: number;
  createdAt: string;
}

export async function search(query: string, opts: { userId?: number; role?: string; limit?: number } = {}): Promise<SearchResult[]> {
  const limit = opts.limit || 20;
  const results: SearchResult[] = [];

  // Determine accessible project IDs for group filtering
  const accessibleIds = (opts.userId && opts.role)
    ? await getAccessibleProjectIds(opts.userId, opts.role)
    : null;

  // Filter function: same logic as sessions — respects visibility + project membership
  const isVisible = (row: { user_id: number | null; project_id: string | null; visibility?: string }) => {
    if (accessibleIds === null) return true; // admin or no groups
    // Non-project sessions: only creator can see
    if (!row.project_id) return row.user_id === opts.userId;
    // Project sessions: must be a member
    if (!accessibleIds.includes(row.project_id)) return false;
    // Own sessions always visible
    if (row.user_id === opts.userId) return true;
    // Others' sessions: only if visibility = 'project'
    return row.visibility === 'project';
  };

  // Fetch extra rows to compensate for post-filtering
  const fetchLimit = limit * 3;

  // 1) Session search (name, summary)
  try {
    const sessionHits = await pgQuery(`
      SELECT id, name, summary, created_at, user_id, project_id, visibility
      FROM sessions
      WHERE (name ILIKE '%' || $1 || '%' OR COALESCE(summary,'') ILIKE '%' || $1 || '%')
        AND archived = 0
      LIMIT $2
    `, [query, fetchLimit]);

    for (const hit of sessionHits) {
      if (!isVisible(hit)) continue;
      results.push({
        type: 'session',
        sessionId: hit.id,
        sessionName: hit.name,
        snippet: hit.summary || hit.name,
        rank: 0,
        createdAt: hit.created_at,
      });
    }
  } catch (err) { console.error('[search] session search error:', err); }

  // 2) Message search (body)
  try {
    const messageHits = await pgQuery(`
      SELECT m.id, m.content AS body, m.session_id, m.created_at,
             s.name AS session_name, s.user_id, s.project_id, s.visibility
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
      WHERE m.content ILIKE '%' || $1 || '%'
        AND m.role IN ('user', 'assistant')
        AND (s.archived IS NULL OR s.archived = 0)
      ORDER BY m.created_at DESC
      LIMIT $2
    `, [query, fetchLimit]);

    for (const hit of messageHits) {
      if (!isVisible(hit)) continue;
      const body = hit.body || '';
      const idx = body.toLowerCase().indexOf(query.toLowerCase());
      const start = Math.max(0, idx - 80);
      const end = Math.min(body.length, idx + query.length + 120);
      const snippet = (start > 0 ? '...' : '') + body.slice(start, end) + (end < body.length ? '...' : '');

      results.push({
        type: 'message',
        sessionId: hit.session_id,
        sessionName: hit.session_name,
        snippet,
        rank: 0,
        createdAt: hit.created_at,
      });
    }
  } catch (err) { console.error('[search] message search error:', err); }

  return results.slice(0, limit);
}
