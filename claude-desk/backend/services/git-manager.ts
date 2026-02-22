import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = promisify(execFile);

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  authorName: string;
  message: string;
  commitType: 'auto' | 'manual' | 'rollback';
  filesChanged: string[];
  createdAt: string;
}

// Simple promise-based mutex for serializing git operations
let gitLock = Promise.resolve();
function withGitLock<T>(fn: () => Promise<T>): Promise<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: any) => void;
  const result = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  gitLock = gitLock.then(async () => {
    try {
      resolve(await fn());
    } catch (e) {
      reject(e);
    }
  }, async () => {
    try {
      resolve(await fn());
    } catch (e) {
      reject(e);
    }
  });
  return result;
}

const GITIGNORE_CONTENT = `# Ignore all hidden files/dirs by default
.*
!.gitignore

# System
snap/

# Dev artifacts
node_modules/
__pycache__/
.venv/
dist/
*.log
*.db
*.db-shm
*.db-wal

# Embedded git repos (auto-detected)
`;

async function git(cwd: string, args: string[], timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: timeoutMs,
    }, (err, stdout, _stderr) => {
      if (err) {
        // git add may warn about embedded repos but still stage files
        if (args[0] === 'add' && stdout) {
          return resolve(stdout.trim());
        }
        // Some commands exit non-zero for valid states (nothing to commit)
        if (stdout) return resolve(stdout.trim());
        return reject(err);
      }
      resolve(stdout.trim());
    });
  });
}

export async function initWorkspaceRepo(repoPath: string): Promise<void> {
  const gitDir = path.join(repoPath, '.git');
  const isNew = !fs.existsSync(gitDir);

  if (isNew) {
    await git(repoPath, ['init']);
  }

  // Auto-detect directories containing .git anywhere inside
  // Uses `find` for deep scanning to catch all embedded repos
  let gitignore = GITIGNORE_CONTENT;
  const dirsWithGit = new Set<string>();
  try {
    const { stdout } = await execFileAsync('find', [
      repoPath, '-maxdepth', '8', '-name', '.git',
      '-not', '-path', `${repoPath}/.git`,
    ], { maxBuffer: 1024 * 1024, timeout: 15000 });
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const rel = path.relative(repoPath, line);
      const topDir = rel.split(path.sep)[0];
      if (topDir && !topDir.startsWith('.')) {
        dirsWithGit.add(topDir);
      }
    }
  } catch {}
  for (const dir of dirsWithGit) {
    gitignore += `${dir}/\n`;
  }

  const gitignorePath = path.join(repoPath, '.gitignore');
  fs.writeFileSync(gitignorePath, gitignore, 'utf-8');

  await git(repoPath, ['add', '.gitignore']);
  try {
    const msg = isNew
      ? 'init: workspace initialized by Claude Desk'
      : 'chore: update .gitignore';
    await git(repoPath, ['commit', '-m', msg]);
  } catch {}

  console.log(`[Git] Workspace repo ${isNew ? 'initialized' : 'updated'} at ${repoPath}`);
}

export function autoCommit(
  repoPath: string,
  username: string,
  sessionId: string,
  editedFiles: string[]
): Promise<GitCommitInfo | null> {
  return withGitLock(async () => {
    if (editedFiles.length === 0) return null;

    // Add only the specific edited files (resolve relative to workspace)
    for (const filePath of editedFiles) {
      const rel = path.relative(repoPath, filePath);
      if (rel.startsWith('..')) continue; // outside workspace
      try {
        await git(repoPath, ['add', '--', rel]);
      } catch {
        // File may have been deleted or is gitignored
      }
    }

    // Check if there are staged changes
    const status = await git(repoPath, ['diff', '--cached', '--name-only']);
    if (!status) return null;

    const author = `${username} <${username}@claude-desk>`;
    const message = `auto: [${username}] Claude 작업 완료`;

    await git(repoPath, ['commit', `--author=${author}`, '-m', message]);

    return await getLastCommitInfo(repoPath, 'auto');
  });
}

