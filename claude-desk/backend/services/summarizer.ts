import { query } from '@anthropic-ai/claude-code';
import { config } from '../config.js';

/**
 * Generate a session summary using Claude Code SDK query() with Haiku model.
 */
export async function generateSummary(messagesText: string): Promise<string> {
  const prompt = `다음 대화를 5줄 이내 한글로 요약해. 핵심 작업과 결과 위주:\n${messagesText}`;

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 60_000);

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

    return resultText.trim() || '요약 생성 실패';
  } catch {
    return '요약 생성 실패';
  } finally {
    clearTimeout(timeout);
  }
}
