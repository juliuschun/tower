import { execFileSync } from 'child_process';
import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';

const WebFetchParams = Type.Object({
  url: Type.String({ description: 'URL to fetch and read' }),
});

const WebSearchParams = Type.Object({
  query: Type.String({ description: 'Search query to look up on the web' }),
});

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, max = 4000): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'Tower/1.0 (+https://tower.moatai.app)',
        'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function curlFetch(url: string, timeoutSeconds = 15): { status: number; contentType: string; body: string } {
  const output = execFileSync('curl', [
    '-sSL',
    '--max-time', String(timeoutSeconds),
    '-A', 'Tower/1.0 (+https://tower.moatai.app)',
    '-H', 'Accept: text/html,application/json;q=0.9,*/*;q=0.8',
    '-w', '\n__TOWER_META__%{http_code}|%{content_type}',
    url,
  ], {
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
  });

  const marker = '\n__TOWER_META__';
  const idx = output.lastIndexOf(marker);
  if (idx === -1) {
    return { status: 200, contentType: '', body: output };
  }
  const body = output.slice(0, idx);
  const meta = output.slice(idx + marker.length).trim();
  const [statusStr, contentType = ''] = meta.split('|', 2);
  return {
    status: Number(statusStr) || 0,
    contentType,
    body,
  };
}

async function fetchReadable(url: string): Promise<{ status: number; contentType: string; body: string }> {
  try {
    const response = await fetchWithTimeout(url);
    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();
    return { status: response.status, contentType, body };
  } catch {
    return curlFetch(url);
  }
}

export const webFetchTool: ToolDefinition = {
  name: 'WebFetch',
  label: 'Fetch Page',
  description: 'Fetch a web page or JSON endpoint and return readable text content.',
  promptSnippet: 'Read content from a URL when a web page or API response is needed.',
  promptGuidelines: [
    'Use WebFetch when you need to read the contents of a specific URL.',
    'Prefer WebFetch for direct page reads over guessing from memory.',
    'Summarize large responses and keep only the most relevant text.',
  ],
  parameters: WebFetchParams,
  async execute(_toolCallId: string, params: { url: string }) {
    try {
      const { status, contentType, body } = await fetchReadable(params.url);
      if (status < 200 || status >= 300) {
        return { content: [{ type: 'text' as const, text: `WebFetch failed: HTTP ${status}${body ? ` — ${body.slice(0, 200)}` : ''}` }], details: undefined };
      }

      if (contentType.includes('application/json')) {
        const data = JSON.parse(body);
        return {
          content: [{ type: 'text' as const, text: truncate(JSON.stringify(data, null, 2)) }],
          details: undefined,
        };
      }

      const text = stripHtml(body);
      return {
        content: [{ type: 'text' as const, text: truncate(text || '(No readable text found)') }],
        details: undefined,
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text' as const, text: `WebFetch failed: ${err?.message || 'Unknown error'}` }],
        details: undefined,
      };
    }
  },
} as ToolDefinition;

export const webSearchTool: ToolDefinition = {
  name: 'WebSearch',
  label: 'Web Search',
  description: 'Search the web and return a short summary of relevant results.',
  promptSnippet: 'Search the web for recent or external information.',
  promptGuidelines: [
    'Use WebSearch when the answer depends on public web information.',
    'Keep the query focused and specific.',
    'Return only the most relevant top results.',
  ],
  parameters: WebSearchParams,
  async execute(_toolCallId: string, params: { query: string }) {
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(params.query)}&format=json&no_redirect=1&no_html=1`;
      const { status, body } = await fetchReadable(url);
      if (status < 200 || status >= 300) {
        return { content: [{ type: 'text' as const, text: `WebSearch failed: HTTP ${status}${body ? ` — ${body.slice(0, 200)}` : ''}` }], details: undefined };
      }

      const data: any = JSON.parse(body);
      const lines = [`Search query: ${params.query}`];
      if (data.AbstractText) {
        lines.push(`Top summary: ${data.AbstractText}`);
        if (data.AbstractURL) lines.push(`Source: ${data.AbstractURL}`);
      }

      const topics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
      const flat = topics.flatMap((item: any) => item.Topics || item).slice(0, 5);
      if (flat.length > 0) {
        lines.push('', 'Top results:');
        for (const item of flat) {
          const text = item.Text || item.Result || '(untitled result)';
          const link = item.FirstURL || item.AbstractURL || '';
          lines.push(`- ${text}${link ? ` — ${link}` : ''}`);
        }
      }

      if (lines.length === 1) {
        lines.push('No useful search results found.');
      }

      return {
        content: [{ type: 'text' as const, text: truncate(lines.join('\n')) }],
        details: undefined,
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text' as const, text: `WebSearch failed: ${err?.message || 'Unknown error'}` }],
        details: undefined,
      };
    }
  },
} as ToolDefinition;