export function manualCommit(
  repoPath: string,
  username: string,
  message: string
): Promise<GitCommitInfo> {
  return withGitLock(async () => {
    // Stage all tracked changes + new untracked (respecting .gitignore)
    await git(repoPath, ['add', '-A', '--ignore-errors']);

    // Check if there's anything to commit
    const status = await git(repoPath, ['diff', '--cached', '--name-only']);
    if (!status) throw new Error('변경사항이 없습니다');

    const author = `${username} <${username}@claude-desk>`;
    await git(repoPath, ['commit', `--author=${author}`, '-m', message]);

    return await getLastCommitInfo(repoPath, 'manual');
  });
}

async function getLastCommitInfo(
  repoPath: string,
  commitType: 'auto' | 'manual' | 'rollback'
): Promise<GitCommitInfo> {
  const logLine = await git(repoPath, [
    'log', '-1', '--format=%H|%h|%an|%s|%aI',
  ]);
  const [hash, shortHash, authorName, message, dateStr] = logLine.split('|');

  const diffOutput = await git(repoPath, [
    'diff-tree', '--no-commit-id', '--name-only', '-r', hash,
  ]);
  const filesChanged = diffOutput ? diffOutput.split('\n').filter(Boolean) : [];

  return { hash, shortHash, authorName, message, commitType, filesChanged, createdAt: dateStr };
}

export function getLog(
  repoPath: string,
  opts: { limit?: number; offset?: number; author?: string; filePath?: string } = {}
): Promise<GitCommitInfo[]> {
  return withGitLock(async () => {
    const limit = opts.limit || 50;
    const offset = opts.offset || 0;

    const args = [
      'log',
      `--format=%H|%h|%an|%s|%aI`,
      `--skip=${offset}`,
      `-n`, `${limit}`,
    ];

    if (opts.author) args.push(`--author=${opts.author}`);
    if (opts.filePath) args.push('--', opts.filePath);

    let output: string;
    try {
      output = await git(repoPath, args);
    } catch {
      return [];
    }

    if (!output) return [];

    const commits: GitCommitInfo[] = [];
    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('|');
      if (parts.length < 5) continue;
      const [hash, shortHash, authorName, message, dateStr] = parts;

      let commitType: 'auto' | 'manual' | 'rollback' = 'manual';
      if (message.startsWith('auto:')) commitType = 'auto';
      else if (message.startsWith('rollback:')) commitType = 'rollback';

      let filesChanged: string[] = [];
      try {
        const diffOut = await git(repoPath, [
          'diff-tree', '--no-commit-id', '--name-only', '-r', hash,
        ]);
        filesChanged = diffOut ? diffOut.split('\n').filter(Boolean) : [];
      } catch {}

      commits.push({ hash, shortHash, authorName, message, commitType, filesChanged, createdAt: dateStr });
    }

    return commits;
  });
}

export function getFileDiff(repoPath: string, hash: string): Promise<string> {
  return withGitLock(async () => {
    if (!/^[a-f0-9]{4,40}$/i.test(hash)) {
      throw new Error('Invalid commit hash');
    }
    try {
      return await git(repoPath, ['diff', `${hash}~1..${hash}`]);
    } catch {
      return await git(repoPath, ['show', '--format=', hash]);
    }
  });
}

export function rollbackToCommit(
  repoPath: string,
  hash: string,
  username: string
): Promise<GitCommitInfo> {
  return withGitLock(async () => {
    if (!/^[a-f0-9]{4,40}$/i.test(hash)) {
      throw new Error('Invalid commit hash');
    }

    await git(repoPath, ['checkout', hash, '--', '.']);
    await git(repoPath, ['add', '-A', '--ignore-errors']);

    const author = `${username} <${username}@claude-desk>`;
    const shortTarget = hash.slice(0, 7);
    const message = `rollback: [${username}] reverted to ${shortTarget}`;

    await git(repoPath, ['commit', `--author=${author}`, '-m', message]);

    return await getLastCommitInfo(repoPath, 'rollback');
  });
}

export async function getStatus(repoPath: string): Promise<{ modified: string[]; untracked: string[] }> {
  const output = await git(repoPath, ['status', '--porcelain']);
  const modified: string[] = [];
  const untracked: string[] = [];

  if (!output) return { modified, untracked };

  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2);
    const file = line.slice(3);
    if (status === '??') untracked.push(file);
    else modified.push(file);
  }

  return { modified, untracked };
}
