import type { ContentBlock } from '../stores/chat-store';

/**
 * Parse an SDK assistant message into UI-renderable content blocks.
 *
 * SDK assistant messages have:
 *   message.content: Array<{ type: 'text', text } | { type: 'tool_use', id, name, input } | { type: 'thinking', thinking }>
 */
export function parseSDKMessage(sdkMsg: any): ContentBlock[] {
  if (!sdkMsg?.message?.content) return [];

  const blocks: ContentBlock[] = [];

  for (const item of sdkMsg.message.content) {
    if (item.type === 'thinking') {
      // SDK may send thinking as item.thinking (string) or item.text
      const thinkingText = typeof item.thinking === 'string' ? item.thinking : (item.text || '');
      blocks.push({
        type: 'thinking',
        thinking: { text: thinkingText },
      });
    } else if (item.type === 'text') {
      const raw = item.text || '';
      // Complete thinking block — <thinking>...</thinking> followed by optional text
      const completeMatch = raw.match(/^\s*<(?:antml_)?thinking>\n?([\s\S]*?)\n?<\/(?:antml_)?thinking>\s*/);
      if (completeMatch) {
        blocks.push({ type: 'thinking', thinking: { text: completeMatch[1] } });
        const rest = raw.slice(completeMatch[0].length).trim();
        if (rest) blocks.push({ type: 'text', text: rest });
      // Streaming — opening tag present but no closing tag yet
      } else if (/^\s*<(?:antml_)?thinking>/.test(raw)) {
        const content = raw.replace(/^\s*<(?:antml_)?thinking>\n?/, '');
        blocks.push({ type: 'thinking', thinking: { text: content } });
      } else {
        blocks.push({ type: 'text', text: raw });
      }
    } else if (item.type === 'tool_use') {
      blocks.push({
        type: 'tool_use',
        toolUse: {
          id: item.id,
          name: item.name,
          input: item.input || {},
        },
      });
    } else if (item.type === 'tool_result') {
      // tool results are usually nested — find matching tool_use
      blocks.push({
        type: 'tool_result',
        toolUse: {
          id: item.tool_use_id || '',
          name: '',
          input: {},
          result: typeof item.content === 'string'
            ? item.content
            : JSON.stringify(item.content),
        },
      });
    } else {
      console.warn('[parseSDKMessage] unhandled content block type:', item.type, item);
    }
  }

  return blocks;
}

/**
 * Normalize raw SDK content blocks (from DB) into UI ContentBlock format.
 * Raw SDK: { type: 'tool_use', id, name, input }
 * ContentBlock: { type: 'tool_use', toolUse: { id, name, input } }
 */
export function normalizeContentBlocks(blocks: any[]): ContentBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.flatMap((item) => {
    // Already in ContentBlock format (has toolUse/thinking wrapper)
    if (item.type === 'tool_use' && item.toolUse) return item;
    if (item.type === 'thinking' && item.thinking?.text) return item;
    // Extract <thinking> tags from text blocks (DB stores them embedded)
    if (item.type === 'text' && item.text) {
      const complete = item.text.match(/^\s*<(?:antml_)?thinking>\n?([\s\S]*?)\n?<\/(?:antml_)?thinking>\s*/);
      if (complete) {
        const result: ContentBlock[] = [{ type: 'thinking', thinking: { text: complete[1] } }];
        const rest = item.text.slice(complete[0].length).trim();
        if (rest) result.push({ type: 'text', text: rest });
        return result;
      }
      // Partial (streaming) — opening tag but no closing tag
      if (/^\s*<(?:antml_)?thinking>/.test(item.text)) {
        const content = item.text.replace(/^\s*<(?:antml_)?thinking>\n?/, '');
        return [{ type: 'thinking', thinking: { text: content } }];
      }
      return item;
    }

    // Raw SDK format — convert
    if (item.type === 'tool_use') {
      return {
        type: 'tool_use' as const,
        toolUse: {
          id: item.id || '',
          name: item.name || '',
          input: item.input || {},
          result: item.result,
        },
      };
    }
    if (item.type === 'thinking') {
      return {
        type: 'thinking' as const,
        thinking: { text: typeof item.thinking === 'string' ? item.thinking : (item.text || '') },
      };
    }
    return item;
  });
}

/** Get a human-friendly label for a tool name */
export function getToolLabel(name: string): string {
  const labels: Record<string, string> = {
    Bash: 'Run command',
    Read: 'Read file',
    Write: 'Create file',
    Edit: 'Edit file',
    Glob: 'Search files',
    Grep: 'Search content',
    Task: 'Sub-task',
    WebSearch: 'Web search',
    WebFetch: 'Fetch page',
    AskUserQuestion: 'Ask user',
    EnterPlanMode: 'Plan mode',
    ExitPlanMode: 'Plan complete',
    TodoWrite: 'Manage todos',
  };
  return labels[name] || name;
}

/** Get a summary string for a tool use */
export function getToolSummary(name: string, input: Record<string, any>): string {
  switch (name) {
    case 'Bash':
      return input.command ? `$ ${truncate(input.command, 60)}` : 'Run command';
    case 'Read':
      return input.file_path ? `📄 ${basename(input.file_path)}` : 'Read file';
    case 'Write':
      return input.file_path ? `✏️ ${basename(input.file_path)}` : 'Create file';
    case 'Edit':
      return input.file_path ? `📝 ${basename(input.file_path)}` : 'Edit file';
    case 'Glob':
      return input.pattern ? `🔍 ${input.pattern}` : 'Search files';
    case 'Grep':
      return input.pattern ? `🔎 "${truncate(input.pattern, 40)}"` : 'Search content';
    case 'WebSearch':
      return input.query ? `🌐 ${truncate(input.query, 50)}` : 'Web search';
    case 'AskUserQuestion': {
      const q = input.questions?.[0]?.question;
      return q ? truncate(q, 50) : 'Ask user';
    }
    case 'EnterPlanMode':
      return 'Entering plan mode';
    case 'ExitPlanMode':
      return 'Plan complete';
    default:
      return name;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function basename(p: string): string {
  return p.split('/').pop() || p;
}
