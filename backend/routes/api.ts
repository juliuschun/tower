import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import {
  authenticateUser, createUser, hasUsers, generateToken, verifyToken, authMiddleware, extractToken,
  adminMiddleware, listUsers, updateUserRole, updateUserPath,
  resetUserPassword, disableUser, getUserAllowedPath,
} from '../services/auth.js';
import {
  createSession, getSessions, getSession, updateSession, deleteSession,
  getArchivedSessions, restoreSession, permanentlyDeleteSession,
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
import { search } from '../services/search.js';
import { extractTextFromContent } from '../utils/text.js';
import { createTask, getTasks, getTask, updateTask, deleteTask, reorderTasks, getDistinctCwds, getArchivedTasks, restoreTask, permanentlyDeleteTask, getChildTasks } from '../services/task-manager.js';
import { removeWorktree } from '../services/worktree-manager.js';
import { broadcast } from './ws-handler.js';
import {
  createInternalShare, createExternalShare, getSharesByFile,
  getSharesWithMe, getShareByToken, revokeShare, isTokenValid,
  hasInternalShareForUser,
} from '../services/share-manager.js';
import fsPromises from 'fs/promises';
import { getDb } from '../db/schema.js';
import {
  getProjects, getProject, createProject, updateProject, deleteProject,
  moveSessionToProject, reorderProjects,
} from '../services/project-manager.js';
import {
  listGroups, createGroup, updateGroup, deleteGroup,
  addUserToGroup, removeUserFromGroup,
  getUserGroups,
  getProjectMembers, addProjectMember, removeProjectMember,
  isProjectOwner, isProjectMember, inviteGroupToProject,
} from '../services/group-manager.js';

const UPLOAD_MAX_SIZE = parseInt(process.env.UPLOAD_MAX_SIZE || '') || 50 * 1024 * 1024; // 50MB
const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.sh', '.bat', '.cmd', '.msi', '.ps1', '.jar',
  '.com', '.scr', '.vbs', '.vbe', '.wsf', '.wsh', '.pif',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    // Fix Korean/CJK filenames: multer decodes as Latin-1, re-decode as UTF-8
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, true);
  },
});

