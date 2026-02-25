import fs from 'fs';
import path from 'path';
import { watch, type FSWatcher } from 'chokidar';
import { config } from '../config.js';

function fixKoreanFilename(name: string): string {
  // Detect double-encoded UTF-8: latin1 bytes re-encoded as UTF-8
  // e.g. 도 (E1 84 83 E1 85 A9) stored as (C3A1 C284 C283 C3A1 C285 C2A9)
  if (/[\u00c0-\u00ff][\u0080-\u00bf]/.test(name)) {
    try {
      return Buffer.from(name, 'latin1').toString('utf-8').normalize('NFC');
    } catch { /* fall through */ }
  }
  return name.normalize('NFC');
}

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

      // Fix Korean filenames: double-encoded UTF-8 (latin1→utf8) + NFD→NFC normalize
      const displayName = fixKoreanFilename(item.name);
      const fullPath = path.join(dirPath, item.name);
      const entry: FileEntry = {
        name: displayName,
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

const BINARY_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg']);

export function readFile(filePath: string): { content: string; language: string; encoding?: string } {
  if (!isPathSafe(filePath)) {
    throw new Error('Access denied: path outside workspace');
  }

  const ext = path.extname(filePath).slice(1).toLowerCase();
  const languageMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml',
    html: 'html', css: 'css', sh: 'shell', bash: 'shell',
    sql: 'sql', rs: 'rust', go: 'go', java: 'java',
    txt: 'text', csv: 'text', log: 'text',
    pdf: 'pdf',
  };

  if (BINARY_EXTENSIONS.has(ext)) {
    const content = fs.readFileSync(filePath).toString('base64');
    return { content, language: languageMap[ext] || 'binary', encoding: 'base64' };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
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

export function writeFileBinary(filePath: string, buffer: Buffer): void {
  if (!isPathWritable(filePath)) {
    throw new Error('Access denied: path outside workspace');
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, buffer);
}

export function createDirectory(dirPath: string): void {
  if (!isPathWritable(dirPath)) {
    throw new Error('Access denied: path outside workspace');
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

export function deleteEntry(targetPath: string): void {
  if (!isPathWritable(targetPath)) {
    throw new Error('Access denied: path outside workspace');
  }
  if (!fs.existsSync(targetPath)) {
    throw new Error('Path does not exist');
  }
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(targetPath);
  }
}

export function renameEntry(oldPath: string, newPath: string): void {
  if (!isPathWritable(oldPath)) {
    throw new Error('Access denied: source path outside workspace');
  }
  if (!isPathWritable(newPath)) {
    throw new Error('Access denied: target path outside workspace');
  }
  if (!fs.existsSync(oldPath)) {
    throw new Error('Source path does not exist');
  }
  if (fs.existsSync(newPath)) {
    throw new Error('Target path already exists');
  }
  fs.renameSync(oldPath, newPath);
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
