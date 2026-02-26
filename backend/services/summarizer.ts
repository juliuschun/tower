import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';

/**
 * Generate a session summary using Claude Code SDK query() with Haiku model.
 * Uses systemPrompt to override Claude Code's default coding assistant prompt.
 */
export async function generateSummary(messagesText: string): Promise<string> {
  const prompt = `Below is a conversation history. Summarize it in this format:

1) Topic flow in one line using arrows (→)
2) Key actions/tasks as 3-5 bullet points (•)
3) Current status in one line

Example:
Model selector → DB migration → Frontend integration
• Added model switching via SDK Options.model
• Implemented auto session naming service
• Created SummaryCard component
Status: Build succeeded, testing on server

---
${messagesText}
---

Summary of the above conversation:`;

  console.log('[summarizer] prompt length:', prompt.length);
  console.log('[summarizer] prompt preview:', prompt.slice(0, 200));

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
        allowDangerouslySkipPermissions: true,
        maxTurns: 1,
        systemPrompt: 'You are a conversation summarizer. Do not greet. Do not use any tools. Output only in the specified format (arrow flow + bullet points + current status).',
        disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
      },
    });

    let resultText = '';
    for await (const message of response) {
      if ((message as any).type === 'system' && (message as any).subtype === 'init') {
        console.log('[summarizer] actual model:', (message as any).model);
      }
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

    return resultText.trim() || 'Summary generation failed';
  } catch {
    return 'Summary generation failed';
  } finally {
    clearTimeout(timeout);
  }
}
