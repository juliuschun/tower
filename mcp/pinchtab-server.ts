import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { PinchTabManager } from './pinchtab-manager.js';

const manager = new PinchTabManager();

const server = new Server(
  { name: 'pinchtab', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ─── Tool 목록 ────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'browser_navigate',
      description: 'Navigate the browser to a URL and wait for the page to load.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to navigate to (e.g. https://example.com)' },
        },
        required: ['url'],
      },
    },
    {
      name: 'browser_text',
      description:
        'Get the readable text content of the current page (~800 tokens). ' +
        'Start here — cheapest way to read a page.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'browser_snapshot',
      description:
        'Get the accessibility tree of the current page as structured JSON. ' +
        'Use filter=interactive (default) to get only clickable/typeable elements. ' +
        'Element IDs (e.g. "e3") can be passed to browser_action.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: ['interactive', 'all'],
            description: 'interactive = buttons/links/inputs only (default). all = full tree.',
          },
        },
      },
    },
    {
      name: 'browser_action',
      description:
        'Interact with a page element. Get element IDs from browser_snapshot first.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['click', 'type', 'fill', 'press', 'hover', 'scroll', 'select', 'focus'],
            description: 'Action type',
          },
          element: {
            type: 'string',
            description: 'Element ID from snapshot (e.g. "e3"). Required for most actions.',
          },
          text: {
            type: 'string',
            description: 'Text to type/fill/press. Required for type, fill, press actions.',
          },
          direction: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right'],
            description: 'Scroll direction. Required for scroll action.',
          },
          amount: {
            type: 'number',
            description: 'Scroll amount in pixels. Used with scroll action.',
          },
        },
        required: ['type'],
      },
    },
    {
      name: 'browser_screenshot',
      description:
        'Capture a screenshot of the current browser view. ' +
        'Use only when visual confirmation is necessary — more expensive than text/snapshot.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'browser_evaluate',
      description: 'Execute JavaScript in the browser context and return the result.',
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'JavaScript expression or statement to execute',
          },
        },
        required: ['code'],
      },
    },
  ],
}));

// ─── Tool 실행 ────────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const a = args as Record<string, unknown>;

  try {
    switch (name) {
      case 'browser_navigate': {
        const res = await manager.fetch('/navigate', {
          method: 'POST',
          body: JSON.stringify({ url: a.url }),
        });
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      case 'browser_text': {
        const res = await manager.fetch('/text');
        const text = await res.text();
        return { content: [{ type: 'text', text }] };
      }

      case 'browser_snapshot': {
        const filter = (a.filter as string) || 'interactive';
        const res = await manager.fetch(`/snapshot?filter=${filter}&format=compact`);
        const text = await res.text();
        return { content: [{ type: 'text', text }] };
      }

      case 'browser_action': {
        // 브릿지는 'kind' 필드를 사용, MCP 스키마는 'type' — 변환 필요
        const { type: kind, ...rest } = a as { type: string; [k: string]: unknown };
        const res = await manager.fetch('/action', {
          method: 'POST',
          body: JSON.stringify({ kind, ...rest }),
        });
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      case 'browser_screenshot': {
        const res = await manager.fetch('/screenshot');
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(body.error || `Screenshot failed: HTTP ${res.status}`);
        }
        const contentType = res.headers.get('content-type') || '';

        // pinchtab API: {"base64": "...", "format": "jpeg"}
        if (contentType.includes('application/json')) {
          const body = await res.json();
          if (body.error) throw new Error(body.error);
          const fmt = (body.format as string) || 'png';
          const mimeType = `image/${fmt}` as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
          return {
            content: [{
              type: 'image',
              data: body.base64 as string,
              mimeType,
            }],
          };
        }

        // fallback: raw binary (향후 포맷 변경 대비)
        const mimeType = (contentType.split(';')[0].trim() || 'image/png') as
          'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        const buf = Buffer.from(await res.arrayBuffer());
        return {
          content: [{
            type: 'image',
            data: buf.toString('base64'),
            mimeType,
          }],
        };
      }

      case 'browser_evaluate': {
        // 브릿지는 'expression' 필드를 사용, MCP 스키마는 'code' — 변환 필요
        const res = await manager.fetch('/evaluate', {
          method: 'POST',
          body: JSON.stringify({ expression: a.code }),
        });
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ─── 시작 ─────────────────────────────────────────────────────────────────────

async function main() {
  await manager.start();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await manager.stop();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[pinchtab-server] fatal:', err);
  process.exit(1);
});
