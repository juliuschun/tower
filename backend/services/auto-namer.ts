import { query } from '@anthropic-ai/claude-code';
import { config } from '../config.js';

/**
 * Generate a session name using Claude Code SDK query() with Haiku model.
 * Uses customSystemPrompt to override Claude Code's default coding assistant prompt.
 */
export async function generateSessionName(
  firstUserMessage: string,
  firstAssistantResponse: string,
): Promise<string> {
  const snippet = firstAssistantResponse.slice(0, 200);
  const prompt = `아래 대화의 제목을 15자 내외 한글로 한 줄만 생성해. 설명 없이 제목만:\n\nUser: ${firstUserMessage}\nAssistant: ${snippet}\n\n제목:`;

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 30_000);

  try {
    const response = query({
      prompt,
      options: {
        abortController,
        model: 'claude-haiku-4-5-20251001',
        executable: 'node',
        executableArgs: [],
        pathToClaudeCodeExecutable: config.claudeExecutable,
        cwd: config.defaultCwd,
        permissionMode: 'bypassPermissions',
        maxTurns: 1,
        customSystemPrompt: '너는 대화 제목 생성기야. 사용자가 보내는 대화 내용을 보고 15자 내외 한글로 제목을 한 줄만 생성해. 설명 없이 제목만 출력해. 도구를 사용하지 마.',
        disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
      },
    });

    let resultText = '';
    for await (const message of response) {
      if ((message as any).type === 'result' && (message as any).result) {
        resultText = (message as any).result;
      } else if ((message as any).type === 'assistant') {
        const content = (message as any).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              resultText = block.text;
            }
          }
        }
      }
    }

    const cleaned = resultText
      .split('\n')[0]
      .replace(/^["'「」『』]+|["'「」『』]+$/g, '')
      .trim();

    return cleaned || firstUserMessage.slice(0, 20);
  } catch {
    return firstUserMessage.slice(0, 20);
  } finally {
    clearTimeout(timeout);
  }
}
