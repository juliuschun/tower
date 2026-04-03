import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const HOOK_PATH = path.resolve(import.meta.dirname, './useClaudeChat.ts');

describe('useClaudeChat source contracts', () => {
  it('keeps streaming true on abort until backend confirms idle', () => {
    const src = fs.readFileSync(HOOK_PATH, 'utf-8');
    const abortBlock = src.match(/const abort = useCallback\([\s\S]*?\n  \}, \[send\]\);/);
    expect(abortBlock?.[0]).toBeTruthy();
    expect(abortBlock?.[0]).not.toContain('setStreaming(false)');
    expect(abortBlock?.[0]).not.toContain('setTurnStartTime(null)');
    expect(abortBlock?.[0]).toContain('Keep streaming=true until the backend confirms');
  });

  it('re-marks the session as streaming when SESSION_BUSY arrives', () => {
    const src = fs.readFileSync(HOOK_PATH, 'utf-8');
    expect(src).toMatch(/SESSION_BUSY[\s\S]*setSessionStreaming\(data\.sessionId, true\)/);
    expect(src).toMatch(/SESSION_BUSY[\s\S]*setStreaming\(true\)/);
  });
});
