import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import {
  authenticateUser, createUser, hasUsers, generateToken, authMiddleware,
  adminMiddleware, listUsers, updateUserRole, updateUserPath,
  resetUserPassword, disableUser, getUserAllowedPath,
} from '../services/auth.js';
import {
  createSession, getSessions, getSession, updateSession, deleteSession,
  scanClaudeNativeSessions
} from '../services/session-manager.js';
import { getFileTree, readFile, writeFile, writeFileBinary, isPathSafe, isPathWritable, createDirectory, deleteEntry, renameEntry } from '../services/file-system.js';
import fs from 'fs';
import { loadCommands } from '../services/command-loader.js';
import { getMessages } from '../services/message-store.js';
import { generateSessionName } from '../services/auto-namer.js';
import { generateSummary } from '../services/summarizer.js';
import {
  getPins, createPin, updatePin, deletePin, reorderPins,
  createPromptPin, updatePromptPin, getPromptsWithCommands,
} from '../services/pin-manager.js';
import {
  getLog, getFileDiff, manualCommit, rollbackToCommit,
  autoCommit,
} from '../services/git-manager.js';
import { config, availableModels } from '../config.js';
import { createTask, getTasks, getTask, updateTask, deleteTask, reorderTasks } from '../services/task-manager.js';
import {
  createInternalShare, createExternalShare, getSharesByFile,
  getSharesWithMe, getShareByToken, revokeShare, isTokenValid,
  hasInternalShareForUser,
} from '../services/share-manager.js';
import fsPromises from 'fs/promises';
import { getDb } from '../db/schema.js';

const UPLOAD_MAX_SIZE = parseInt(process.env.UPLOAD_MAX_SIZE || '') || 10 * 1024 * 1024; // 10MB
const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.sh', '.bat', '.cmd', '.msi', '.ps1', '.jar',
  '.com', '.scr', '.vbs', '.vbe', '.wsf', '.wsh', '.pif',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_SIZE },
});

const router = Router();

// ───── Auth ─────
router.get('/auth/status', (_req, res) => {
  res.json({ authEnabled: config.authEnabled, hasUsers: hasUsers() });
});

router.post('/auth/setup', (req, res) => {
  if (hasUsers()) return res.status(400).json({ error: 'Admin already exists' });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const user = createUser(username, password, 'admin');
  const token = generateToken({ userId: user.id, username: user.username, role: user.role });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const payload = authenticateUser(username, password);
  if (!payload) return res.status(401).json({ error: 'Invalid credentials' });
  const token = generateToken(payload);
  res.json({ token, user: payload });
});

// ───── Public: Shared file viewer (no auth required) ─────
const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

router.get('/shared/:token', async (req, res) => {
  const share = getShareByToken(req.params.token);
  if (!share || !isTokenValid(share)) {
    return res.status(410).json({ error: 'This link has expired or been revoked.' });
  }
  try {
    const fileName = path.basename(share.file_path);
    const ext = path.extname(fileName).slice(1).toLowerCase();

    // ?render=1 — 브라우저가 직접 렌더링할 수 있도록 Content-Type과 함께 파일 그대로 전송
    if (req.query.render === '1') {
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      const buffer = await fsPromises.readFile(share.file_path);
      return res.send(buffer);
    }

    // ?download=1 — 파일 다운로드
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      const buffer = await fsPromises.readFile(share.file_path);
      return res.send(buffer);
    }

    // 기본 — JSON으로 콘텐츠 반환
    // 바이너리 파일(PDF, 이미지, 영상)은 utf-8 읽기 불가 → 메타데이터만 반환 (프론트에서 iframe으로 렌더링)
    const BINARY_EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm']);
    if (BINARY_EXTS.has(ext)) {
      return res.json({ content: '', fileName, ext });
    }
    const content = await fsPromises.readFile(share.file_path, 'utf-8');
    res.json({ content, fileName, ext });
  } catch {
    return res.status(404).json({ error: 'File not found.' });
  }
});

// ───── Protected routes ─────
router.use(authMiddleware);

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0', publicUrl: config.publicUrl || null });
});

// ─── Browser proxy (PinchTab) ────────────────────────────────────────────────
const PINCHTAB_BASE = process.env.PINCHTAB_URL || 'http://localhost:9867';

function pinchtabHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(process.env.PINCHTAB_TOKEN
      ? { Authorization: `Bearer ${process.env.PINCHTAB_TOKEN}` }
      : {}),
  };
}

router.get('/browser/health', async (_req, res) => {
  try {
    const r = await fetch(`${PINCHTAB_BASE}/health`, { headers: pinchtabHeaders() });
    res.json({ ok: r.ok, status: r.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: message });
  }
});

