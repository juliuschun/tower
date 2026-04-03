import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('ai-quick-reply source contracts', () => {
  it('reuses engineFromModel from utility-agent', () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, 'ai-quick-reply.ts'), 'utf8');
    expect(src).toMatch(/import\s*\{\s*engineFromModel\s*\}\s*from '\.\/utility-agent\.js'/);
    expect(src).not.toMatch(/function engineFromModel\(/);
  });
});
