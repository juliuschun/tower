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

/**
 * Build SQL visibility clause for session-based queries.
 * Returns { clause, params, nextIdx } to append to WHERE.
 *
 * Logic (same as getSessions):
 *   admin → no filter
 *   member → (own sessions) OR (project member + visibility='project')
 */
function buildVisibilityFilter(
  accessibleIds: string[] | null,
  userId: number | undefined,
  startIdx: number,
): { clause: string; params: any[]; nextIdx: number } {
  if (accessibleIds === null) {
    // admin — no filter
    return { clause: '', params: [], nextIdx: startIdx };
  }

  // Non-admin: own sessions + project-visible sessions in accessible projects
  const params: any[] = [];
  const conditions: string[] = [];

  // Own sessions (any project or no project)
  if (userId) {
    conditions.push(`s.user_id = $${startIdx}`);
    params.push(userId);
    startIdx++;
  }

  // Project sessions where user is a member and visibility = 'project'
  if (accessibleIds.length > 0) {
    conditions.push(`(s.project_id = ANY($${startIdx}) AND s.visibility = 'project')`);
    params.push(accessibleIds);
    startIdx++;
  }

  if (conditions.length === 0) {
    return { clause: 'AND FALSE', params: [], nextIdx: startIdx };
  }

  return {
    clause: `AND (${conditions.join(' OR ')})`,
    params,
    nextIdx: startIdx,
  };
}

export async function search(query: string, opts: { userId?: number; role?: string; limit?: number } = {}): Promise<SearchResult[]> {
  const limit = opts.limit || 20;
  const results: SearchResult[] = [];

  // Determine accessible project IDs for DB-level filtering
  const accessibleIds = (opts.userId && opts.role)
    ? await getAccessibleProjectIds(opts.userId, opts.role)
    : null;

  const vis = buildVisibilityFilter(accessibleIds, opts.userId, 3);

  // 1) Session search (name, summary)
  try {
    const sessionParams = [query, limit, ...vis.params];
    const sessionHits = await pgQuery(`
      SELECT s.id, s.name, s.summary, s.created_at, s.user_id, s.project_id, s.visibility
      FROM sessions s
      WHERE (s.name ILIKE '%' || $1 || '%' OR COALESCE(s.summary,'') ILIKE '%' || $1 || '%')
        AND (s.archived IS NULL OR s.archived = 0)
        ${vis.clause}
      ORDER BY s.updated_at DESC
      LIMIT $2
    `, sessionParams);

    for (const hit of sessionHits) {
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
    const msgVis = buildVisibilityFilter(accessibleIds, opts.userId, 3);
    const msgParams = [query, limit, ...msgVis.params];
    const messageHits = await pgQuery(`
      SELECT m.id, m.content AS body, m.session_id, m.created_at,
             s.name AS session_name, s.user_id, s.project_id, s.visibility
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
      WHERE m.content ILIKE '%' || $1 || '%'
        AND m.role IN ('user', 'assistant')
        AND (s.archived IS NULL OR s.archived = 0)
        ${msgVis.clause}
      ORDER BY m.created_at DESC
      LIMIT $2
    `, msgParams);

    for (const hit of messageHits) {
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
