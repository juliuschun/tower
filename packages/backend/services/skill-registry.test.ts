import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-skill-registry-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('skill-registry project skill paths', () => {
  it('returns project .claude/skills path when it exists', async () => {
    const { getProjectSkillPaths } = await import('./skill-registry.ts');
    const root = makeTempDir();
    const skillsDir = path.join(root, '.claude', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    expect(getProjectSkillPaths(root)).toEqual([skillsDir]);
  });

  it('returns empty array when project .claude/skills path is missing', async () => {
    const { getProjectSkillPaths } = await import('./skill-registry.ts');
    const root = makeTempDir();
    expect(getProjectSkillPaths(root)).toEqual([]);
  });
});
