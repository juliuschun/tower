import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const HOOK_PATH = path.resolve(import.meta.dirname, './useClaudeChat.ts');

describe('tower_message runtime contracts', () => {
  it('aligns active session before handling direct tower_message assistant events', () => {
    const src = fs.readFileSync(HOOK_PATH, 'utf-8');
    expect(src).toMatch(/case 'tower_message':[\s\S]*if \(towerMsg\.type === 'assistant'\) \{[\s\S]*setSessionId\(data\.sessionId\)/);
  });
});
