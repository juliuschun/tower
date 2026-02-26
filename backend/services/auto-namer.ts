import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';

/**
 * Generate a session name using Claude Code SDK query() with Haiku model.
 * Uses systemPrompt to override Claude Code's default coding assistant prompt.
 */
export async function generateSessionName(
  firstUserMessage: string,
  firstAssistantResponse: string,
): Promise<string> {
  const snippet = firstAssistantResponse.slice(0, 200);
  const prompt = `Generate a short title (under 15 chars) for this conversation. Output only the title, nothing else.\n\nUser: ${firstUserMessage}\nAssistant: ${snippet}\n\nTitle:`;

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
        allowDangerouslySkipPermissions: true,
        maxTurns: 1,
        systemPrompt: 'You are a conversation title generator. Generate a short title (under 15 chars) for the conversation. Output only the title, nothing else. Do not use any tools.',
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
