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
    if (item.type === 'text') {
      blocks.push({ type: 'text', text: item.text });
    } else if (item.type === 'thinking') {
      blocks.push({
        type: 'thinking',
        thinking: { text: item.thinking },
      });
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
    }
  }

  return blocks;
}

/** Get a human-friendly label for a tool name */
export function getToolLabel(name: string): string {
  const labels: Record<string, string> = {
    Bash: '명령어 실행',
    Read: '파일 읽기',
    Write: '파일 생성',
    Edit: '파일 편집',
    Glob: '파일 검색',
    Grep: '내용 검색',
    Task: '하위 작업',
    WebSearch: '웹 검색',
    WebFetch: '웹 페이지 조회',
    AskUserQuestion: '사용자 질문',
    TodoWrite: '할 일 관리',
  };
  return labels[name] || name;
}

/** Get a summary string for a tool use */
export function getToolSummary(name: string, input: Record<string, any>): string {
  switch (name) {
    case 'Bash':
      return input.command ? `$ ${truncate(input.command, 60)}` : '명령어 실행';
    case 'Read':
      return input.file_path ? `📄 ${basename(input.file_path)}` : '파일 읽기';
    case 'Write':
      return input.file_path ? `✏️ ${basename(input.file_path)}` : '파일 생성';
    case 'Edit':
      return input.file_path ? `📝 ${basename(input.file_path)}` : '파일 편집';
    case 'Glob':
      return input.pattern ? `🔍 ${input.pattern}` : '파일 패턴 검색';
    case 'Grep':
      return input.pattern ? `🔎 "${truncate(input.pattern, 40)}"` : '내용 검색';
    case 'WebSearch':
      return input.query ? `🌐 ${truncate(input.query, 50)}` : '웹 검색';
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
