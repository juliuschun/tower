import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Test 3E — Dependency tree verification.
 * Verifies npm workspace symlinks and native addons are accessible.
 */

const ROOT = path.resolve(import.meta.dirname, '..');

describe('dependency tree', () => {
  it('node_modules/@tower/shared exists (symlink or directory)', () => {
    const sharedPath = path.join(ROOT, 'node_modules', '@tower', 'shared');
    expect(fs.existsSync(sharedPath)).toBe(true);
  });

  it('pg is loadable', async () => {
    const mod = await import('pg');
    expect(mod.default || mod.Pool || mod.Client).toBeDefined();
  });
});
