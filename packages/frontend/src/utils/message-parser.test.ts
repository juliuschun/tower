import { describe, expect, it } from 'vitest';
import { normalizeContentBlocks } from './message-parser';

describe('normalizeContentBlocks', () => {
  it('preserves prior tool results across streaming assistant updates', () => {
    const previous = [
      {
        type: 'tool_use' as const,
        toolUse: {
          id: 'tool-1',
          name: 'Read',
          input: { path: '/tmp/a.txt' },
          result: 'hello world',
        },
      },
    ];

    const next = [
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: '/tmp/a.txt' } },
      { type: 'tool_use', id: 'tool-2', name: 'Bash', input: { command: 'pwd' } },
    ];

    const normalized = normalizeContentBlocks(next, previous as any);

    expect(normalized[0].toolUse?.result).toBe('hello world');
    expect(normalized[1].toolUse?.result).toBeUndefined();
  });
});
