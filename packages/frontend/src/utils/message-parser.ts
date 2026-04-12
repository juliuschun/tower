import type { ContentBlock } from '../stores/chat-store';

export function extractThinkingTitle(raw?: string): string | undefined {
  if (!raw) return undefined;

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const firstLine = lines[0];
  if (!firstLine) return undefined;

  const boldTitle = firstLine.match(/^\*\*(.+?)\*\*[：:]?$/);
  if (boldTitle?.[1]) return boldTitle[1].trim();

  const headingTitle = firstLine.match(/^#{1,6}\s+(.+)$/);
  if (headingTitle?.[1]) return headingTitle[1].trim();

  return undefined;
}

function normalizeThinkingBlock(raw: string, explicitTitle?: string): ContentBlock {
  return {
    type: 'thinking',
    thinking: {
      text: raw,
      title: explicitTitle || extractThinkingTitle(raw),
    },
  };
}

/**
 * Extract <thinking> blocks from a raw text string.
 * Handles: leading, mid-text, trailing, multiple, and partial (streaming) thinking blocks.
 */
function extractThinkingFromText(raw: string): ContentBlock[] {
  const result: ContentBlock[] = [];
  // Regex matches all complete <thinking>...</thinking> blocks anywhere in the text
  const pattern = /(<(?:antml_)?thinking>)([\s\S]*?)(<\/(?:antml_)?thinking>)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    const before = raw.slice(lastIndex, match.index).trim();
    if (before) result.push({ type: 'text', text: before });
    result.push(normalizeThinkingBlock(match[2]));
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after all complete blocks
  const after = raw.slice(lastIndex);

  // Check if remaining text contains an unclosed opening tag (streaming)
  const openTagMatch = after.match(/^([\s\S]*?)<(?:antml_)?thinking>([\s\S]*)$/);
  if (openTagMatch) {
    const beforeOpen = openTagMatch[1].trim();
    if (beforeOpen) result.push({ type: 'text', text: beforeOpen });
    result.push(normalizeThinkingBlock(openTagMatch[2]));
  } else {
    const trimmed = after.trim();
    if (trimmed) result.push({ type: 'text', text: trimmed });
  }

  // Fallback: no thinking blocks at all → single text block
  if (result.length === 0 && raw.trim()) {
    result.push({ type: 'text', text: raw });
  }

  return result;
}

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
      const thinkingText = typeof item.thinking === 'string'
        ? item.thinking
        : (item.thinking?.text || item.text || '');
      const thinkingTitle = typeof item.thinking === 'object'
        ? item.thinking?.title
        : item.title;
      blocks.push(normalizeThinkingBlock(thinkingText, thinkingTitle));
    } else if (item.type === 'text') {
      const raw = item.text || '';
      blocks.push(...extractThinkingFromText(raw));
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
export function normalizeContentBlocks(blocks: any[], previousBlocks: ContentBlock[] = []): ContentBlock[] {
  if (!Array.isArray(blocks)) return [];

  const previousToolResults = new Map<string, string>();
  for (const block of previousBlocks) {
    if ((block.type === 'tool_use' || block.type === 'tool_result') && block.toolUse?.id && block.toolUse.result) {
      previousToolResults.set(block.toolUse.id, block.toolUse.result);
    }
  }

  return blocks.flatMap((item) => {
    // Already in ContentBlock format (has toolUse/thinking wrapper)
    if (item.type === 'tool_use' && item.toolUse) return item;
    if (item.type === 'thinking' && item.thinking?.text) {
      return normalizeThinkingBlock(item.thinking.text, item.thinking.title);
    }
    // Extract <thinking> tags from text blocks (DB stores them embedded)
    if (item.type === 'text' && item.text) {
      const extracted = extractThinkingFromText(item.text);
      // Only expand if thinking was actually found; otherwise return as-is
      if (extracted.some((b) => b.type === 'thinking')) return extracted;
      return item;
    }

    // Raw SDK format — convert
    if (item.type === 'tool_use') {
      const toolId = item.id || item.toolUse?.id || '';
      return {
        type: 'tool_use' as const,
        toolUse: {
          id: toolId,
          name: item.name || item.toolUse?.name || '',
          input: item.input || item.toolUse?.input || {},
          result: item.result ?? item.toolUse?.result ?? (toolId ? previousToolResults.get(toolId) : undefined),
        },
      };
    }
    if (item.type === 'thinking') {
      const thinkingText = typeof item.thinking === 'string'
        ? item.thinking
        : (item.thinking?.text || item.text || '');
      const thinkingTitle = typeof item.thinking === 'object'
        ? item.thinking?.title
        : item.title;
      return normalizeThinkingBlock(thinkingText, thinkingTitle);
    }
    // Unknown block type — convert to empty text block to prevent React error #31
    // ("Objects are not valid as a React child") if this object gets rendered directly.
    console.warn('[normalizeContentBlocks] unknown content block, converting to text:', item.type, item);
    return { type: 'text' as const, text: typeof item.text === 'string' ? item.text : '' };
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
  return labels[name] || labels[name.charAt(0).toUpperCase() + name.slice(1)] || name;
}

/** Get a summary string for a tool use */
export function getToolSummary(name: string, input: Record<string, any>): string {
  // Normalize: SDK may send "bash" or "Bash"
  const n = name.charAt(0).toUpperCase() + name.slice(1);
  switch (n) {
    case 'Bash':
      return input.command ? `$ ${truncate(input.command, 60)}` : 'Bash';
    case 'Read': {
      const filePath = input.file_path || input.path;
      return filePath ? `📄 ${basename(filePath)}` : 'Read';
    }
    case 'Write': {
      const filePath = input.file_path || input.path;
      return filePath ? `✏️ ${basename(filePath)}` : 'Write';
    }
    case 'Edit': {
      const filePath = input.file_path || input.path;
      return filePath ? `📝 ${basename(filePath)}` : 'Edit';
    }
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
    case 'TodoWrite': {
      const todos = input.todos as Array<{ content: string; status: string }> | undefined;
      if (!todos?.length) return 'Manage todos';
      const done = todos.filter(t => t.status === 'completed').length;
      const inProg = todos.filter(t => t.status === 'in_progress').length;
      const total = todos.length;
      if (done === total) return `All done (${total}/${total})`;
      if (inProg > 0) return `${done}/${total} done`;
      return `${total} tasks planned`;
    }
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
