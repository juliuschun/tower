import { runUtilityTextTask } from './utility-agent.js';

/**
 * Generate a session name using an engine-neutral utility agent.
 */
export async function generateSessionName(
  firstUserMessage: string,
  firstAssistantResponse: string,
): Promise<string> {
  const snippet = firstAssistantResponse.slice(0, 200);
  const prompt = `Generate a short title (under 15 chars) for this conversation. Output only the title, nothing else.\n\nUser: ${firstUserMessage}\nAssistant: ${snippet}\n\nTitle:`;

  const resultText = await runUtilityTextTask({
    prompt,
    model: 'claude-haiku-4-5-20251001',
    systemPrompt: 'You are a conversation title generator. Generate a short title (under 15 chars) for the conversation. Output only the title, nothing else. Do not use any tools.',
    fallbackText: firstUserMessage.slice(0, 20),
  });

  const cleaned = resultText
    .split('\n')[0]
    .replace(/^["'「」『』]+|["'「」『』]+$/g, '')
    .trim();

  return cleaned || firstUserMessage.slice(0, 20);
}