router.post('/browser/navigate', async (req, res) => {
  try {
    const r = await fetch(`${PINCHTAB_BASE}/navigate`, {
      method: 'POST',
      headers: pinchtabHeaders(),
      body: JSON.stringify(req.body),
    });
    res.json(await r.json());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.get('/browser/text', async (_req, res) => {
  try {
    const r = await fetch(`${PINCHTAB_BASE}/text`, { headers: pinchtabHeaders() });
    res.json({ text: await r.text() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.get('/browser/snapshot', async (req, res) => {
  const filter = (req.query.filter as string) || 'interactive';
  try {
    const r = await fetch(`${PINCHTAB_BASE}/snapshot?filter=${filter}&format=compact`, {
      headers: pinchtabHeaders(),
    });
    res.json({ snapshot: await r.text() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.post('/browser/action', async (req, res) => {
  try {
    const r = await fetch(`${PINCHTAB_BASE}/action`, {
      method: 'POST',
      headers: pinchtabHeaders(),
      body: JSON.stringify(req.body),
    });
    res.json(await r.json());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.get('/browser/screenshot', async (_req, res) => {
  try {
    const r = await fetch(`${PINCHTAB_BASE}/screenshot`, { headers: pinchtabHeaders() });
    const buf = Buffer.from(await r.arrayBuffer());
    res.set('Content-Type', 'image/jpeg');
    res.send(buf);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

// ───── Users list (for share modal dropdown) ─────
router.get('/users', (req, res) => {
  const currentUserId = (req as any).user?.userId;
  const users = getDb()
    .prepare('SELECT id, username FROM users WHERE disabled = 0 ORDER BY username')
    .all()
    .filter((u: any) => u.id !== currentUserId);
  res.json(users);
});

// ───── Shares ─────
router.post('/shares', (req, res) => {
  const { shareType, filePath, targetUserId, expiresIn } = req.body;
  const ownerId = (req as any).user?.userId;
  if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  try {
    if (shareType === 'internal') {
      if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
      const share = createInternalShare(filePath, ownerId, targetUserId);
      return res.json(share);
    } else if (shareType === 'external') {
      const share = createExternalShare(filePath, ownerId, expiresIn || '24h');
      const url = `/shared/${share.token}`;
      return res.json({ ...share, url });
    } else {
      return res.status(400).json({ error: 'shareType must be internal or external' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// IMPORTANT: register /shares/with-me BEFORE /shares/:id to avoid Express matching 'with-me' as :id
router.get('/shares/with-me', (req, res) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  res.json(getSharesWithMe(userId));
});

router.get('/shares', (req, res) => {
  const ownerId = (req as any).user?.userId;
  const filePath = req.query.filePath as string;
  if (!ownerId || !filePath) return res.status(400).json({ error: 'filePath required' });
  res.json(getSharesByFile(filePath, ownerId));
});

router.delete('/shares/:id', (req, res) => {
  const ownerId = (req as any).user?.userId;
  if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });
  const ok = revokeShare(req.params.id, ownerId);
  if (!ok) return res.status(404).json({ error: 'Share not found or no permission to revoke.' });
  res.json({ ok: true });
});

// ───── Admin: User Management ─────
router.get('/admin/users', adminMiddleware, (_req, res) => {
  res.json(listUsers());
});

router.post('/admin/users', adminMiddleware, (req, res) => {
  const { username, password, role, allowed_path } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  try {
    const user = createUser(username, password, role || 'member');
    if (allowed_path !== undefined) updateUserPath(user.id, allowed_path);
    res.json({ ...user, allowed_path: allowed_path || '' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: error.message });
  }
});

router.patch('/admin/users/:id', adminMiddleware, (req, res) => {
  const userId = parseInt(req.params.id as string);
  const currentUser = (req as any).user;
  const { role, allowed_path } = req.body;
  if (role !== undefined) {
    if (currentUser.userId === userId) return res.status(403).json({ error: 'Cannot change own role' });
    updateUserRole(userId, role);
  }
  if (allowed_path !== undefined) updateUserPath(userId, allowed_path);
  res.json({ ok: true });
});

router.patch('/admin/users/:id/password', adminMiddleware, (req, res) => {
  const userId = parseInt(req.params.id as string);
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  resetUserPassword(userId, password);
  res.json({ ok: true });
});

router.delete('/admin/users/:id', adminMiddleware, (req, res) => {
  const userId = parseInt(req.params.id as string);
  const currentUser = (req as any).user;
  if (currentUser.userId === userId) return res.status(403).json({ error: 'Cannot delete yourself' });
  disableUser(userId);
  res.json({ ok: true });
});

// ───── Sessions ─────
router.get('/sessions', (req, res) => {
  const userId = (req as any).user?.userId;
  res.json(getSessions(userId));
});

router.post('/sessions', (req, res) => {
  const { name, cwd } = req.body;
  const userId = (req as any).user?.userId;
  const session = createSession(name || `Session ${new Date().toLocaleString('en-US')}`, cwd || config.defaultCwd, userId);
  res.json(session);
});

router.get('/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

router.patch('/sessions/:id', (req, res) => {
  const { name, tags, favorite, totalCost, totalTokens, claudeSessionId, autoNamed, cwd } = req.body;
  const updates: any = { name, tags, favorite, totalCost, totalTokens, claudeSessionId };
  if (autoNamed !== undefined) updates.autoNamed = autoNamed;
  if (cwd !== undefined) {
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      return res.status(400).json({ error: 'Invalid directory path' });
    }
    updates.cwd = cwd;
  }
  updateSession(req.params.id, updates);
  res.json({ ok: true });
});

// Auto-name session based on first messages
router.post('/sessions/:id/auto-name', async (req, res) => {
  try {
    const messages = getMessages(req.params.id);
    const userMsg = messages.find((m) => m.role === 'user');
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    if (!userMsg || !assistantMsg) {
      return res.status(400).json({ error: 'Need at least one user and assistant message' });
    }

    // Extract text from content
    const extractText = (content: string): string => {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join(' ');
        }
        return content;
      } catch {
        return content;
      }
    };

    const userText = extractText(userMsg.content);
    const assistantText = extractText(assistantMsg.content);

    const name = await generateSessionName(userText, assistantText);
    updateSession(req.params.id, { name, autoNamed: 1 } as any);
    res.json({ ok: true, name });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Summarize session
router.post('/sessions/:id/summarize', async (req, res) => {
  try {
    const messages = getMessages(req.params.id);
    if (messages.length === 0) {
      return res.status(400).json({ error: 'No messages to summarize' });
    }

    const extractText = (content: string): string => {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join(' ');
        }
        return content;
      } catch {
        return content;
      }
    };

    // Last 20 messages, preserving user/assistant conversation order
    const recent = messages.slice(-20);
    const messagesText = recent
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const text = extractText(m.content).trim();
        if (!text) return null;
        const label = m.role === 'user' ? 'User' : 'AI';
        return `${label}: ${text.slice(0, 400)}`;
      })
      .filter(Boolean)
      .join('\n');

    console.log('[summarize] sessionId:', req.params.id);
    console.log('[summarize] messages count:', messages.length);
    console.log('[summarize] filtered count:', recent.filter((m) => m.role === 'user' || m.role === 'assistant').length);
    console.log('[summarize] messagesText length:', messagesText.length);
    console.log('[summarize] messagesText preview:', messagesText.slice(0, 300));

    const summary = await generateSummary(messagesText);

    // Get current session to read turnCount
    const session = getSession(req.params.id);
    const turnCount = session?.turnCount ?? 0;
    updateSession(req.params.id, { summary, summaryAtTurn: turnCount });
    res.json({ ok: true, summary, summaryAtTurn: turnCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/sessions/:id', (req, res) => {
  const deleted = deleteSession(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });
});

// Claude native sessions (read-only)
router.get('/claude-sessions', (_req, res) => {
  res.json(scanClaudeNativeSessions());
});

// ───── Session Messages ─────
router.get('/sessions/:id/messages', (req, res) => {
  try {
    const messages = getMessages(req.params.id);
    res.json(messages);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ───── Directories ─────
router.get('/directories', (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const userRoot = userId ? getUserAllowedPath(userId) : config.workspaceRoot;
    const dirPath = (req.query.path as string) || userRoot;
    if (!isPathSafe(dirPath, userRoot)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return res.status(400).json({ error: 'Invalid directory path' });
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => ({
        name: d.name,
        path: dirPath === '/' ? `/${d.name}` : `${dirPath}/${d.name}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ path: dirPath, entries });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ───── Files ─────
router.get('/files/tree', (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const userRoot = userId ? getUserAllowedPath(userId) : config.workspaceRoot;
    const dirPath = (req.query.path as string) || userRoot;
    if (!isPathSafe(dirPath, userRoot)) return res.status(403).json({ error: 'Access denied: outside allowed path' });
    const entries = getFileTree(dirPath);
    res.json({ path: dirPath, entries });
  } catch (error: any) {
    res.status(403).json({ error: error.message });
  }
});

router.get('/files/read', (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const userId = (req as any).user?.userId;
    const userRoot = userId ? getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(filePath, userRoot)) {
      if (!userId || !hasInternalShareForUser(filePath, userId)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      // internal share found — allow read to continue
    }
    const result = readFile(filePath);
    res.json({ path: filePath, ...result });
  } catch (error: any) {
    res.status(403).json({ error: error.message });
  }
});

router.post('/files/write', (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) return res.status(400).json({ error: 'path and content required' });
    const userId = (req as any).user?.userId;
    const userRoot = userId ? getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(filePath, userRoot)) return res.status(403).json({ error: 'Access denied' });
    writeFile(filePath, content);
    res.json({ ok: true, path: filePath });
  } catch (error: any) {
    res.status(403).json({ error: error.message });
  }
});

// ───── File Upload ─────
// Wrap multer to catch errors (e.g. file size limit) and return JSON instead of HTML
const handleMulterUpload = (req: any, res: any, next: any) => {
  upload.array('files', 20)(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `File too large (max ${UPLOAD_MAX_SIZE / 1024 / 1024}MB)` });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(413).json({ error: 'Too many files (max 20)' });
      }
      return res.status(400).json({ error: err.message || 'Upload error' });
    }
    next();
  });
};
router.post('/files/upload', handleMulterUpload, async (req, res) => {
  try {
    const targetDir = req.body.targetDir as string;
    if (!targetDir) return res.status(400).json({ error: 'targetDir required' });
    const userId = (req as any).user?.userId;
    const userRoot = userId ? getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(targetDir, userRoot)) return res.status(403).json({ error: 'Access denied: target directory outside allowed path' });

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ error: 'No files provided' });

    const results: { name: string; path: string; error?: string }[] = [];
    const savedPaths: string[] = [];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (DANGEROUS_EXTENSIONS.has(ext)) {
        results.push({ name: file.originalname, path: '', error: `Blocked extension: ${ext}` });
        continue;
      }
      const filePath = path.join(targetDir, file.originalname);
      if (!isPathSafe(filePath, userRoot)) {
        results.push({ name: file.originalname, path: '', error: 'Access denied' });
        continue;
      }
      try {
        // Use binary write for all uploads — preserves PDFs, images, etc.
        writeFileBinary(filePath, file.buffer);
        results.push({ name: file.originalname, path: filePath });
        savedPaths.push(filePath);
      } catch (err: any) {
        results.push({ name: file.originalname, path: '', error: err.message });
      }
    }

    // Auto-commit uploaded files
    if (config.gitAutoCommit && savedPaths.length > 0) {
      try {
        const username = (req as any).user?.username || 'anonymous';
        await autoCommit(config.workspaceRoot, username, 'upload', savedPaths);
      } catch {}
    }

    res.json({ results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ───── File Management (create / mkdir / delete / rename) ─────
router.post('/files/create', (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const userId = (req as any).user?.userId;
    const userRoot = userId ? getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(filePath, userRoot)) return res.status(403).json({ error: 'Access denied' });
    if (fs.existsSync(filePath)) return res.status(409).json({ error: 'File already exists' });
    writeFile(filePath, content || '');
    res.json({ ok: true, path: filePath });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/files/mkdir', (req, res) => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath) return res.status(400).json({ error: 'path required' });
    const userId = (req as any).user?.userId;
    const userRoot = userId ? getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(dirPath, userRoot)) return res.status(403).json({ error: 'Access denied' });
    if (fs.existsSync(dirPath)) return res.status(409).json({ error: 'Directory already exists' });
    createDirectory(dirPath);
    res.json({ ok: true, path: dirPath });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/files/delete', (req, res) => {
  try {
    const { path: targetPath } = req.body;
    if (!targetPath) return res.status(400).json({ error: 'path required' });
    const userId = (req as any).user?.userId;
    const userRoot = userId ? getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(targetPath, userRoot)) return res.status(403).json({ error: 'Access denied' });
    deleteEntry(targetPath);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/files/rename', (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) return res.status(400).json({ error: 'oldPath and newPath required' });
    const userId = (req as any).user?.userId;
    const userRoot = userId ? getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(oldPath, userRoot)) return res.status(403).json({ error: 'Access denied' });
    if (!isPathSafe(newPath, userRoot)) return res.status(403).json({ error: 'Access denied' });
    renameEntry(oldPath, newPath);
    res.json({ ok: true, path: newPath });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ───── Pins ─────
router.get('/pins', (req, res) => {
  const userId = (req as any).user?.userId;
  res.json(getPins(userId));
});

router.post('/pins', (req, res) => {
  const { title, filePath, fileType } = req.body;
  if (!title || !filePath) return res.status(400).json({ error: 'title and filePath required' });
  const userId = (req as any).user?.userId;
  const pin = createPin(title, filePath, fileType || 'markdown', userId);
  res.json(pin);
});

router.patch('/pins/:id', (req, res) => {
  const { title, sortOrder } = req.body;
  updatePin(parseInt(req.params.id as string), { title, sortOrder });
  res.json({ ok: true });
});

router.delete('/pins/:id', (req, res) => {
  deletePin(parseInt(req.params.id as string));
  res.json({ ok: true });
});

router.post('/pins/reorder', (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds array required' });
  reorderPins(orderedIds);
  res.json({ ok: true });
});

// ───── File Serve (for pin iframe) ─────
router.get('/files/serve', (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const userId = (req as any).user?.userId;
    const userRoot = userId ? getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(filePath, userRoot)) return res.status(403).json({ error: 'Access denied' });

    const ext = filePath.split('.').pop()?.toLowerCase();
    const binaryTypes: Record<string, string> = {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      ico: 'image/x-icon',
      svg: 'image/svg+xml',
    };

    if (ext && binaryTypes[ext]) {
      res.setHeader('Content-Type', binaryTypes[ext]);
      res.setHeader('Content-Disposition', 'inline');
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on('error', () => res.status(404).json({ error: 'File not found' }));
      return;
    }

    const result = readFile(filePath);
    if (ext === 'html' || ext === 'htm') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(result.content);
    } else {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(result.content);
    }
  } catch (error: any) {
    res.status(403).json({ error: error.message });
  }
});

// ───── Prompts ─────
router.get('/prompts', (req, res) => {
  const userId = (req as any).user?.userId;
  res.json(getPromptsWithCommands(userId));
});

router.post('/prompts', (req, res) => {
  const { title, content } = req.body;
  if (!title || content === undefined) return res.status(400).json({ error: 'title and content required' });
  const userId = (req as any).user?.userId;
  const pin = createPromptPin(title, content, userId);
  res.json(pin);
});

router.patch('/prompts/:id', (req, res) => {
  const { title, content } = req.body;
  updatePromptPin(parseInt(req.params.id as string), { title, content });
  res.json({ ok: true });
});

router.delete('/prompts/:id', (req, res) => {
  deletePin(parseInt(req.params.id as string));
  res.json({ ok: true });
});

// ───── Git ─────
router.get('/git/log', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const author = req.query.author as string | undefined;
    const commits = await getLog(config.workspaceRoot, { limit, offset, author });
    res.json(commits);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/git/diff/:hash', async (req, res) => {
  try {
    const diff = await getFileDiff(config.workspaceRoot, req.params.hash);
    res.json({ diff });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/git/commit', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const username = (req as any).user?.username || 'anonymous';
    const commit = await manualCommit(config.workspaceRoot, username, message);
    res.json(commit);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/git/rollback', async (req, res) => {
  try {
    const { hash } = req.body;
    if (!hash) return res.status(400).json({ error: 'hash required' });
    const username = (req as any).user?.username || 'anonymous';
    const commit = await rollbackToCommit(config.workspaceRoot, hash, username);
    res.json(commit);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ───── Config ─────
router.get('/config', (_req, res) => {
  res.json({
    version: '0.1.0',
    workspaceRoot: config.workspaceRoot,
    permissionMode: config.permissionMode,
    claudeExecutable: config.claudeExecutable,
    models: availableModels,
    connectionType: 'MAX',
  });
});

// ───── Commands ─────
router.get('/commands', (_req, res) => {
  res.json(loadCommands());
});

// ───── Kanban Tasks ─────
router.get('/tasks', (req, res) => {
  try {
    const tasks = getTasks((req as any).user?.id);
    res.json(tasks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks', (req, res) => {
  try {
    const { title, description, cwd } = req.body;
    if (!title || !cwd) return res.status(400).json({ error: 'title and cwd required' });
    const task = createTask(title, description || '', cwd, (req as any).user?.id);
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/tasks/:id', (req, res) => {
  try {
    const task = updateTask(req.params.id, req.body);
    if (!task) return res.status(404).json({ error: 'task not found' });
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/tasks/:id', (req, res) => {
  try {
    const ok = deleteTask(req.params.id);
    if (!ok) return res.status(404).json({ error: 'task not found' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks/reorder', (req, res) => {
  try {
    const { taskIds, status } = req.body;
    if (!taskIds || !status) return res.status(400).json({ error: 'taskIds and status required' });
    reorderTasks(taskIds, status);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
