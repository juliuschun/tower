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

// 2026-04-17: managed-mode detection (isManagedMode / reconcileManagedSkills)
// 는 library-as-source 재설계에서 제거됨. bootstrapLibraryProviders 가 대신
// 역할을 맡지만 DB/파일 시스템 양쪽에 의존해 단위 테스트로는 부적합하여
// 통합 테스트로 커버한다. 관련 describe 블록 삭제.
