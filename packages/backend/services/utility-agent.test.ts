import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuickReply = vi.fn();
const mockGetEngine = vi.fn(async () => ({ quickReply: mockQuickReply }));

describe('utility-agent', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock('../engines/index.js', () => ({
      getEngine: mockGetEngine,
    }));
  });

  it('engineFromModel returns pi for provider/model ids', async () => {
    const mod = await import('./utility-agent.ts');
    expect(mod.engineFromModel('azure-openai-responses/gpt-5.4')).toBe('pi');
    expect(mod.engineFromModel('openrouter/anthropic/claude-sonnet-4.6')).toBe('pi');
  });

  it('engineFromModel returns claude for claude model ids', async () => {
    const mod = await import('./utility-agent.ts');
    expect(mod.engineFromModel('claude-haiku-4-5-20251001')).toBe('claude');
  });

  it('runUtilityTextTask loads engine from model and calls quickReply', async () => {
    mockQuickReply.mockResolvedValueOnce('result text');
    const mod = await import('./utility-agent.ts');

    const result = await mod.runUtilityTextTask({
      prompt: 'hello',
      systemPrompt: 'system',
      model: 'claude-haiku-4-5-20251001',
      fallbackText: 'fallback',
    });

    expect(mockGetEngine).toHaveBeenCalledWith('claude');
    expect(mockQuickReply).toHaveBeenCalledTimes(1);
    expect(mockQuickReply.mock.calls[0][0]).toBe('hello');
    expect(mockQuickReply.mock.calls[0][1]).toMatchObject({
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'system',
    });
    expect(result).toBe('result text');
  });

  it('returns fallback text when engine call fails', async () => {
    mockQuickReply.mockRejectedValueOnce(new Error('boom'));
    const mod = await import('./utility-agent.ts');

    const result = await mod.runUtilityTextTask({
      prompt: 'hello',
      systemPrompt: 'system',
      model: 'claude-haiku-4-5-20251001',
      fallbackText: 'fallback',
    });

    expect(result).toBe('fallback');
  });
});
