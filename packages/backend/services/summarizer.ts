import { runUtilityTextTask } from './utility-agent.js';

/**
 * Generate a session summary using an engine-neutral utility agent.
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

  const resultText = await runUtilityTextTask({
    prompt,
    model: 'claude-haiku-4-5-20251001',
    systemPrompt: 'You are a conversation summarizer. Do not greet. Do not use any tools. Output only in the specified format (arrow flow + bullet points + current status).',
    fallbackText: 'Summary generation failed',
  });

  return resultText.trim() || 'Summary generation failed';
}
