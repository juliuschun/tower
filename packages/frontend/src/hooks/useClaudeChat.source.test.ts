import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const HOOK_PATH = path.resolve(import.meta.dirname, './useClaudeChat.ts');

describe('useClaudeChat source contracts', () => {
  it('clears streaming immediately on abort so user can send next message', () => {
    const src = fs.readFileSync(HOOK_PATH, 'utf-8');
    const abortBlock = src.match(/const abort = useCallback\([\s\S]*?\n  \}, \[send.*?\]\);/);
    expect(abortBlock?.[0]).toBeTruthy();
    // Abort should immediately clear streaming so user isn't stuck waiting
    expect(abortBlock?.[0]).toContain('setStreaming(false)');
    expect(abortBlock?.[0]).toContain('setTurnStartTime(null)');
  });

  it('re-marks the session as streaming when SESSION_BUSY arrives', () => {
    const src = fs.readFileSync(HOOK_PATH, 'utf-8');
    expect(src).toMatch(/SESSION_BUSY[\s\S]*setSessionStreaming\(data\.sessionId, true\)/);
    expect(src).toMatch(/SESSION_BUSY[\s\S]*setStreaming\(true\)/);
  });
});
