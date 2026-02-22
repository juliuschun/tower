import { Router } from 'express';
import {
  authenticateUser, createUser, hasUsers, generateToken, authMiddleware
} from '../services/auth.js';
import {
  createSession, getSessions, getSession, updateSession, deleteSession,
  scanClaudeNativeSessions
} from '../services/session-manager.js';
import { getFileTree, readFile, writeFile, isPathSafe } from '../services/file-system.js';
import { loadCommands } from '../services/command-loader.js';
import { getMessages } from '../services/message-store.js';
import { getPins, createPin, updatePin, deletePin, reorderPins } from '../services/pin-manager.js';
import { config } from '../config.js';

const router = Router();

// ───── Auth ─────
router.get('/auth/status', (_req, res) => {
  res.json({ authEnabled: config.authEnabled, hasUsers: hasUsers() });
});

router.post('/auth/setup', (req, res) => {
  if (hasUsers()) return res.status(400).json({ error: 'Admin already exists' });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
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

// ───── Protected routes ─────
router.use(authMiddleware);

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// ───── Sessions ─────
router.get('/sessions', (req, res) => {
  const userId = (req as any).user?.userId;
  res.json(getSessions(userId));
});

router.post('/sessions', (req, res) => {
  const { name, cwd } = req.body;
  const userId = (req as any).user?.userId;
  const session = createSession(name || `세션 ${new Date().toLocaleString('ko-KR')}`, cwd || config.defaultCwd, userId);
  res.json(session);
});

router.get('/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

router.patch('/sessions/:id', (req, res) => {
  const { name, tags, favorite, totalCost, totalTokens, claudeSessionId } = req.body;
  updateSession(req.params.id, { name, tags, favorite, totalCost, totalTokens, claudeSessionId });
  res.json({ ok: true });
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

// ───── Files ─────
router.get('/files/tree', (req, res) => {
  try {
    const dirPath = (req.query.path as string) || config.workspaceRoot;
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
    writeFile(filePath, content);
    res.json({ ok: true, path: filePath });
  } catch (error: any) {
    res.status(403).json({ error: error.message });
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
  updatePin(parseInt(req.params.id), { title, sortOrder });
  res.json({ ok: true });
});

router.delete('/pins/:id', (req, res) => {
  deletePin(parseInt(req.params.id));
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
    if (!isPathSafe(filePath)) return res.status(403).json({ error: 'Access denied' });
    const result = readFile(filePath);
    const ext = filePath.split('.').pop()?.toLowerCase();
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

// ───── Config ─────
router.get('/config', (_req, res) => {
  res.json({
    version: '0.1.0',
    workspaceRoot: config.workspaceRoot,
    permissionMode: config.permissionMode,
    claudeExecutable: config.claudeExecutable,
  });
});

// ───── Commands ─────
router.get('/commands', (_req, res) => {
  res.json(loadCommands());
});

export default router;
