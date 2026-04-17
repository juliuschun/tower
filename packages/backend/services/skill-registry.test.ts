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

describe('skill-registry managed-mode detection', () => {
  it('reports standalone mode when no manifest file exists at ~/.claude/skills/.managed-manifest.json', async () => {
    const { isManagedMode } = await import('./skill-registry.ts');
    const manifestPath = path.join(os.homedir(), '.claude', 'skills', '.managed-manifest.json');

    // This test relies on dev machines not having the managed-manifest.json file.
    // If a test runner somehow has one (e.g. running inside a managed customer VM),
    // skip rather than fail — the reverse case is covered in integration tests.
    if (fs.existsSync(manifestPath)) return;
    expect(isManagedMode()).toBe(false);
  });

  it('reconcileManagedSkills short-circuits with standalone result when no manifest exists', async () => {
    const { reconcileManagedSkills, isManagedMode } = await import('./skill-registry.ts');
    if (isManagedMode()) return; // skip on managed VMs (integration-covered)

    const result = await reconcileManagedSkills();
    expect(result.mode).toBe('standalone');
    expect(result.synced).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.removedNames).toEqual([]);
    expect(result.missingOnDisk).toEqual([]);
  });
});
