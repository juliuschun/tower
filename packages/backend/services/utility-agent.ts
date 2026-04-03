import { getEngine } from '../engines/index.js';

export function engineFromModel(modelId: string): 'claude' | 'pi' {
  return modelId.includes('/') ? 'pi' : 'claude';
}

export async function runUtilityTextTask(opts: {
  prompt: string;
  systemPrompt: string;
  model: string;
  fallbackText: string;
}): Promise<string> {
  try {
    const engine = await getEngine(engineFromModel(opts.model));
    const result = await engine.quickReply(opts.prompt, {
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      onChunk: () => {},
    });
    return typeof result === 'string' && result.trim() ? result : opts.fallbackText;
  } catch {
    return opts.fallbackText;
  }
}
