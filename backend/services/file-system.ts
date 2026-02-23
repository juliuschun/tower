import fs from 'fs';
import path from 'path';
import { watch, type FSWatcher } from 'chokidar';
import { config } from '../config.js';

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
  extension?: string;
}

export function isPathSafe(targetPath: string, root?: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(root || '/');
  return resolvedTarget.startsWith(resolvedRoot);
}

export function isPathWritable(targetPath: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(config.workspaceRoot);
  return resolvedTarget.startsWith(resolvedRoot);
}

export function getFileTree(dirPath: string, depth = 2): FileEntry[] {
  if (!isPathSafe(dirPath)) {
    throw new Error('Access denied: path outside workspace');
  }

  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const entries: FileEntry[] = [];

    for (const item of items) {
      if (config.hiddenPatterns.some(p => item.name === p || item.name.startsWith('.'))) {
        continue;
      }

      const fullPath = path.join(dirPath, item.name);
      const entry: FileEntry = {
        name: item.name,
        path: fullPath,
        isDirectory: item.isDirectory(),
      };

      if (!item.isDirectory()) {
        try {
          const stat = fs.statSync(fullPath);
          entry.size = stat.size;
          entry.modified = stat.mtime.toISOString();
          entry.extension = path.extname(item.name).slice(1);
        } catch {}
      }

      entries.push(entry);
    }

    return entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch (error: any) {
    throw new Error(`Cannot read directory: ${error.message}`);
  }
}

export function readFile(filePath: string): { content: string; language: string } {
  if (!isPathSafe(filePath)) {
    throw new Error('Access denied: path outside workspace');
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).slice(1);
  const languageMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml',
    html: 'html', css: 'css', sh: 'shell', bash: 'shell',
    sql: 'sql', rs: 'rust', go: 'go', java: 'java',
    txt: 'text', csv: 'text', log: 'text',
  };

  return { content, language: languageMap[ext] || 'text' };
}

export function writeFile(filePath: string, content: string): void {
  if (!isPathWritable(filePath)) {
    throw new Error('Access denied: path outside workspace');
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

// ───── File Watcher (chokidar) ─────

let watcher: FSWatcher | null = null;

export type FileChangeEvent = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
export type FileChangeCallback = (event: FileChangeEvent, filePath: string) => void;

export function setupFileWatcher(rootPath: string, onChange: FileChangeCallback): void {
  if (watcher) return;

  watcher = watch(rootPath, {
    ignored: [
      '**/node_modules/**',
      '**/.git/**',
      '**/__pycache__/**',
      '**/.venv/**',
      '**/dist/**',
      '**/data/**',
      '**/.claude/**',
      '**/.claude.json*',
    ],
    depth: 3,
    ignoreInitial: true,
    persistent: true,
  });

  const events: FileChangeEvent[] = ['add', 'change', 'unlink', 'addDir', 'unlinkDir'];
  for (const event of events) {
    watcher.on(event, (filePath: string) => {
      onChange(event, filePath);
    });
  }

  watcher.on('error', (err: unknown) => {
    console.error('[FileWatcher] error:', err instanceof Error ? err.message : err);
  });

  console.log(`[FileWatcher] watching ${rootPath}`);
}

export function stopFileWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
    console.log('[FileWatcher] stopped');
  }
}
