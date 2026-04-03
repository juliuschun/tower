import { describe, it, expect } from 'vitest';
import { getToolSummary } from './message-parser';

describe('getToolSummary — file_path vs path normalization', () => {
  it('Read with file_path returns basename', () => {
    expect(getToolSummary('Read', { file_path: '/home/user/src/app.ts' })).toBe('📄 app.ts');
  });

  it('Read with path only returns basename', () => {
    expect(getToolSummary('Read', { path: '/home/user/src/app.ts' })).toBe('📄 app.ts');
  });

  it('Read with both prefers file_path', () => {
    expect(getToolSummary('Read', { file_path: '/a/b.ts', path: '/x/y.ts' })).toBe('📄 b.ts');
  });

  it('Read with neither returns fallback', () => {
    expect(getToolSummary('Read', {})).toBe('Read');
  });

  it('Write with path only returns basename', () => {
    expect(getToolSummary('Write', { path: '/data/output.json' })).toBe('✏️ output.json');
  });

  it('Edit with path only returns basename', () => {
    expect(getToolSummary('Edit', { path: '/src/index.ts' })).toBe('📝 index.ts');
  });

  it('handles lowercase tool names (SDK variation)', () => {
    expect(getToolSummary('read', { path: '/foo/bar.py' })).toBe('📄 bar.py');
  });

  it('Bash returns truncated command', () => {
    expect(getToolSummary('Bash', { command: 'npm run build' })).toBe('$ npm run build');
  });

  it('Grep returns search pattern', () => {
    expect(getToolSummary('Grep', { pattern: 'TODO' })).toBe('🔎 "TODO"');
  });
});