// Uploads directory for chat file attachments (saved server-side so AI can read them)
const UPLOADS_DIR = path.join(config.workspaceRoot, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const router = Router();

// ───── Auth ─────
router.get('/auth/status', (_req, res) => {
  res.json({ authEnabled: config.authEnabled, hasUsers: hasUsers() });
});

// nginx auth_request subrequest endpoint — returns 200 if valid token, 401 otherwise
// Checks: Authorization header → query param → cookie "tower_token" → 401
router.get('/auth/check', (req, res) => {
  if (!config.authEnabled) return res.sendStatus(200);
  const rawToken = extractToken(req);
  if (!rawToken) return res.sendStatus(401);
  const payload = verifyToken(rawToken);
  if (!payload) return res.sendStatus(401);
  res.sendStatus(200);
});

// Helper: set tower_token cookie alongside JSON response
function setTokenCookie(res: any, token: string) {
  res.cookie('tower_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

router.post('/auth/setup', (req, res) => {
  if (hasUsers()) return res.status(400).json({ error: 'Admin already exists' });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const user = createUser(username, password, 'admin');
  const token = generateToken({ userId: user.id, username: user.username, role: user.role });
  setTokenCookie(res, token);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const payload = authenticateUser(username, password);
  if (!payload) return res.status(401).json({ error: 'Invalid credentials' });
  const token = generateToken(payload);
  setTokenCookie(res, token);
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

// ───── Admin: System Prompts ─────
import { listSystemPrompts, upsertSystemPrompt, deleteSystemPrompt } from '../services/system-prompt.js';

router.get('/admin/system-prompts', adminMiddleware, (_req, res) => {
  res.json(listSystemPrompts());
});

router.put('/admin/system-prompts/:name', adminMiddleware, (req, res) => {
  const { name } = req.params;
  const { prompt } = req.body;
  if (!prompt && prompt !== '') return res.status(400).json({ error: 'prompt is required' });
  const result = upsertSystemPrompt(name, prompt);
  res.json(result);
});

router.delete('/admin/system-prompts/:name', adminMiddleware, (req, res) => {
  const { name } = req.params;
  const ok = deleteSystemPrompt(name);
  if (!ok) return res.status(400).json({ error: 'Cannot delete the default prompt' });
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

// ───── Admin: Groups ─────
router.get('/admin/groups', adminMiddleware, (_req, res) => {
  res.json(listGroups());
});

router.post('/admin/groups', adminMiddleware, (req, res) => {
  try {
    const { name, description, isGlobal } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const group = createGroup(name.trim(), description, isGlobal);
    res.json(group);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Group name already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/admin/groups/:id', adminMiddleware, (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const group = updateGroup(groupId, req.body);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json(group);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Group name already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/groups/:id', adminMiddleware, (req, res) => {
  const ok = deleteGroup(parseInt(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Group not found' });
  res.json({ ok: true });
});

router.post('/admin/groups/:id/users', adminMiddleware, (req, res) => {
  const groupId = parseInt(req.params.id);
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  addUserToGroup(userId, groupId);
  res.json({ ok: true });
});

router.delete('/admin/groups/:id/users/:uid', adminMiddleware, (req, res) => {
  const groupId = parseInt(req.params.id);
  const userId = parseInt(req.params.uid);
  removeUserFromGroup(userId, groupId);
  res.json({ ok: true });
});

// (project_groups endpoints removed — use project members API instead)

// ───── Sessions ─────
router.get('/sessions', (req, res) => {
  const userId = (req as any).user?.userId;
  const role = (req as any).user?.role;
  res.json(getSessions(userId, role));
});

router.post('/sessions', (req, res) => {
  const { name, cwd, projectId, engine } = req.body;
  const userId = (req as any).user?.userId;
  const session = createSession(name || `Session ${new Date().toLocaleString('en-US')}`, cwd || config.defaultCwd, userId, projectId, engine);
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

    const userText = extractTextFromContent(userMsg.content);
    const assistantText = extractTextFromContent(assistantMsg.content);

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

    // Last 20 messages, preserving user/assistant conversation order
    const recent = messages.slice(-20);
    const messagesText = recent
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const text = extractTextFromContent(m.content).trim();
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

// ───── Search (FTS5) ─────
router.get('/search', (req, res) => {
  const q = (req.query.q as string || '').trim();
  if (!q || q.length < 2) {
    return res.json([]);
  }
  const userId = (req as any).user?.userId;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  const role = (req as any).user?.role;
  const results = search(q, { userId, role, limit });
  res.json(results);
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
      } catch (commitErr) {
        console.warn('[upload] auto-commit failed (non-fatal):', commitErr);
      }
    }

    res.json({ results });
  } catch (error: any) {
    console.error('[upload] unexpected error:', error);
    res.status(500).json({ error: error.message || 'Internal upload error' });
  }
});

// ───── Chat File Upload (saves to workspace/uploads/, returns path for AI) ─────
router.post('/files/chat-upload', handleMulterUpload, async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ error: 'No files provided' });

    const results: { name: string; path: string; error?: string }[] = [];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (DANGEROUS_EXTENSIONS.has(ext)) {
        results.push({ name: file.originalname, path: '', error: `Blocked extension: ${ext}` });
        continue;
      }
      // Deduplicate: add timestamp prefix to avoid collisions
      // Allow Unicode letters/numbers (Korean, Japanese, etc.) while blocking path-unsafe chars
      const safeName = `${Date.now()}-${file.originalname.replace(/[^\p{L}\p{N}._-]/gu, '_')}`;
      const filePath = path.join(UPLOADS_DIR, safeName);
      try {
        writeFileBinary(filePath, file.buffer, config.workspaceRoot);
        results.push({ name: file.originalname, path: filePath });
      } catch (err: any) {
        results.push({ name: file.originalname, path: '', error: err.message });
      }
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

    const isDownload = req.query.download === '1';
    const fileName = path.basename(filePath);
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
      mp4: 'video/mp4',
      webm: 'video/webm',
    };

    // Download mode: stream file as attachment regardless of type
    if (isDownload) {
      const mimeType = (ext && binaryTypes[ext]) || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      // RFC 5987: filename* for proper Unicode (Korean etc.) display in browsers
      const encoded = encodeURIComponent(fileName);
      res.setHeader('Content-Disposition', `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`);
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on('error', () => res.status(404).json({ error: 'File not found' }));
      return;
    }

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
    piEnabled: config.piEnabled,
    piModels: config.piEnabled ? config.piModels : [],
  });
});

// ───── Commands ─────
router.get('/commands', (_req, res) => {
  res.json(loadCommands());
});

// ───── My Groups (for non-admin users) ─────
router.get('/my/groups', (req, res) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.json([]);
  res.json(getUserGroups(userId));
});

// ───── Projects ─────
router.get('/projects', (req, res) => {
  const userId = (req as any).user?.userId;
  const role = (req as any).user?.role;
  res.json(getProjects(userId, role));
});

router.post('/projects', (req, res) => {
  try {
    const { name, description, rootPath, color, memberIds, groupId } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const userId = (req as any).user?.userId;
    const project = createProject(name.trim(), userId, { description, rootPath, color });

    // Add individual members
    if (Array.isArray(memberIds)) {
      for (const mid of memberIds) {
        if (typeof mid === 'number' && mid !== userId) {
          addProjectMember(project.id, mid, 'member');
        }
      }
    }
    // Invite group members (snapshot copy)
    if (groupId && typeof groupId === 'number') {
      inviteGroupToProject(groupId, project.id);
    }

    res.json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/projects/:id', (req, res) => {
  try {
    const project = updateProject(req.params.id, req.body);
    if (!project) return res.status(404).json({ error: 'project not found' });
    res.json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/projects/:id', (req, res) => {
  try {
    const ok = deleteProject(req.params.id);
    if (!ok) return res.status(404).json({ error: 'project not found' });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ───── Project Members ─────

router.get('/projects/:id/members', (req, res) => {
  const userId = (req as any).user?.userId;
  const role = (req as any).user?.role;
  const projectId = req.params.id;
  // Any member, owner, or admin can view members
  if (role !== 'admin' && userId) {
    const project = getProject(projectId);
    if (!project) return res.status(404).json({ error: 'project not found' });
    if (project.userId !== userId && !isProjectMember(projectId, userId)) {
      return res.status(403).json({ error: 'not a member' });
    }
  }
  res.json(getProjectMembers(projectId));
});

router.post('/projects/:id/members', (req, res) => {
  const userId = (req as any).user?.userId;
  const role = (req as any).user?.role;
  const projectId = req.params.id;

  // Only owner or admin can add members
  if (role !== 'admin' && !isProjectOwner(projectId, userId)) {
    return res.status(403).json({ error: 'only owner or admin can add members' });
  }

  const { userId: targetUserId, groupId: targetGroupId } = req.body;

  if (targetGroupId && typeof targetGroupId === 'number') {
    const added = inviteGroupToProject(targetGroupId, projectId);
    return res.json({ ok: true, added });
  }

  if (!targetUserId || typeof targetUserId !== 'number') {
    return res.status(400).json({ error: 'userId or groupId required' });
  }

  addProjectMember(projectId, targetUserId, 'member');
  res.json({ ok: true });
});

router.delete('/projects/:id/members/:uid', (req, res) => {
  const userId = (req as any).user?.userId;
  const role = (req as any).user?.role;
  const projectId = req.params.id;
  const targetUserId = parseInt(req.params.uid);

  // Only owner or admin can remove members
  if (role !== 'admin' && !isProjectOwner(projectId, userId)) {
    return res.status(403).json({ error: 'only owner or admin can remove members' });
  }

  const ok = removeProjectMember(projectId, targetUserId);
  if (!ok) return res.status(400).json({ error: 'cannot remove last owner' });
  res.json({ ok: true });
});

// ───── User Search (for member invitation) ─────

router.get('/users/search', (req, res) => {
  const q = (req.query.q as string || '').trim();
  if (!q) return res.json([]);
  const db = getDb();
  const users = db.prepare(
    `SELECT id, username FROM users WHERE disabled = 0 AND username LIKE ? ORDER BY username LIMIT 20`
  ).all(`%${q}%`) as { id: number; username: string }[];
  res.json(users);
});

router.post('/projects/reorder', (req, res) => {
  try {
    const { projectIds } = req.body;
    if (!Array.isArray(projectIds)) return res.status(400).json({ error: 'projectIds array required' });
    reorderProjects(projectIds);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sessions/:id/move', (req, res) => {
  try {
    const { projectId } = req.body;
    const ok = moveSessionToProject(req.params.id, projectId ?? null);
    if (!ok) return res.status(404).json({ error: 'session or project not found' });
    // Broadcast so all connected clients update their session lists
    broadcast({ type: 'session_moved', sessionId: req.params.id, projectId: projectId ?? null });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ───── Kanban Tasks ─────
router.get('/tasks', (req, res) => {
  try {
    const tasks = getTasks((req as any).user?.userId, (req as any).user?.role);
    res.json(tasks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tasks/meta', (req, res) => {
  try {
    const cwds = getDistinctCwds((req as any).user?.userId);
    res.json({ cwds });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks', (req, res) => {
  try {
    const { title, description, cwd, model, scheduledAt, scheduleCron, scheduleEnabled, workflow, parentTaskId, projectId } = req.body;
    if (!title || !cwd) return res.status(400).json({ error: 'title and cwd required' });
    const schedule = (scheduledAt || scheduleCron || scheduleEnabled)
      ? { scheduledAt, scheduleCron, scheduleEnabled }
      : undefined;
    const task = createTask(title, description || '', cwd, (req as any).user?.userId, model, schedule, workflow, parentTaskId, projectId);
    // Broadcast to all connected clients so kanban boards update in real-time
    broadcast({ type: 'task_created', task });
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

router.get('/tasks/:id/children', (req, res) => {
  try {
    const children = getChildTasks(req.params.id);
    res.json(children);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks/:id/cleanup-worktree', (req, res) => {
  try {
    const task = getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'task not found' });
    if (task.status === 'in_progress') return res.status(400).json({ error: 'cannot cleanup worktree for running task' });
    if (!task.worktreePath) return res.status(400).json({ error: 'task has no worktree' });

    const ok = removeWorktree(task.worktreePath);
    if (ok) {
      updateTask(req.params.id, { worktreePath: null });
    }
    res.json({ success: ok });
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

// ── History (archived sessions + tasks) ──────────────────
router.get('/history', (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const sessions = getArchivedSessions(userId);
    const tasks = getArchivedTasks(userId);
    res.json({ sessions, tasks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sessions/:id/restore', (req, res) => {
  try {
    const ok = restoreSession(req.params.id);
    if (!ok) return res.status(404).json({ error: 'session not found' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/sessions/:id/permanent', (req, res) => {
  try {
    const ok = permanentlyDeleteSession(req.params.id);
    if (!ok) return res.status(404).json({ error: 'session not found' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks/:id/restore', (req, res) => {
  try {
    const ok = restoreTask(req.params.id);
    if (!ok) return res.status(404).json({ error: 'task not found' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/tasks/:id/permanent', (req, res) => {
  try {
    const ok = permanentlyDeleteTask(req.params.id);
    if (!ok) return res.status(404).json({ error: 'task not found' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Chat Rooms (PG) ──────────────────────────────────────────────────

router.get('/rooms', authMiddleware, async (req, res) => {
  try {
    const { isPgEnabled } = await import('../db/pg.js');
    if (!isPgEnabled()) return res.json({ rooms: [], pgEnabled: false, unreadCounts: {} });
    const { listRooms, getUnreadCounts } = await import('../services/room-manager.js');
    const userId = (req as any).user.userId;
    const [rooms, unreadMap] = await Promise.all([
      listRooms(userId),
      getUnreadCounts(userId),
    ]);
    // Convert Map to plain object for JSON serialization
    const unreadCounts: Record<string, number> = {};
    for (const [roomId, count] of unreadMap) {
      if (count > 0) unreadCounts[roomId] = count;
    }
    res.json({ rooms, pgEnabled: true, unreadCounts });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/rooms', authMiddleware, async (req, res) => {
  try {
    const { isPgEnabled } = await import('../db/pg.js');
    if (!isPgEnabled()) return res.status(503).json({ error: 'Chat rooms require PostgreSQL' });
    const { createRoom } = await import('../services/room-manager.js');
    const { name, description, roomType, projectId } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const room = await createRoom(name, description ?? null, roomType || 'team', (req as any).user.userId, projectId);
    res.json(room);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/rooms/:id', authMiddleware, async (req, res) => {
  try {
    const { getRoom, getMembers, isMember } = await import('../services/room-manager.js');
    const room = await getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const userId = (req as any).user.userId;
    if (!(await isMember(req.params.id, userId))) return res.status(403).json({ error: 'Not a member' });
    const members = await getMembers(req.params.id);
    res.json({ ...room, members });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/rooms/:id', authMiddleware, async (req, res) => {
  try {
    const { updateRoom } = await import('../services/room-manager.js');
    const room = await updateRoom(req.params.id, req.body);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/rooms/:id', authMiddleware, async (req, res) => {
  try {
    const { deleteRoom } = await import('../services/room-manager.js');
    const ok = await deleteRoom(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Room not found' });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/rooms/:id/invitable-users', authMiddleware, async (req, res) => {
  try {
    const { getMembers } = await import('../services/room-manager.js');
    const members = await getMembers(req.params.id);
    const memberUserIds = new Set(members.map(m => m.userId));

    // Get all active users from SQLite, exclude current members
    const db = (await import('../db/schema.js')).getDb();
    const allUsers = db.prepare(
      'SELECT id, username, role FROM users WHERE disabled = 0 ORDER BY username'
    ).all() as { id: number; username: string; role: string }[];

    const invitable = allUsers
      .filter(u => !memberUserIds.has(u.id))
      .map(u => ({ id: u.id, username: u.username, role: u.role }));

    res.json({ users: invitable });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/rooms/:id/members', authMiddleware, async (req, res) => {
  try {
    const { addMember, getRoom } = await import('../services/room-manager.js');
    const { userId, role } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const member = await addMember(req.params.id, userId, role);
    res.json(member);

    // Notify room members about new member (real-time update)
    try {
      const { broadcastToRoom, broadcastToUser } = await import('./ws-handler.js');
      broadcastToRoom(req.params.id, {
        type: 'room_member_added',
        roomId: req.params.id,
        member,
      });

      // Notify the invited user so they see the room in their list
      const room = await getRoom(req.params.id);
      if (room) {
        broadcastToUser(userId, {
          type: 'room_added',
          room,
        });
      }
    } catch { /* WS notification is best-effort */ }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/rooms/:id/members/:userId', authMiddleware, async (req, res) => {
  try {
    const { removeMember } = await import('../services/room-manager.js');
    const removedUserId = parseInt(req.params.userId);
    const ok = await removeMember(req.params.id, removedUserId);
    if (!ok) return res.status(404).json({ error: 'Member not found' });
    res.json({ success: true });

    // Notify room members about removed member
    try {
      const { broadcastToRoom, broadcastToUser } = await import('./ws-handler.js');
      broadcastToRoom(req.params.id, {
        type: 'room_member_removed',
        roomId: req.params.id,
        userId: removedUserId,
      });
      // Notify the removed user
      broadcastToUser(removedUserId, {
        type: 'room_removed',
        roomId: req.params.id,
      });
    } catch { /* WS notification is best-effort */ }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/rooms/:id/messages', authMiddleware, async (req, res) => {
  try {
    const { getMessages: getRoomMessages, isMember } = await import('../services/room-manager.js');
    const userId = (req as any).user.userId;
    if (!(await isMember(req.params.id, userId))) return res.status(403).json({ error: 'Not a member' });
    const messages = await getRoomMessages(req.params.id, {
      limit: parseInt(req.query.limit as string) || 50,
      before: req.query.before as string,
      after: req.query.after as string,
    });
    res.json({ messages });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const { isPgEnabled } = await import('../db/pg.js');
    if (!isPgEnabled()) return res.json({ notifications: [], unreadCount: 0 });
    const { getNotifications, getUnreadCount } = await import('../services/room-manager.js');
    const userId = (req as any).user.userId;
    const unreadOnly = req.query.unreadOnly === 'true';
    const notifications = await getNotifications(userId, { unreadOnly });
    const unreadCount = await getUnreadCount(userId);
    res.json({ notifications, unreadCount });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/notifications/:id/read', authMiddleware, async (req, res) => {
  try {
    const { markNotificationRead } = await import('../services/room-manager.js');
    await markNotificationRead(req.params.id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/notifications/read-all', authMiddleware, async (req, res) => {
  try {
    const { markAllNotificationsRead } = await import('../services/room-manager.js');
    const count = await markAllNotificationsRead((req as any).user.userId);
    res.json({ success: true, count });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
