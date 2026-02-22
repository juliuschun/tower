import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import {
  authenticateUser, createUser, hasUsers, generateToken, authMiddleware
} from '../services/auth.js';
import {
  createSession, getSessions, getSession, updateSession, deleteSession,
  scanClaudeNativeSessions
} from '../services/session-manager.js';
import { getFileTree, readFile, writeFile, isPathSafe } from '../services/file-system.js';
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

    // 최근 20개 메시지, user/assistant 대화 순서 유지
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
    const dirPath = (req.query.path as string) || '/';
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

// ───── File Upload ─────
router.post('/files/upload', upload.array('files', 20), async (req, res) => {
  try {
    const targetDir = req.body.targetDir as string;
    if (!targetDir) return res.status(400).json({ error: 'targetDir required' });
    if (!isPathSafe(targetDir)) return res.status(403).json({ error: 'Access denied: target directory outside workspace' });

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
      if (!isPathSafe(filePath)) {
        results.push({ name: file.originalname, path: '', error: 'Access denied' });
        continue;
      }
      try {
        writeFile(filePath, file.buffer.toString('utf-8'));
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
  updatePromptPin(parseInt(req.params.id), { title, content });
  res.json({ ok: true });
});

router.delete('/prompts/:id', (req, res) => {
  deletePin(parseInt(req.params.id));
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

export default router;
