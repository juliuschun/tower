import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('child_process');
});

describe('Pi web tools', () => {
  it('WebFetch returns JSON response as readable text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: (k: string) => k.toLowerCase() === 'content-type' ? 'application/json' : null },
      json: async () => ({ hello: 'world' }),
      text: async () => JSON.stringify({ hello: 'world' }),
    })) as any);

    const { webFetchTool } = await import('./pi-web-tools.ts');
    const result = await webFetchTool.execute('t1', { url: 'https://example.com/data.json' }, undefined as any);
    expect(result.content[0].text).toContain('hello');
    expect(result.content[0].text).toContain('world');
  });

  it('WebFetch extracts text from HTML response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: (k: string) => k.toLowerCase() === 'content-type' ? 'text/html' : null },
      text: async () => '<html><head><title>Demo</title><style>.x{}</style></head><body><h1>Hello</h1><p>World</p><script>ignored()</script></body></html>',
    })) as any);

    const { webFetchTool } = await import('./pi-web-tools.ts');
    const result = await webFetchTool.execute('t1', { url: 'https://example.com' }, undefined as any);
    expect(result.content[0].text).toContain('Hello');
    expect(result.content[0].text).toContain('World');
    expect(result.content[0].text).not.toContain('ignored');
  });

  it('WebSearch summarizes search results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({
        AbstractText: 'Top abstract',
        AbstractURL: 'https://example.com/abstract',
        RelatedTopics: [
          { Text: 'Result One', FirstURL: 'https://example.com/1' },
          { Text: 'Result Two', FirstURL: 'https://example.com/2' },
        ],
      }),
    })) as any);

    const { webSearchTool } = await import('./pi-web-tools.ts');
    const result = await webSearchTool.execute('t2', { query: 'tower ai' }, undefined as any);
    expect(result.content[0].text).toContain('tower ai');
    expect(result.content[0].text).toContain('Top abstract');
    expect(result.content[0].text).toContain('Result One');
  });

  it('falls back to curl when fetch throws for WebFetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed'); }) as any);
    vi.doMock('child_process', () => ({
      execFileSync: vi.fn(() => '<html><body><h1>Fallback Works</h1></body></html>\n__TOWER_META__200|text/html'),
    }));
    const { webFetchTool } = await import('./pi-web-tools.ts');
    const result = await webFetchTool.execute('t3', { url: 'https://example.com' }, undefined as any);
    expect(result.content[0].text).toContain('Fallback Works');
  });

  it('falls back to curl when fetch throws for WebSearch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed'); }) as any);
    vi.doMock('child_process', () => ({
      execFileSync: vi.fn(() => '{"AbstractText":"Fallback summary","RelatedTopics":[]}\n__TOWER_META__200|application/json'),
    }));
    const { webSearchTool } = await import('./pi-web-tools.ts');
    const result = await webSearchTool.execute('t4', { query: 'Tower AI agent' }, undefined as any);
    expect(result.content[0].text).toContain('Fallback summary');
  });

  it('returns readable error text on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 500, headers: { get: () => 'text/plain' }, text: async () => 'boom' })) as any);
    const { webFetchTool } = await import('./pi-web-tools.ts');
    const result = await webFetchTool.execute('t5', { url: 'https://bad.example' }, undefined as any);
    expect(result.content[0].text).toContain('WebFetch failed');
  });
});
