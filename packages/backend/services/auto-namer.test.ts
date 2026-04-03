import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunUtilityTextTask = vi.fn();

describe('auto-namer', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock('./utility-agent.js', () => ({
      runUtilityTextTask: mockRunUtilityTextTask,
    }));
  });

  it('uses utility-agent and returns cleaned first line', async () => {
    mockRunUtilityTextTask.mockResolvedValueOnce('"Short Title"\nExtra line');
    const { generateSessionName } = await import('./auto-namer.ts');

    const result = await generateSessionName('hello', 'assistant text');
    expect(mockRunUtilityTextTask).toHaveBeenCalledTimes(1);
    expect(result).toBe('Short Title');
  });

  it('falls back to user text slice when utility-agent returns empty text', async () => {
    mockRunUtilityTextTask.mockResolvedValueOnce('   ');
    const { generateSessionName } = await import('./auto-namer.ts');

    const result = await generateSessionName('abcdefghijklmnopqrstuvwxyz', 'assistant text');
    expect(result).toBe('abcdefghijklmnopqrst');
  });
});
