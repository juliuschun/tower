import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import {
  authenticateUser, createUser, hasUsers, generateToken, verifyToken, authMiddleware, extractToken,
  adminMiddleware, listUsers, updateUserRole, updateUserPath,
  resetUserPassword, disableUser, getUserAllowedPath,
} from '../services/auth.js';
import {
  createSession, getSessions, getSession, updateSession, deleteSession,
  getArchivedSessions, restoreSession, permanentlyDeleteSession,
  scanClaudeNativeSessions, getPanelSessions, getSessionPanelSessions,
} from '../services/session-manager.js';
import { getFileTree, getFileTreeAsync, invalidateTreeCache, readFile, writeFile, writeFileBinary, isPathSafe, isPathWritable, createDirectory, deleteEntry, renameEntry } from '../services/file-system.js';
import fs from 'fs';
import { loadCommands } from '../services/command-loader.js';
import { getCommandsForUser, listSkills, getSkill, createSkill, updateSkill, deleteSkill, setUserSkillPref, getUserSkillPref } from '../services/skill-registry.js';
import { getMessages, getMessagesPaginated } from '../services/message-store.js';
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
import { config, availableModels, loadModelsFile, saveModelsFile, reloadModels } from '../config.js';
import { oauthManager, messageRouter, telegramLinkManager } from '../services/messaging/index.js';
import { exchangeKakaoCode, getKakaoProfile } from 'notify-hub';
import { isGoogleOAuthConfigured, getGoogleAuthUrl, exchangeGoogleCode, getGoogleUserInfo } from '../services/google-oauth.js';
import { parseTelegramWebhook, TelegramChannel } from 'notify-hub';
import { search } from '../services/search.js';
import { extractTextFromContent } from '../utils/text.js';
import { createTask, getTasks, getTask, updateTask, deleteTask, reorderTasks, getDistinctCwds, getArchivedTasks, restoreTask, permanentlyDeleteTask, getChildTasks, backfillTaskProjects } from '../services/task-manager.js';
import { removeWorktree } from '../services/worktree-manager.js';
import { broadcast, broadcastToAll, broadcastToUser } from './ws-handler.js';
import {
  createInternalShare, createExternalShare, getSharesByFile,
  getSharesWithMe, getShareByToken, revokeShare, isTokenValid,
  hasInternalShareForUser,
} from '../services/share-manager.js';
import fsPromises from 'fs/promises';
import { query, queryOne } from '../db/pg-repo.js';
import {
  getProjects, getProject, createProject, updateProject, deleteProject,
  moveSessionToProject, reorderProjects,
} from '../services/project-manager.js';
import {
  listSpaces, createSpace, updateSpace, deleteSpace,
} from '../services/space-manager.js';
import {
  listGroups, createGroup, updateGroup, deleteGroup,
  addUserToGroup, removeUserFromGroup,
  getUserGroups,
  getProjectMembers, addProjectMember, removeProjectMember,
  isProjectOwner, isProjectMember, inviteGroupToProject,
} from '../services/group-manager.js';
import {
  canAccessSession, canDeleteSession, canAccessRoom, canAccessTask, canCreateInProject, isPathAccessible,
} from '../services/project-access.js';
import {
  createInternalSessionShare, createExternalSessionShare,
  getSharesBySession, getSessionSharesWithMe,
  getSessionShareByToken, revokeSessionShare, isSessionShareValid,
} from '../services/session-share-manager.js';

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

// Temp uploads: files land here first, move to permanent uploads/ on message send
const TEMP_UPLOADS_DIR = path.join(config.workspaceRoot, '.temp-uploads');
if (!fs.existsSync(TEMP_UPLOADS_DIR)) {
  fs.mkdirSync(TEMP_UPLOADS_DIR, { recursive: true });
}

// Startup cleanup: delete temp files older than 7 days
(function cleanupOldTempUploads() {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  try {
    const scanDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
          try { if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath); } catch {}
        } else {
          try {
            const stat = fs.statSync(fullPath);
            if (now - stat.mtimeMs > SEVEN_DAYS_MS) {
              fs.unlinkSync(fullPath);
            }
          } catch {}
        }
      }
    };
    scanDir(TEMP_UPLOADS_DIR);
    console.log('[startup] cleaned up old temp uploads');
  } catch (err) {
    console.warn('[startup] temp upload cleanup error:', err);
  }
})();

const router = Router();

// ───── Auth ─────
router.get('/auth/status', async (_req, res) => {
  res.json({ authEnabled: config.authEnabled, hasUsers: await hasUsers() });
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
    maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
  });
}

router.post('/auth/setup', async (req, res) => {
  if (await hasUsers()) return res.status(400).json({ error: 'Admin already exists' });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const user = await createUser(username, password, 'admin');
  const token = generateToken({ userId: user.id, username: user.username, role: user.role });
  setTokenCookie(res, token);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const payload = await authenticateUser(username, password);
  if (!payload) return res.status(401).json({ error: 'Invalid credentials' });
  const token = generateToken(payload);
  setTokenCookie(res, token);
  res.json({ token, user: payload });
});

// ───── Kakao OAuth ─────

router.get('/auth/kakao', authMiddleware, (_req, res) => {
  if (!config.kakaoRestKey) return res.status(500).json({ error: 'Kakao not configured' });

  const url = `https://kauth.kakao.com/oauth/authorize?` +
    `client_id=${config.kakaoRestKey}` +
    `&redirect_uri=${encodeURIComponent(config.kakaoRedirectUri)}` +
    `&response_type=code` +
    `&scope=talk_message,profile_nickname`;

  res.json({ url });
});

router.get('/auth/kakao/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing authorization code');

    // Extract user from tower_token cookie or query
    const rawToken = extractToken(req);
    const payload = rawToken ? verifyToken(rawToken) : null;
    if (!payload) {
      const baseUrl = config.publicUrl || `${req.protocol}://${req.get('host')}`;
      return res.redirect(`${baseUrl}/?oauth=kakao&status=error&message=not_authenticated`);
    }

    // Exchange code for tokens
    const tokens = await exchangeKakaoCode(code as string, {
      clientId: config.kakaoRestKey,
      clientSecret: config.kakaoClientSecret,
      redirectUri: config.kakaoRedirectUri,
    });

    // Get Kakao user profile
    const profile = await getKakaoProfile(tokens.accessToken);

    // Save tokens to DB
    await oauthManager.saveToken({
      userId: payload.userId,
      provider: 'kakao',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      refreshExpiresIn: tokens.refreshExpiresIn,
      providerUserId: profile.id,
      providerNickname: profile.nickname,
    });

    // Redirect back to Tower Settings with success
    const baseUrl = config.publicUrl || `${req.protocol}://${req.get('host')}`;
    res.redirect(`${baseUrl}/?oauth=kakao&status=success`);
  } catch (err: any) {
    console.error('[Kakao OAuth] Error:', err.message);
    const baseUrl = config.publicUrl || `${req.protocol}://${req.get('host')}`;
    res.redirect(`${baseUrl}/?oauth=kakao&status=error&message=${encodeURIComponent(err.message)}`);
  }
});

// ───── Google OAuth ─────

router.get('/auth/google', authMiddleware, (req, res) => {
  if (!isGoogleOAuthConfigured()) return res.status(500).json({ error: 'Google OAuth not configured' });
  const user = (req as any).user;
  // Encode userId in state (JWT token) so callback can identify the user
  const rawToken = extractToken(req);
  const url = getGoogleAuthUrl(rawToken || String(user.userId));
  res.json({ url });
});

router.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send('Missing authorization code');

    // Verify user from state (which is the JWT token)
    const payload = state ? verifyToken(state as string) : null;
    if (!payload) {
      const baseUrl = config.publicUrl || `${req.protocol}://${req.get('host')}`;
      return res.redirect(`${baseUrl}/?oauth=google&status=error&message=not_authenticated`);
    }

    // Exchange code for tokens
    const tokens = await exchangeGoogleCode(code as string);

    // Get Google user info (email, name)
    const userInfo = await getGoogleUserInfo(tokens.accessToken);

    // Save tokens to DB
    await oauthManager.saveToken({
      userId: payload.userId,
      provider: 'google',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? undefined,
      expiresIn: tokens.expiresIn,
      providerUserId: userInfo.email,
      providerNickname: userInfo.name || userInfo.email,
    });

    // Redirect back to Tower Settings with success
    const baseUrl = config.publicUrl || `${req.protocol}://${req.get('host')}`;
    res.redirect(`${baseUrl}/?oauth=google&status=success`);
  } catch (err: any) {
    console.error('[Google OAuth] Error:', err.message);
    const baseUrl = config.publicUrl || `${req.protocol}://${req.get('host')}`;
    res.redirect(`${baseUrl}/?oauth=google&status=error&message=${encodeURIComponent(err.message)}`);
  }
});

// ───── Telegram Bot Linking ─────

// Generate a link token — user clicks "Connect Telegram" → gets a t.me link
router.post('/auth/telegram/link', authMiddleware, async (req, res) => {
  if (!config.telegramBotToken || !telegramLinkManager) {
    return res.status(500).json({ error: 'Telegram bot not configured' });
  }
  const user = (req as any).user;
  const token = telegramLinkManager.createToken(user.userId, user.username);

  const botUsername = process.env.TELEGRAM_BOT_USERNAME || '';
  const deepLink = botUsername
    ? `https://t.me/${botUsername}?start=${token}`
    : null;

  res.json({ token, deepLink });
});

// Telegram webhook — receives messages from Telegram Bot API
router.post('/telegram/webhook', async (req, res) => {
  const secret = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
  if (config.telegramWebhookSecret && secret !== config.telegramWebhookSecret) {
    return res.status(403).json({ error: 'Invalid secret' });
  }

  const parsed = parseTelegramWebhook(req.body);
  if (!parsed) return res.status(200).json({ ok: true });

  const bot = new TelegramChannel({ botToken: config.telegramBotToken, getChatId: async () => parsed.chatId });

  // Handle /start command — account linking
  if (parsed.isCommand && parsed.command === 'start' && parsed.commandArg && telegramLinkManager) {
    const link = telegramLinkManager.consumeToken(parsed.commandArg);
    if (link) {
      await oauthManager.saveToken({
        userId: link.userId,
        provider: 'telegram',
        accessToken: 'bot-linked',
        providerUserId: parsed.chatId,
        providerNickname: parsed.fromName,
      });
      await bot.sendToChat(parsed.chatId, `✅ Tower 계정 연결 완료!\n\n👤 ${link.username}\n\n태스크 완료/실패 알림이 이 채팅으로 전송됩니다.`);
      console.log(`[Telegram] Linked user ${link.userId} (${link.username}) → chat ${parsed.chatId}`);
      return res.status(200).json({ ok: true, action: 'linked' });
    } else {
      await bot.sendToChat(parsed.chatId, '⚠️ 링크 토큰이 만료되었거나 유효하지 않습니다.\nTower Settings에서 다시 시도해주세요.');
      return res.status(200).json({ ok: true, action: 'expired' });
    }
  }

  // /start without args
  if (parsed.isCommand && parsed.command === 'start' && !parsed.commandArg) {
    await bot.sendToChat(parsed.chatId, '👋 Tower Bot입니다!\n\nTower Settings → 알림 → Telegram 연결 버튼을 눌러주세요.');
    return res.status(200).json({ ok: true, action: 'welcome' });
  }

  res.status(200).json({ ok: true });
});

// Get connected OAuth providers for current user
router.get('/auth/oauth/status', authMiddleware, async (req, res) => {
  const user = (req as any).user;
  const providers = ['kakao', 'slack', 'telegram'];
  const details: Record<string, { connected: boolean; nickname?: string }> = {};

  for (const p of providers) {
    const token = await oauthManager.getToken(user.userId, p);
    details[p] = {
      connected: !!token,
      nickname: token?.provider_nickname || undefined,
    };
  }
  res.json(details);
});

// Disconnect OAuth provider
router.delete('/auth/oauth/:provider', authMiddleware, async (req, res) => {
  const user = (req as any).user;
  await oauthManager.deleteToken(user.userId, req.params.provider as string);
  res.json({ ok: true });
});

// Send test message via provider
router.post('/auth/oauth/:provider/test', authMiddleware, async (req, res) => {
  const user = (req as any).user;
  const provider = req.params.provider as string;
  const emoji = provider === 'telegram' ? '🤖' : '🎉';
  const result = await messageRouter.send(user.userId, provider, `${emoji} Tower ${provider} 연결 테스트 성공!`, {
    title: 'Tower 연결 완료',
    linkUrl: 'https://tower.moatai.app',
    buttonTitle: 'Tower 열기',
  });
  res.json(result);
});

// ───── Skill Credential Binding ─────

import {
  getUserConnections,
  getUserSkillReadiness,
  checkSkillReadiness,
  getSkillProviders,
  setSkillProviders,
  PROVIDER_META,
} from '../services/skill-credential.js';

// My connections overview (all providers + connection status)
router.get('/me/connections', authMiddleware, async (req, res) => {
  const user = (req as any).user;
  const connections = await getUserConnections(user.userId);
  res.json(connections);
});

// My skill readiness (which skills I can/can't use due to missing credentials)
router.get('/me/skill-readiness', authMiddleware, async (req, res) => {
  const user = (req as any).user;
  const readiness = await getUserSkillReadiness(user.userId);
  res.json(readiness);
});

// Check readiness for a specific skill
router.get('/skills/:id/readiness', authMiddleware, async (req, res) => {
  const user = (req as any).user;
  const readiness = await checkSkillReadiness(req.params.id as string, user.userId);
  res.json(readiness);
});

// Get providers required by a skill
router.get('/skills/:id/providers', authMiddleware, async (req, res) => {
  const providers = await getSkillProviders(req.params.id as string);
  res.json(providers);
});

// Set providers for a skill (admin only)
router.put('/skills/:id/providers', authMiddleware, async (req, res) => {
  const user = (req as any).user;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  await setSkillProviders(req.params.id as string, req.body.providers ?? []);
  res.json({ ok: true });
});

// Available provider types (for UI dropdowns)
router.get('/providers', authMiddleware, (_req, res) => {
  res.json(PROVIDER_META);
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
  const share = await getShareByToken(req.params.token as string);
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

// ───── Shared Session (public, no auth) ─────
router.get('/shared-session/:token', async (req, res) => {
  const share = await getSessionShareByToken(req.params.token as string);
  if (!share || !isSessionShareValid(share)) {
    const expired = !share ? 'not found' : 'expired';
    if (req.query.format === 'json') {
      return res.status(410).json({ error: 'This link has expired or been revoked.' });
    }
    return res.status(410).send(renderSharedSessionError(expired));
  }
  try {
    const snapshot: any[] = share.snapshot_json ? JSON.parse(share.snapshot_json) : [];
    const session = await queryOne('SELECT name FROM sessions WHERE id = $1', [share.session_id]);
    const sessionName = (session as any)?.name ?? 'Shared Session';

    // JSON format (for programmatic access)
    if (req.query.format === 'json') {
      return res.json({ sessionName, messages: snapshot, sharedAt: share.created_at, expiresAt: share.expires_at });
    }

    // Default: render as readable HTML document
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderSharedSessionHtml(sessionName, snapshot, share.created_at, share.expires_at));
  } catch {
    return res.status(500).send(renderSharedSessionError('error'));
  }
});

/** Extract text from message content (string, JSON string, or ContentBlock array) */
function extractMessageText(content: any): string {
  // Already an array of blocks
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text' && b.text)
      .map((b: any) => b.text)
      .join('\n\n');
  }
  if (typeof content !== 'string') return '';
  // Try to parse as JSON (double-serialized content blocks)
  const trimmed = content.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((b: any) => b.type === 'text' && b.text)
          .map((b: any) => b.text)
          .join('\n\n');
      }
    } catch { /* not JSON, treat as plain text */ }
  }
  return content;
}

/** Minimal HTML escape */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Merge consecutive same-role messages and drop empties */
function collapseMessages(messages: any[]): { role: string; text: string; username?: string }[] {
  const result: { role: string; text: string; username?: string }[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = extractMessageText(m.content).trim();
    if (!text) continue;
    const last = result[result.length - 1];
    if (last && last.role === m.role) {
      // Merge consecutive same-role messages
      last.text += '\n\n' + text;
    } else {
      result.push({ role: m.role, text, username: m.username });
    }
  }
  return result;
}

/** Simple markdown-to-HTML (code blocks, inline code, bold, headers, lists) */
function mdToHtml(text: string): string {
  let html = esc(text);
  // Code blocks (must be before line-level transforms)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) =>
    `<pre${lang ? ` data-lang="${lang}"` : ''}><code>${code}</code></pre>`);
  // Headers (## and ###)
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  // Bullet lists (- item)
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);
  // Numbered lists (1. item)
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Line breaks (but not inside <pre>)
  html = html.replace(/(?<!\n)\n(?!\n)/g, '<br>');
  html = html.replace(/\n{2,}/g, '</p><p>');
  return `<p>${html}</p>`;
}

/** Render shared session as a readable HTML document */
function renderSharedSessionHtml(title: string, messages: any[], sharedAt: string, expiresAt?: string): string {
  const sharedDate = new Date(sharedAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const expiresDate = expiresAt ? new Date(expiresAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  const collapsed = collapseMessages(messages);
  const messagesHtml = collapsed
    .map((m) => {
      const isUser = m.role === 'user';
      const label = isUser ? (m.username || 'User') : 'AI';
      const labelClass = isUser ? 'msg-user' : 'msg-ai';
      return `<div class="msg ${labelClass}"><div class="msg-label">${esc(label)}</div><div class="msg-body">${mdToHtml(m.text)}</div></div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Tower</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0a0b; color: #d1d5db; line-height: 1.7; }
  .container { max-width: 800px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
  .header { border-bottom: 1px solid #1f2937; padding-bottom: 1.5rem; margin-bottom: 2rem; }
  .header h1 { font-size: 1.25rem; color: #f3f4f6; font-weight: 600; margin-bottom: 0.5rem; }
  .header .meta { font-size: 0.75rem; color: #6b7280; }
  .header .meta span { margin-right: 1.5rem; }
  .msg { margin-bottom: 1.5rem; }
  .msg-label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.4rem; }
  .msg-user .msg-label { color: #60a5fa; }
  .msg-ai .msg-label { color: #a78bfa; }
  .msg-body { font-size: 0.9rem; color: #d1d5db; }
  .msg-body p { margin-bottom: 0.5rem; }
  .msg-body p:last-child { margin-bottom: 0; }
  .msg-body h3 { font-size: 1rem; color: #f3f4f6; font-weight: 600; margin: 1rem 0 0.4rem; }
  .msg-body h4 { font-size: 0.9rem; color: #e5e7eb; font-weight: 600; margin: 0.75rem 0 0.3rem; }
  .msg-body ul { padding-left: 1.5rem; margin: 0.4rem 0; }
  .msg-body li { margin-bottom: 0.2rem; }
  .msg-user .msg-body { color: #e5e7eb; }
  pre { background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 1rem; overflow-x: auto; margin: 0.75rem 0; font-size: 0.8rem; line-height: 1.5; }
  code { font-family: "SF Mono", "Fira Code", monospace; font-size: 0.85em; }
  :not(pre) > code { background: #1f2937; padding: 0.15em 0.4em; border-radius: 4px; color: #e5e7eb; }
  strong { color: #f3f4f6; }
  .footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #1f2937; text-align: center; }
  .footer p { font-size: 0.7rem; color: #4b5563; }
  .badge { display: inline-block; font-size: 0.65rem; background: #1f2937; color: #9ca3af; padding: 0.2em 0.6em; border-radius: 4px; }
  @media (max-width: 640px) { .container { padding: 1rem; } .msg-body { font-size: 0.85rem; } }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>${esc(title)}</h1>
    <div class="meta">
      <span>공유: ${sharedDate}</span>
      ${expiresDate ? `<span>만료: ${expiresDate}</span>` : ''}
      <span class="badge">읽기 전용 스냅샷</span>
    </div>
  </div>
  ${messagesHtml}
  <div class="footer">
    <p>Powered by Tower</p>
  </div>
</div>
</body>
</html>`;
}

/** Error page for expired/invalid shared sessions */
function renderSharedSessionError(reason: string): string {
  const message = reason === 'expired'
    ? '이 공유 링크는 만료되었거나 취소되었습니다.'
    : reason === 'not found'
    ? '존재하지 않는 공유 링크입니다.'
    : '세션을 불러오는 중 오류가 발생했습니다.';
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>공유 세션 — Tower</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0a0b; color: #d1d5db; display: flex; align-items: center; justify-content: center; height: 100dvh; margin: 0; }
  .box { text-align: center; }
  .icon { font-size: 3rem; margin-bottom: 1rem; }
  p { font-size: 0.9rem; color: #9ca3af; }
</style>
</head>
<body>
<div class="box">
  <div class="icon">🔗</div>
  <p>${message}</p>
</div>
</body>
</html>`;
}

// ───── Protected routes ─────
router.use(authMiddleware);

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.2.0', buildId: config.serverEpoch, publicUrl: config.publicUrl || null });
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

// ─── OAuth callback (Google) ────────────────────────────────────────────────
const GWS_CRED_DIR = path.join(os.homedir(), '.config', 'gws');

router.get('/oauth/google/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  const error = req.query.error as string | undefined;

  if (error) {
    return res.status(400).send(oauthResultPage(false, `Login denied: ${error}`));
  }
  if (!code) {
    return res.status(400).send(oauthResultPage(false, 'Missing authorization code'));
  }

  try {
    // Read client config
    const secretPath = path.join(GWS_CRED_DIR, 'client_secret.json');
    const secret = JSON.parse(fs.readFileSync(secretPath, 'utf-8'));
    const info = secret.installed || secret.web || {};
    const clientId = info.client_id;
    const clientSecret = info.client_secret;

    // Determine redirect_uri (must match what was used in the auth request)
    const publicUrl = config.publicUrl || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${publicUrl}/api/oauth/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json() as Record<string, any>;
    if (tokens.error) {
      return res.status(400).send(oauthResultPage(false, `Token error: ${tokens.error_description || tokens.error}`));
    }

    // Save credentials in gws format
    const creds = {
      type: 'authorized_user',
      token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      token_uri: 'https://oauth2.googleapis.com/token',
      client_id: clientId,
      client_secret: clientSecret,
      scopes: (req.query.scope as string || '').split(' ').filter(Boolean),
    };
    fs.writeFileSync(path.join(GWS_CRED_DIR, 'credentials.json'), JSON.stringify(creds, null, 2));

    // Update token cache
    const tokenCache = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      token_uri: 'https://oauth2.googleapis.com/token',
      client_id: clientId,
      client_secret: clientSecret,
      scopes: creds.scopes,
      expiry: '',
    };
    fs.writeFileSync(path.join(GWS_CRED_DIR, 'token_cache.json'), JSON.stringify(tokenCache, null, 2));

    res.send(oauthResultPage(true, 'Google login successful!'));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).send(oauthResultPage(false, `Server error: ${message}`));
  }
});

function oauthResultPage(success: boolean, message: string): string {
  const color = success ? '#10b981' : '#ef4444';
  const icon = success ? '&#10003;' : '&#10007;';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>OAuth ${success ? 'Success' : 'Error'}</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #111; color: #eee; }
  .card { text-align: center; padding: 3rem; border-radius: 1rem; border: 1px solid ${color}33; background: ${color}11; max-width: 420px; }
  .icon { font-size: 3rem; color: ${color}; margin-bottom: 1rem; }
  h2 { margin: 0 0 0.5rem; }
  p { color: #999; font-size: 0.9rem; }
  .close-btn { margin-top: 1.5rem; padding: 0.5rem 2rem; border-radius: 0.5rem; border: 1px solid #333; background: #222; color: #eee; cursor: pointer; font-size: 0.9rem; }
  .close-btn:hover { background: #333; }
</style></head>
<body><div class="card">
  <div class="icon">${icon}</div>
  <h2>${success ? 'Login Complete' : 'Login Failed'}</h2>
  <p>${message}</p>
  <button class="close-btn" onclick="window.close()">Close Window</button>
  ${success ? '<script>setTimeout(()=>window.close(),3000)</script>' : ''}
</div></body></html>`;
}
// ─────────────────────────────────────────────────────────────────────────────

// ───── Users list (for share modal dropdown) ─────
router.get('/users', async (req, res) => {
  const currentUserId = (req as any).user?.userId;
  const users = (await query('SELECT id, username FROM users WHERE disabled = 0 ORDER BY username'))
    .filter((u: any) => u.id !== currentUserId);
  res.json(users);
});

// ───── Shares ─────
router.post('/shares', async (req, res) => {
  const { shareType, filePath, targetUserId, expiresIn } = req.body;
  const ownerId = (req as any).user?.userId;
  if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  try {
    if (shareType === 'internal') {
      if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
      const share = await createInternalShare(filePath, ownerId, targetUserId);
      return res.json(share);
    } else if (shareType === 'external') {
      const share = await createExternalShare(filePath, ownerId, expiresIn || '24h');
      const url = `/api/shared/${share.token}`;
      return res.json({ ...share, url });
    } else {
      return res.status(400).json({ error: 'shareType must be internal or external' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// IMPORTANT: register /shares/with-me BEFORE /shares/:id to avoid Express matching 'with-me' as :id
router.get('/shares/with-me', async (req, res) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  res.json(await getSharesWithMe(userId));
});

router.get('/shares', async (req, res) => {
  const ownerId = (req as any).user?.userId;
  const filePath = req.query.filePath as string;
  if (!ownerId || !filePath) return res.status(400).json({ error: 'filePath required' });
  res.json(await getSharesByFile(filePath, ownerId));
});

router.delete('/shares/:id', async (req, res) => {
  const ownerId = (req as any).user?.userId;
  if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });
  const ok = await revokeShare(req.params.id as string, ownerId);
  if (!ok) return res.status(404).json({ error: 'Share not found or no permission to revoke.' });
  res.json({ ok: true });
});

// ───── Session Shares ─────
router.post('/session-shares', async (req, res) => {
  const { shareType, sessionId, targetUserId, expiresIn } = req.body;
  const ownerId = (req as any).user?.userId;
  if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  try {
    if (shareType === 'internal') {
      if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
      const share = await createInternalSessionShare(sessionId, ownerId, targetUserId);
      return res.json(share);
    } else if (shareType === 'external') {
      const share = await createExternalSessionShare(sessionId, ownerId, expiresIn || '24h');
      const url = `/api/shared-session/${share.token}`;
      return res.json({ ...share, url });
    } else {
      return res.status(400).json({ error: 'shareType must be internal or external' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/session-shares/with-me', async (req, res) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  res.json(await getSessionSharesWithMe(userId));
});

router.get('/session-shares', async (req, res) => {
  const ownerId = (req as any).user?.userId;
  const sessionId = req.query.sessionId as string;
  if (!ownerId || !sessionId) return res.status(400).json({ error: 'sessionId required' });
  res.json(await getSharesBySession(sessionId, ownerId));
});

router.delete('/session-shares/:id', async (req, res) => {
  const ownerId = (req as any).user?.userId;
  if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });
  const ok = await revokeSessionShare(req.params.id as string, ownerId);
  if (!ok) return res.status(404).json({ error: 'Share not found or no permission to revoke.' });
  res.json({ ok: true });
});

// ───── Admin: Models ─────

router.get('/admin/models', adminMiddleware, (_req, res) => {
  res.json(loadModelsFile());
});

router.put('/admin/models', adminMiddleware, (req, res) => {
  try {
    const data = req.body;
    if (!data.claude || !data.pi) return res.status(400).json({ error: 'claude and pi arrays required' });
    saveModelsFile(data);
    const reloaded = reloadModels();
    // Broadcast updated model list to all connected clients
    broadcast({ type: 'config_update', models: reloaded.claude, piModels: reloaded.pi, localModels: reloaded.local, defaults: reloaded.defaults });
    res.json({ ok: true, ...reloaded });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ───── Admin: Claude Accounts (credential rotation) ─────
import {
  listAccounts, addAccount, updateAccount, removeAccount,
  assignAccountToProject, getProjectAccountId,
} from '../services/credential-store.js';

router.get('/admin/claude-accounts', adminMiddleware, async (_req, res) => {
  try {
    res.json(await listAccounts());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/claude-accounts', adminMiddleware, async (req, res) => {
  const { id, label, configDir, tier, isDefault } = req.body;
  if (!id || !label || !configDir) {
    return res.status(400).json({ error: 'id, label, and configDir are required' });
  }
  try {
    const account = await addAccount({ id, label, configDir, tier, isDefault });
    res.json(account);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE') || err.message?.includes('unique') || err.message?.includes('duplicate')) {
      return res.status(409).json({ error: 'Account ID or configDir already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/claude-accounts/:id', adminMiddleware, async (req, res) => {
  const { label, configDir, tier, isDefault, enabled } = req.body;
  try {
    const updated = await updateAccount(req.params.id as string, { label, configDir, tier, isDefault, enabled });
    if (!updated) return res.status(404).json({ error: 'Account not found' });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/claude-accounts/:id', adminMiddleware, async (req, res) => {
  try {
    const ok = await removeAccount(req.params.id as string);
    if (!ok) return res.status(404).json({ error: 'Account not found' });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Assign account to project
router.put('/admin/projects/:projectId/claude-account', adminMiddleware, async (req, res) => {
  const { accountId } = req.body; // null to unassign
  try {
    await assignAccountToProject(req.params.projectId as string, accountId);
    res.json({ ok: true, projectId: req.params.projectId, accountId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/projects/:projectId/claude-account', adminMiddleware, async (req, res) => {
  try {
    const accountId = await getProjectAccountId(req.params.projectId as string);
    res.json({ projectId: req.params.projectId, accountId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ───── Admin: System Prompts ─────
import { listSystemPrompts, upsertSystemPrompt, deleteSystemPrompt } from '../services/system-prompt.js';

router.get('/admin/system-prompts', adminMiddleware, async (_req, res) => {
  res.json(await listSystemPrompts());
});

router.put('/admin/system-prompts/:name', adminMiddleware, async (req, res) => {
  const name = req.params.name as string;
  const { prompt } = req.body;
  if (!prompt && prompt !== '') return res.status(400).json({ error: 'prompt is required' });
  const result = await upsertSystemPrompt(name, prompt);
  res.json(result);
});

router.delete('/admin/system-prompts/:name', adminMiddleware, async (req, res) => {
  const name = req.params.name as string;
  const ok = await deleteSystemPrompt(name);
  if (!ok) return res.status(400).json({ error: 'Cannot delete the default prompt' });
  res.json({ ok: true });
});

// ───── Admin: User Management ─────
router.get('/admin/users', adminMiddleware, async (_req, res) => {
  res.json(await listUsers());
});

router.post('/admin/users', adminMiddleware, async (req, res) => {
  const { username, password, role, allowed_path } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  try {
    const user = await createUser(username, password, role || 'member');
    if (allowed_path !== undefined) await updateUserPath(user.id, allowed_path);
    res.json({ ...user, allowed_path: allowed_path || '' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: error.message });
  }
});

router.patch('/admin/users/:id', adminMiddleware, async (req, res) => {
  const userId = parseInt(req.params.id as string);
  const currentUser = (req as any).user;
  const { role, allowed_path } = req.body;
  if (role !== undefined) {
    if (currentUser.userId === userId) return res.status(403).json({ error: 'Cannot change own role' });
    await updateUserRole(userId, role);
  }
  if (allowed_path !== undefined) await updateUserPath(userId, allowed_path);
  res.json({ ok: true });
});

router.patch('/admin/users/:id/password', adminMiddleware, async (req, res) => {
  const userId = parseInt(req.params.id as string);
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  await resetUserPassword(userId, password);
  res.json({ ok: true });
});

router.delete('/admin/users/:id', adminMiddleware, async (req, res) => {
  const userId = parseInt(req.params.id as string);
  const currentUser = (req as any).user;
  if (currentUser.userId === userId) return res.status(403).json({ error: 'Cannot delete yourself' });
  await disableUser(userId);
  res.json({ ok: true });
});

// ───── Admin: Groups ─────
router.get('/admin/groups', adminMiddleware, async (_req, res) => {
  res.json(await listGroups());
});

router.post('/admin/groups', adminMiddleware, async (req, res) => {
  try {
    const { name, description, isGlobal } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const group = await createGroup(name.trim(), description, isGlobal);
    res.json(group);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Group name already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/admin/groups/:id', adminMiddleware, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id as string);
    const group = await updateGroup(groupId, req.body);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json(group);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Group name already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/groups/:id', adminMiddleware, async (req, res) => {
  const ok = await deleteGroup(parseInt(req.params.id as string));
  if (!ok) return res.status(404).json({ error: 'Group not found' });
  res.json({ ok: true });
});

router.post('/admin/groups/:id/users', adminMiddleware, async (req, res) => {
  const groupId = parseInt(req.params.id as string);
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  await addUserToGroup(userId, groupId);
  res.json({ ok: true });
});

router.delete('/admin/groups/:id/users/:uid', adminMiddleware, async (req, res) => {
  const groupId = parseInt(req.params.id as string);
  const userId = parseInt(req.params.uid as string);
  await removeUserFromGroup(userId, groupId);
  res.json({ ok: true });
});

// (project_groups endpoints removed — use project members API instead)

// ───── Metrics: Usage Heatmap ─────
// Returns project × day grid of REAL user turns (user messages with type:text only,
// excluding tool_result bounces and assistant intermediate tool_use blocks).
// Filtered to projects the current user owns or is a member of.
router.get('/metrics/usage-heatmap', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const days = Math.max(1, Math.min(parseInt(String(req.query.days || '30'), 10) || 30, 180));
    const topN = Math.max(1, Math.min(parseInt(String(req.query.top || '10'), 10) || 10, 30));

    // 1) Per-project totals over window, filtered to accessible projects
    const totalsSql = `
      SELECT p.id, p.name,
        COUNT(*) FILTER (WHERE m.role='user' AND m.content LIKE '[{"type":"text"%') AS turns,
        COUNT(DISTINCT s.id) AS sessions,
        COUNT(DISTINCT DATE(m.created_at)) AS active_days
      FROM projects p
      JOIN sessions s ON s.project_id = p.id
      JOIN messages m ON m.session_id = s.id
      WHERE (p.archived IS NULL OR p.archived = 0)
        AND (
          p.user_id = $1
          OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1)
        )
        AND m.created_at >= NOW() - ($2 || ' days')::interval
      GROUP BY p.id, p.name
      HAVING COUNT(*) FILTER (WHERE m.role='user' AND m.content LIKE '[{"type":"text"%') > 0
      ORDER BY turns DESC
      LIMIT $3
    `;
    const totals = await query<{ id: string; name: string; turns: string; sessions: string; active_days: string }>(
      totalsSql, [userId, String(days), topN]
    );

    if (totals.length === 0) {
      return res.json({ days, topN, dates: [], projects: [], grandTotal: 0 });
    }

    const projectIds = totals.map((t) => t.id);

    // 2) Daily breakdown for those projects
    const dailySql = `
      SELECT s.project_id AS project_id,
             to_char(DATE(m.created_at), 'YYYY-MM-DD') AS d,
             COUNT(*) FILTER (WHERE m.role='user' AND m.content LIKE '[{"type":"text"%') AS turns
      FROM sessions s
      JOIN messages m ON m.session_id = s.id
      WHERE s.project_id = ANY($1::text[])
        AND m.created_at >= NOW() - ($2 || ' days')::interval
      GROUP BY s.project_id, DATE(m.created_at)
      HAVING COUNT(*) FILTER (WHERE m.role='user' AND m.content LIKE '[{"type":"text"%') > 0
    `;
    const daily = await query<{ project_id: string; d: string; turns: string }>(
      dailySql, [projectIds, String(days)]
    );

    // 3) Build continuous date axis (days window ending today, inclusive)
    const dates: string[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }

    // 4) Build lookup and assemble per-project value arrays in the date order
    const lookup: Record<string, Record<string, number>> = {};
    for (const row of daily) {
      if (!lookup[row.project_id]) lookup[row.project_id] = {};
      lookup[row.project_id][row.d] = Number(row.turns);
    }

    let grandTotal = 0;
    const projects = totals.map((t) => {
      const map = lookup[t.id] || {};
      const values = dates.map((d) => map[d] || 0);
      const total = Number(t.turns);
      grandTotal += total;
      return {
        id: t.id,
        name: t.name,
        total,
        sessions: Number(t.sessions),
        activeDays: Number(t.active_days),
        values,
      };
    });

    // 5) Daily totals across ALL accessible projects (not just top N)
    const allDailySql = `
      SELECT to_char(DATE(m.created_at), 'YYYY-MM-DD') AS d,
             COUNT(*) AS turns
      FROM projects p
      JOIN sessions s ON s.project_id = p.id
      JOIN messages m ON m.session_id = s.id
      WHERE (p.archived IS NULL OR p.archived = 0)
        AND (
          p.user_id = $1
          OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1)
        )
        AND m.created_at >= NOW() - ($2 || ' days')::interval
        AND m.role = 'user' AND m.content LIKE '[{"type":"text"%'
      GROUP BY DATE(m.created_at)
    `;
    const allDaily = await query<{ d: string; turns: string }>(allDailySql, [userId, String(days)]);
    const allDailyMap: Record<string, number> = {};
    let allTotal = 0;
    for (const row of allDaily) {
      allDailyMap[row.d] = Number(row.turns);
      allTotal += Number(row.turns);
    }
    const dailyTotals = dates.map((d) => allDailyMap[d] || 0);

    res.json({ days, topN, dates, projects, grandTotal: allTotal, dailyTotals });
  } catch (err: any) {
    console.error('[metrics/usage-heatmap] error:', err);
    res.status(500).json({ error: err?.message || 'internal error' });
  }
});

// ───── Sessions ─────
router.get('/sessions', async (req, res) => {
  const userId = (req as any).user?.userId;
  const role = (req as any).user?.role;
  const roomId = req.query.roomId as string | undefined;
  const parentSessionId = req.query.parentSessionId as string | undefined;

  // AI Panel: return panel sessions for specific room + user
  if (roomId && userId) {
    return res.json(await getPanelSessions(roomId, userId));
  }

  // Session AI Panel: return panel threads for a specific parent session + user
  if (parentSessionId && userId) {
    return res.json(await getSessionPanelSessions(parentSessionId, userId));
  }

  // Default: return all accessible sessions (excluding panel thread sessions, but INCLUDING channel_ai)
  const sessions = await getSessions(userId, role);
  res.json(sessions.filter(s => {
    if (s.parentSessionId) return false;  // panel sub-sessions: always hide
    if (s.roomId && s.label !== 'channel_ai') return false;  // room threads: hide, but keep channel AI
    return true;
  }));
});

router.post('/sessions', async (req, res) => {
  const { name, cwd, engine, roomId, sourceMessageId, parentSessionId } = req.body;
  let { projectId } = req.body;
  const userId = (req as any).user?.userId;
  const role = (req as any).user?.role;
  const effectiveCwd = cwd || config.defaultCwd;

  // Auto-map cwd → projectId if not provided
  if (!projectId && effectiveCwd) {
    const { findProjectByPath } = await import('../services/project-access.js');
    projectId = await findProjectByPath(effectiveCwd);
  }

  // Project access check for session creation
  if (projectId && userId) {
    const access = await canCreateInProject(projectId, userId, role);
    if (!access.allowed) return res.status(access.status).json({ error: access.message });
  }
  const session = await createSession(name || `Session ${new Date().toLocaleString('en-US')}`, effectiveCwd, userId, projectId, engine, roomId, sourceMessageId, parentSessionId);
  broadcastToAll({ type: 'session_created', session });
  res.json(session);
});

router.get('/sessions/:id', async (req, res) => {
  const userId = (req as any).user?.userId;
  const role = (req as any).user?.role;
  // Project access check
  if (userId) {
    const access = await canAccessSession(req.params.id as string, userId, role);
    if (!access.allowed) return res.status(access.status).json({ error: access.message });
  }
  const session = await getSession(req.params.id as string);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

router.patch('/sessions/:id', async (req, res) => {
  const { name, tags, favorite, totalCost, totalTokens, claudeSessionId, autoNamed, cwd, visibility, modelUsed, engine } = req.body;
  const userId = (req as any).user?.userId;
  const userRole = (req as any).user?.role;

  // Session access check (owner or project member)
  if (userId) {
    const access = await canAccessSession(req.params.id as string, userId, userRole);
    if (!access.allowed) return res.status(access.status).json({ error: access.message });
  }

  // Visibility change: only session owner or admin (stricter than general access)
  if (visibility !== undefined) {
    const { queryOne: pgQueryOne } = await import('../db/pg-repo.js');
    const row = await pgQueryOne<{ user_id: number }>('SELECT user_id FROM sessions WHERE id = $1', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    if (userRole !== 'admin' && row.user_id !== userId) {
      return res.status(403).json({ error: 'Only session owner or admin can change visibility' });
    }
  }

  const updates: any = { name, tags, favorite, totalCost, totalTokens, claudeSessionId };
  if (autoNamed !== undefined) updates.autoNamed = autoNamed;
  if (visibility !== undefined) updates.visibility = visibility;
  if ('label' in req.body) updates.label = req.body.label;
  if (cwd !== undefined) {
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      return res.status(400).json({ error: 'Invalid directory path' });
    }
    updates.cwd = cwd;
  }
  // modelUsed: persist the user's per-session model choice.
  // Validation is intentionally light — the ws-handler revalidates against
  // the session's engine and falls back if the frontend sends something bad.
  if (modelUsed !== undefined) {
    if (modelUsed !== null && typeof modelUsed !== 'string') {
      return res.status(400).json({ error: 'modelUsed must be a string or null' });
    }
    updates.modelUsed = modelUsed;
  }
  // engine: allow switching session engine (claude/pi/local) when user picks a model from a different engine
  if (engine !== undefined) {
    const validEngines = ['claude', 'pi', 'local'];
    if (!validEngines.includes(engine)) {
      return res.status(400).json({ error: `engine must be one of: ${validEngines.join(', ')}` });
    }
    updates.engine = engine;
  }
  await updateSession(req.params.id as string, updates);
  // Broadcast to all clients so other users see changes in real-time
  try {
    const { broadcastToAll } = await import('./ws-handler.js');
    broadcastToAll({ type: 'session_meta_update', sessionId: req.params.id, updates });
  } catch {}
  res.json({ ok: true });
});

// Auto-name session based on first messages
router.post('/sessions/:id/auto-name', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessSession(req.params.id as string, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const messages = await getMessages(req.params.id as string);
    const userMsg = messages.find((m) => m.role === 'user');
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    if (!userMsg || !assistantMsg) {
      return res.status(400).json({ error: 'Need at least one user and assistant message' });
    }

    const userText = extractTextFromContent(userMsg.content);
    const assistantText = extractTextFromContent(assistantMsg.content);

    const name = await generateSessionName(userText, assistantText);
    await updateSession(req.params.id as string, { name, autoNamed: 1 } as any);
    res.json({ ok: true, name });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Summarize session
router.post('/sessions/:id/summarize', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessSession(req.params.id as string, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const messages = await getMessages(req.params.id as string);
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

    console.log('[summarize] sessionId:', req.params.id as string);
    console.log('[summarize] messages count:', messages.length);
    console.log('[summarize] filtered count:', recent.filter((m) => m.role === 'user' || m.role === 'assistant').length);
    console.log('[summarize] messagesText length:', messagesText.length);
    console.log('[summarize] messagesText preview:', messagesText.slice(0, 300));

    const summary = await generateSummary(messagesText);

    // Get current session to read turnCount
    const session = await getSession(req.params.id as string);
    const turnCount = session?.turnCount ?? 0;
    await updateSession(req.params.id as string, { summary, summaryAtTurn: turnCount });
    res.json({ ok: true, summary, summaryAtTurn: turnCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/sessions/:id', async (req, res) => {
  const userId = (req as any).user?.userId;
  const role = (req as any).user?.role;
  const sessionId = req.params.id as string;
  if (userId) {
    const access = await canDeleteSession(sessionId, userId, role);
    if (!access.allowed) return res.status(access.status).json({ error: access.message });
  }
  // Snapshot the session BEFORE delete so we know its project/owner
  // for scoped broadcast (other tabs/members need to drop it from sidebar).
  const snapshot = await getSession(sessionId);
  const deleted = await deleteSession(sessionId);
  if (!deleted) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });

  // Realtime: tell every connected client that this session is gone.
  // Payload is tiny; frontends filter by sessionId presence in their sidebar store.
  broadcastToAll({
    type: 'session_deleted',
    sessionId,
    projectId: snapshot?.projectId ?? null,
  });
});

// Claude native sessions (read-only)
router.get('/claude-sessions', (_req, res) => {
  res.json(scanClaudeNativeSessions());
});

// ───── Search (FTS5) ─────
router.get('/search', async (req, res) => {
  const q = (req.query.q as string || '').trim();
  if (!q || q.length < 2) {
    return res.json([]);
  }
  const userId = (req as any).user?.userId;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  const role = (req as any).user?.role;
  const results = await search(q, { userId, role, limit });
  res.json(results);
});

// ───── Session + Messages (combined endpoint for fast session switching) ─────
router.get('/sessions/:id/full', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessSession(req.params.id as string, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const limit = parseInt(req.query.limit as string) || 100;
    const [session, msgResult] = await Promise.all([
      getSession(req.params.id as string),
      getMessagesPaginated(req.params.id as string, { limit }),
    ]);
    res.json({ session, ...msgResult });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ───── Session Messages ─────
// Supports pagination: ?limit=100&before=<messageId>
// Without params → returns all messages (backward-compatible)
// With limit → returns { messages, hasMore, oldestId }
router.get('/sessions/:id/messages', async (req, res) => {
  try {
    // Project access check
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessSession(req.params.id as string, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }

    const limitParam = req.query.limit as string | undefined;
    const before = req.query.before as string | undefined;

    if (limitParam) {
      // Paginated mode
      const result = await getMessagesPaginated(req.params.id as string, {
        limit: parseInt(limitParam) || 100,
        before,
      });
      res.json(result);
    } else {
      // Legacy mode — return flat array (backward-compatible)
      const messages = await getMessages(req.params.id as string);
      res.json(messages);
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ───── Directories ─────
router.get('/directories', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const userRoot = userId ? await getUserAllowedPath(userId) : config.workspaceRoot;
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
router.get('/files/tree', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const userRoot = userId ? await getUserAllowedPath(userId) : config.workspaceRoot;
    const dirPath = (req.query.path as string) || userRoot;
    const inWorkspace = isPathSafe(dirPath, userRoot);
    if (!inWorkspace) {
      // Outside workspace — check if user has project membership for this path
      if (!userId || !(await isPathAccessible(dirPath, userId, role || 'member'))) {
        return res.status(403).json({ error: 'Access denied: outside allowed path' });
      }
    }
    const showHidden = req.query.showHidden === 'true' || req.query.showHidden === '1';
    let entries = await getFileTreeAsync(dirPath, 2, {
      ...(inWorkspace ? {} : { skipSafetyCheck: true }),
      showHidden,
    });

    // Filter project folders: non-admin users only see projects they're a member of
    const projectsDir = path.resolve(path.join(config.workspaceRoot, 'projects'));
    if (userId && role !== 'admin' && path.resolve(dirPath) === projectsDir) {
      const { getUserAccessiblePaths } = await import('../services/project-access.js');
      const accessiblePaths = await getUserAccessiblePaths(userId, role || 'member');
      if (accessiblePaths) {
        const resolvedRoots = accessiblePaths.map(p => path.resolve(p));
        entries = entries.filter(e => {
          if (!e.isDirectory) return true; // files in projects/ root are visible
          const entryResolved = path.resolve(e.path);
          return resolvedRoots.some(root => entryResolved === root || root.startsWith(entryResolved + path.sep));
        });
      }
    }

    res.json({ path: dirPath, entries });
  } catch (error: any) {
    res.status(403).json({ error: error.message });
  }
});

router.get('/files/read', async (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const userRoot = userId ? await getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(filePath, userRoot)) {
      if (!userId || !(await hasInternalShareForUser(filePath, userId))) {
        return res.status(403).json({ error: 'Access denied' });
      }
      // internal share found — allow read to continue
    }
    // Project-level path check
    if (userId && !(await isPathAccessible(filePath, userId, role))) {
      return res.status(403).json({ error: 'Access denied: not a member of the project owning this file' });
    }
    const result = readFile(filePath);
    res.json({ path: filePath, ...result });
  } catch (error: any) {
    res.status(403).json({ error: error.message });
  }
});

// Lightweight file existence check (no content read)
router.get('/files/exists', async (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ exists: false });
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const userRoot = userId ? await getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(filePath, userRoot)) {
      return res.json({ exists: false });
    }
    if (userId && !(await isPathAccessible(filePath, userId, role))) {
      return res.json({ exists: false });
    }
    const fs = await import('fs');
    const exists = fs.existsSync(filePath);
    res.json({ exists, path: filePath });
  } catch {
    res.json({ exists: false });
  }
});

router.post('/files/write', async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) return res.status(400).json({ error: 'path and content required' });
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const userRoot = userId ? await getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(filePath, userRoot)) return res.status(403).json({ error: 'Access denied' });
    // Project-level path check
    if (userId && !(await isPathAccessible(filePath, userId, role))) {
      return res.status(403).json({ error: 'Access denied: not a member of the project owning this file' });
    }
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
    const userRoot = userId ? await getUserAllowedPath(userId) : config.workspaceRoot;
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

    // Invalidate tree cache for upload target
    invalidateTreeCache(targetDir);

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

// ───── Chat File Upload (saves to .temp-uploads/ first, finalized on send) ─────
router.post('/files/chat-upload', handleMulterUpload, async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ error: 'No files provided' });

    // Determine temp upload sub-directory: project-scoped or global
    let tempSubDir = 'global';
    const projectId = req.body?.projectId;
    if (projectId) {
      try {
        const { getProject } = await import('../services/project-manager.js');
        const project = await getProject(projectId);
        if (project?.rootPath) {
          tempSubDir = projectId;
        }
      } catch {}
    }
    const uploadDir = path.join(TEMP_UPLOADS_DIR, tempSubDir);
    fs.mkdirSync(uploadDir, { recursive: true });

    const results: { name: string; path: string; size?: number; mimeType?: string; error?: string }[] = [];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (DANGEROUS_EXTENSIONS.has(ext)) {
        results.push({ name: file.originalname, path: '', error: `Blocked extension: ${ext}` });
        continue;
      }
      // Deduplicate: add timestamp prefix to avoid collisions
      // Allow Unicode letters/numbers (Korean, Japanese, etc.) while blocking path-unsafe chars
      const safeName = `${Date.now()}-${file.originalname.replace(/[^\p{L}\p{N}._-]/gu, '_')}`;
      const filePath = path.join(uploadDir, safeName);
      try {
        writeFileBinary(filePath, file.buffer, uploadDir);
        results.push({ name: file.originalname, path: filePath, size: file.size, mimeType: file.mimetype });
      } catch (err: any) {
        results.push({ name: file.originalname, path: '', error: err.message });
      }
    }

    res.json({ results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ───── Finalize temp uploads: move from .temp-uploads/ to permanent uploads/ ─────
router.post('/files/finalize-uploads', async (req, res) => {
  try {
    const { tempPaths, projectId } = req.body;
    if (!Array.isArray(tempPaths) || tempPaths.length === 0) {
      return res.status(400).json({ error: 'tempPaths array required' });
    }

    // Determine permanent upload directory
    let permanentDir = UPLOADS_DIR;
    if (projectId) {
      try {
        const { getProject } = await import('../services/project-manager.js');
        const project = await getProject(projectId);
        if (project?.rootPath) {
          permanentDir = path.join(project.rootPath, 'uploads');
          fs.mkdirSync(permanentDir, { recursive: true });
        }
      } catch {}
    }

    const results: { tempPath: string; newPath: string; error?: string }[] = [];

    for (const tempPath of tempPaths) {
      // Security: ensure tempPath is actually inside .temp-uploads/
      const resolved = path.resolve(tempPath);
      if (!resolved.startsWith(path.resolve(TEMP_UPLOADS_DIR))) {
        results.push({ tempPath, newPath: '', error: 'Invalid temp path' });
        continue;
      }
      if (!fs.existsSync(resolved)) {
        results.push({ tempPath, newPath: '', error: 'File not found' });
        continue;
      }
      const fileName = path.basename(resolved);
      const newPath = path.join(permanentDir, fileName);
      try {
        fs.renameSync(resolved, newPath);
        results.push({ tempPath, newPath });
      } catch {
        // Cross-device fallback: copy + delete
        try {
          fs.copyFileSync(resolved, newPath);
          fs.unlinkSync(resolved);
          results.push({ tempPath, newPath });
        } catch (e2: any) {
          results.push({ tempPath, newPath: '', error: e2.message });
        }
      }
    }

    res.json({ results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ───── Delete a single temp upload ─────
router.delete('/files/temp-upload', async (req, res) => {
  try {
    const tempPath = (req.query.path as string) || req.body?.path;
    if (!tempPath) return res.status(400).json({ error: 'path required' });

    const resolved = path.resolve(tempPath);
    if (!resolved.startsWith(path.resolve(TEMP_UPLOADS_DIR))) {
      return res.status(403).json({ error: 'Not a temp upload path' });
    }
    if (fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
    }
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ───── File Management (create / mkdir / delete / rename) ─────
router.post('/files/create', async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const userRoot = userId ? await getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(filePath, userRoot)) return res.status(403).json({ error: 'Access denied' });
    if (userId && !(await isPathAccessible(filePath, userId, role))) return res.status(403).json({ error: 'Access denied: outside your project folders' });
    if (fs.existsSync(filePath)) return res.status(409).json({ error: 'File already exists' });
    writeFile(filePath, content || '');
    invalidateTreeCache(filePath);
    res.json({ ok: true, path: filePath });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/files/mkdir', async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath) return res.status(400).json({ error: 'path required' });
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const userRoot = userId ? await getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(dirPath, userRoot)) return res.status(403).json({ error: 'Access denied' });
    if (userId && !(await isPathAccessible(dirPath, userId, role))) return res.status(403).json({ error: 'Access denied: outside your project folders' });
    if (fs.existsSync(dirPath)) return res.status(409).json({ error: 'Directory already exists' });
    createDirectory(dirPath);
    invalidateTreeCache(dirPath);
    res.json({ ok: true, path: dirPath });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/files/delete', async (req, res) => {
  try {
    const { path: targetPath } = req.body;
    if (!targetPath) return res.status(400).json({ error: 'path required' });
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const userRoot = userId ? await getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(targetPath, userRoot)) return res.status(403).json({ error: 'Access denied' });
    if (userId && !(await isPathAccessible(targetPath, userId, role))) return res.status(403).json({ error: 'Access denied: outside your project folders' });
    deleteEntry(targetPath);
    invalidateTreeCache(targetPath);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/files/rename', async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) return res.status(400).json({ error: 'oldPath and newPath required' });
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const userRoot = userId ? await getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(oldPath, userRoot)) return res.status(403).json({ error: 'Access denied' });
    if (!isPathSafe(newPath, userRoot)) return res.status(403).json({ error: 'Access denied' });
    if (userId && (!(await isPathAccessible(oldPath, userId, role)) || !(await isPathAccessible(newPath, userId, role)))) {
      return res.status(403).json({ error: 'Access denied: outside your project folders' });
    }
    renameEntry(oldPath, newPath);
    invalidateTreeCache(oldPath);
    invalidateTreeCache(newPath);
    res.json({ ok: true, path: newPath });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ───── Secure Input (.env writer) ─────
router.post('/env', (req, res) => {
  try {
    const { target, entries } = req.body as {
      target?: string;
      entries: { key: string; value: string }[];
    };
    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries required' });
    }

    // Validate key names (prevent injection)
    for (const e of entries) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.key)) {
        return res.status(400).json({ error: `Invalid key name: ${e.key}` });
      }
    }

    // Resolve target path — only allow .env files within known directories
    const fileName = target || '.env';
    if (!fileName.startsWith('.env')) {
      return res.status(400).json({ error: 'Target must be a .env file' });
    }
    const envPath = path.resolve(process.cwd(), fileName);

    // Read existing content
    let content = '';
    try {
      content = fs.readFileSync(envPath, 'utf-8');
    } catch {
      // File doesn't exist yet — will be created
    }

    // Parse existing lines
    const lines = content.split('\n');
    const existingKeys = new Map<string, number>();
    lines.forEach((line, i) => {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
      if (match) existingKeys.set(match[1], i);
    });

    // Update or append
    for (const { key, value } of entries) {
      const newLine = `${key}=${value}`;
      if (existingKeys.has(key)) {
        lines[existingKeys.get(key)!] = newLine;
      } else {
        // Append (ensure newline before if needed)
        if (lines.length > 0 && lines[lines.length - 1] !== '') {
          lines.push(newLine);
        } else {
          lines.push(newLine);
        }
      }
    }

    fs.writeFileSync(envPath, lines.join('\n'));
    res.json({ ok: true, saved: entries.length, path: envPath });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ───── Pins ─────
router.get('/pins', async (req, res) => {
  const userId = (req as any).user?.userId;
  res.json(await getPins(userId));
});

router.post('/pins', async (req, res) => {
  const { title, filePath, fileType } = req.body;
  if (!title || !filePath) return res.status(400).json({ error: 'title and filePath required' });
  const userId = (req as any).user?.userId;
  const pin = await createPin(title, filePath, fileType || 'markdown', userId);
  res.json(pin);
});

router.patch('/pins/:id', async (req, res) => {
  const { title, sortOrder } = req.body;
  const userId = (req as any).user?.userId;
  await updatePin(parseInt(req.params.id as string), { title, sortOrder }, userId);
  res.json({ ok: true });
});

router.delete('/pins/:id', async (req, res) => {
  const userId = (req as any).user?.userId;
  await deletePin(parseInt(req.params.id as string), userId);
  res.json({ ok: true });
});

router.post('/pins/reorder', async (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds array required' });
  const userId = (req as any).user?.userId;
  await reorderPins(orderedIds, userId);
  res.json({ ok: true });
});

// ───── DOCX → PDF conversion (LibreOffice headless) ─────
router.get('/files/docx-pdf', async (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const userRoot = userId ? await getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(filePath, userRoot)) return res.status(403).json({ error: 'Access denied' });
    if (userId) {
      const pathOk = await isPathAccessible(filePath, userId, role);
      if (!pathOk) return res.status(403).json({ error: 'Access denied: project path' });
    }

    const ext = filePath.split('.').pop()?.toLowerCase();
    if (ext !== 'docx' && ext !== 'doc') {
      return res.status(400).json({ error: 'Only .docx/.doc files supported' });
    }

    // Check source file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Cache directory: /tmp/tower-docx-cache/
    const cacheDir = path.join(os.tmpdir(), 'tower-docx-cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    // Cache key: hash of absolute path + mtime
    const stat = fs.statSync(filePath);
    const crypto = await import('crypto');
    const hash = crypto.createHash('md5')
      .update(filePath + ':' + stat.mtimeMs)
      .digest('hex');
    const cachedPdf = path.join(cacheDir, `${hash}.pdf`);

    // Return cached if exists
    if (fs.existsSync(cachedPdf)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      const stream = fs.createReadStream(cachedPdf);
      stream.pipe(res);
      return;
    }

    // Convert with LibreOffice
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    // LibreOffice needs a unique user profile for concurrent calls
    const profileDir = path.join(os.tmpdir(), `lo-profile-${hash}`);

    try {
      await execFileAsync('libreoffice', [
        '--headless',
        '--norestore',
        `-env:UserInstallation=file://${profileDir}`,
        '--convert-to', 'pdf',
        '--outdir', cacheDir,
        filePath,
      ], { timeout: 30000 });

      // LibreOffice outputs with original filename but .pdf extension
      const baseName = path.basename(filePath).replace(/\.docx?$/i, '.pdf');
      const outputPdf = path.join(cacheDir, baseName);

      // Rename to our cache key
      if (fs.existsSync(outputPdf) && outputPdf !== cachedPdf) {
        fs.renameSync(outputPdf, cachedPdf);
      }

      if (!fs.existsSync(cachedPdf)) {
        return res.status(500).json({ error: 'PDF conversion failed' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      const stream = fs.createReadStream(cachedPdf);
      stream.pipe(res);
    } finally {
      // Cleanup temp profile
      fs.rm(profileDir, { recursive: true, force: true }, () => {});
    }
  } catch (error: any) {
    console.error('[docx-pdf] conversion error:', error.message);
    res.status(500).json({ error: 'PDF conversion failed: ' + error.message });
  }
});

// ───── PPTX → PDF conversion (LibreOffice headless) ─────
router.get('/files/pptx-pdf', async (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const userRoot = userId ? await getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(filePath, userRoot)) return res.status(403).json({ error: 'Access denied' });
    if (userId) {
      const pathOk = await isPathAccessible(filePath, userId, role);
      if (!pathOk) return res.status(403).json({ error: 'Access denied: project path' });
    }

    const ext = filePath.split('.').pop()?.toLowerCase();
    if (ext !== 'pptx' && ext !== 'ppt') {
      return res.status(400).json({ error: 'Only .pptx/.ppt files supported' });
    }

    // Check source file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Cache directory: /tmp/tower-pptx-cache/
    const cacheDir = path.join(os.tmpdir(), 'tower-pptx-cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    // Cache key: hash of absolute path + mtime
    const stat = fs.statSync(filePath);
    const crypto = await import('crypto');
    const hash = crypto.createHash('md5')
      .update(filePath + ':' + stat.mtimeMs)
      .digest('hex');
    const cachedPdf = path.join(cacheDir, `${hash}.pdf`);

    // Return cached if exists
    if (fs.existsSync(cachedPdf)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      const stream = fs.createReadStream(cachedPdf);
      stream.pipe(res);
      return;
    }

    // Convert with LibreOffice
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    // LibreOffice needs a unique user profile for concurrent calls
    const profileDir = path.join(os.tmpdir(), `lo-profile-${hash}`);

    try {
      // Impress-specific PDF export filter preserves slide layout better
      await execFileAsync('libreoffice', [
        '--headless',
        '--norestore',
        `-env:UserInstallation=file://${profileDir}`,
        '--convert-to', 'pdf:impress_pdf_Export',
        '--outdir', cacheDir,
        filePath,
      ], { timeout: 60000 });

      // LibreOffice outputs with original filename but .pdf extension
      const baseName = path.basename(filePath).replace(/\.pptx?$/i, '.pdf');
      const outputPdf = path.join(cacheDir, baseName);

      // Rename to our cache key
      if (fs.existsSync(outputPdf) && outputPdf !== cachedPdf) {
        fs.renameSync(outputPdf, cachedPdf);
      }

      if (!fs.existsSync(cachedPdf)) {
        return res.status(500).json({ error: 'PDF conversion failed' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      const stream = fs.createReadStream(cachedPdf);
      stream.pipe(res);
    } finally {
      // Cleanup temp profile
      fs.rm(profileDir, { recursive: true, force: true }, () => {});
    }
  } catch (error: any) {
    console.error('[pptx-pdf] conversion error:', error.message);
    res.status(500).json({ error: 'PDF conversion failed: ' + error.message });
  }
});

// ───── File Serve (for pin iframe) ─────
router.get('/files/serve', async (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const userRoot = userId ? await getUserAllowedPath(userId) : config.workspaceRoot;
    if (!isPathSafe(filePath, userRoot)) return res.status(403).json({ error: 'Access denied' });
    // Project-level path check (same as /files/read)
    if (userId) {
      const pathOk = await isPathAccessible(filePath, userId, role);
      if (!pathOk) return res.status(403).json({ error: 'Access denied: project path' });
    }

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
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc: 'application/msword',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      xls: 'application/vnd.ms-excel',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ppt: 'application/vnd.ms-powerpoint',
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
router.get('/prompts', async (req, res) => {
  const userId = (req as any).user?.userId;
  res.json(await getPromptsWithCommands(userId));
});

router.post('/prompts', async (req, res) => {
  const { title, content } = req.body;
  if (!title || content === undefined) return res.status(400).json({ error: 'title and content required' });
  const userId = (req as any).user?.userId;
  const pin = await createPromptPin(title, content, userId);
  res.json(pin);
});

router.patch('/prompts/:id', async (req, res) => {
  const { title, content } = req.body;
  const userId = (req as any).user?.userId;
  await updatePromptPin(parseInt(req.params.id as string), { title, content }, userId);
  res.json({ ok: true });
});

router.delete('/prompts/:id', async (req, res) => {
  const userId = (req as any).user?.userId;
  await deletePin(parseInt(req.params.id as string), userId);
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
    const diff = await getFileDiff(config.workspaceRoot, req.params.hash as string);
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
    version: '0.2.0',
    buildId: config.serverEpoch,
    workspaceRoot: config.workspaceRoot,
    permissionMode: config.permissionMode,
    claudeExecutable: config.claudeExecutable,
    models: availableModels,
    connectionType: 'MAX',
    piEnabled: config.piEnabled,
    piModels: config.piEnabled ? config.piModels : [],
    localEnabled: config.localEnabled,
    localModels: config.localEnabled ? config.localModels : [],
  });
});

// ───── Commands (now DB-backed via skill registry) ─────
router.get('/commands', async (req, res) => {
  const userId = (req as any).user?.userId;
  const projectId = req.query.projectId as string | undefined;

  // Try DB-backed registry first, fall back to filesystem scan
  try {
    const commands = await getCommandsForUser(userId, projectId || null);
    if (commands.length > 0) {
      return res.json(commands);
    }
  } catch {}

  // Fallback: filesystem scan (backward compat during migration)
  res.json(loadCommands());
});

// ───── Skills Registry ─────
router.get('/skills', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const scope = req.query.scope as 'company' | 'project' | 'personal' | undefined;
    const projectId = req.query.projectId as string | undefined;
    res.json(await listSkills(scope, projectId, userId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/skills/:id', async (req, res) => {
  try {
    const skill = await getSkill(req.params.id);
    if (!skill) return res.status(404).json({ error: 'Skill not found' });

    // Scan filesystem for skill directory structure
    const files: string[] = [];
    const scanDirs = [
      skill.skillPath,  // plugin cache path (has full folder structure)
      path.join(os.homedir(), '.claude', 'skills', skill.name),
      path.join(path.dirname(config.dbPath), 'skills', 'company', skill.name),
    ].filter(Boolean) as string[];
    for (const dir of scanDirs) {
      if (fs.existsSync(dir)) {
        const walk = (d: string, prefix: string) => {
          try {
            for (const item of fs.readdirSync(d, { withFileTypes: true })) {
              if (item.name.startsWith('.')) continue; // skip hidden
              const rel = prefix ? `${prefix}/${item.name}` : item.name;
              files.push(rel);
              if (item.isDirectory()) walk(path.join(d, item.name), rel);
            }
          } catch {}
        };
        walk(dir, '');
        break;
      }
    }

    res.json({ ...skill, files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/skills', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const { name, scope, content, description, category, projectId } = req.body;

    if (!name || !scope || !content) {
      return res.status(400).json({ error: 'name, scope, content required' });
    }

    // Permission check
    if (scope === 'company' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin only for company skills' });
    }

    const skill = await createSkill({
      name, scope, content, description, category,
      projectId: scope === 'project' ? projectId : undefined,
      userId: scope === 'personal' ? userId : undefined,
    });
    res.json(skill);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/skills/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;

    const existing = await getSkill(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Skill not found' });

    // Permission check
    if (existing.scope === 'company' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    if (existing.scope === 'personal' && existing.userId !== userId) {
      return res.status(403).json({ error: 'Not your skill' });
    }

    const ok = await updateSkill(req.params.id, req.body);
    res.json({ ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/skills/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;

    const existing = await getSkill(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Skill not found' });

    if (existing.scope === 'company' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    if (existing.scope === 'personal' && existing.userId !== userId) {
      return res.status(403).json({ error: 'Not your skill' });
    }

    const ok = await deleteSkill(req.params.id);
    res.json({ ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Per-user skill toggle (enable/disable a skill for yourself)
router.post('/skills/:id/toggle', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const { enabled } = req.body;
    const newState = enabled !== undefined ? !!enabled : !((await getUserSkillPref(userId, req.params.id)) ?? true);
    await setUserSkillPref(userId, req.params.id, newState);
    res.json({ ok: true, enabled: newState });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ───── My Groups (for non-admin users) ─────
router.get('/my/groups', async (req, res) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.json([]);
  res.json(await getUserGroups(userId));
});

// ───── Spaces ─────
router.get('/spaces', async (_req, res) => {
  try { res.json(await listSpaces()); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/spaces', adminMiddleware, async (req, res) => {
  try {
    const { name, slug, description, type, color, icon } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const space = await createSpace(name.trim(), { slug, description, type, color, icon });
    res.json(space);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/spaces/:id', adminMiddleware, async (req, res) => {
  try {
    const space = await updateSpace(parseInt(req.params.id as string), req.body);
    if (!space) return res.status(404).json({ error: 'space not found' });
    res.json(space);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/spaces/:id', adminMiddleware, async (req, res) => {
  try {
    await deleteSpace(parseInt(req.params.id as string));
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ───── Projects ─────
//
// Realtime broadcasting (added 2026-04-10): every mutating project endpoint
// now fans out a WS event to the project's members so other tabs/devices
// update their sidebars without a refresh. See decisions/2026-04-10-realtime-sync-and-scale.md

/** Fire a WS event to every distinct member of a project, plus an optional extra user. */
async function broadcastToProjectMembers(
  projectId: string,
  data: any,
  extraUserId?: number,
): Promise<void> {
  try {
    const members = await getProjectMembers(projectId);
    const seen = new Set<number>();
    for (const m of members) {
      if (seen.has(m.userId)) continue;
      seen.add(m.userId);
      broadcastToUser(m.userId, data);
    }
    if (extraUserId !== undefined && !seen.has(extraUserId)) {
      broadcastToUser(extraUserId, data);
    }
  } catch (err: any) {
    console.error('[broadcastToProjectMembers] failed:', err?.message || err);
  }
}

router.get('/projects', async (req, res) => {
  const userId = (req as any).user?.userId;
  const role = (req as any).user?.role;
  res.json(await getProjects(userId, role));
});

router.post('/projects', async (req, res) => {
  try {
    const { name, description, rootPath, color, memberIds, groupId, spaceId } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const userId = (req as any).user?.userId;
    const project = await createProject(name.trim(), userId, { description, rootPath, color, spaceId: spaceId ?? null });

    // Add individual members
    if (Array.isArray(memberIds)) {
      for (const mid of memberIds) {
        if (typeof mid === 'number' && mid !== userId) {
          await addProjectMember(project.id, mid, 'member');
        }
      }
    }
    // Invite group members (snapshot copy)
    if (groupId && typeof groupId === 'number') {
      await inviteGroupToProject(groupId, project.id);
    }

    res.json(project);

    // Realtime: push new project to every member (incl. creator cross-device)
    broadcastToProjectMembers(project.id, { type: 'project_created', project }, userId);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/projects/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (role !== 'admin' && userId) {
      if (!(await isProjectOwner(req.params.id as string, userId))) {
        return res.status(403).json({ error: 'only owner or admin can update project' });
      }
    }
    const project = await updateProject(req.params.id as string, req.body);
    if (!project) return res.status(404).json({ error: 'project not found' });
    res.json(project);

    // Realtime: push updated metadata to all project members
    broadcastToProjectMembers(project.id, { type: 'project_updated', project });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const projectId = req.params.id as string;
    if (role !== 'admin' && userId) {
      if (!(await isProjectOwner(projectId, userId))) {
        return res.status(403).json({ error: 'only owner or admin can delete project' });
      }
    }
    // Snapshot members BEFORE deletion so we can notify them after.
    let formerMemberIds: number[] = [];
    try {
      const members = await getProjectMembers(projectId);
      formerMemberIds = Array.from(new Set(members.map(m => m.userId)));
    } catch { /* best-effort */ }

    const ok = await deleteProject(projectId);
    if (!ok) return res.status(404).json({ error: 'project not found' });
    res.json({ ok: true });

    // Realtime: notify the users who previously had this project
    const payload = { type: 'project_deleted', projectId };
    for (const uid of formerMemberIds) broadcastToUser(uid, payload);
    if (userId && !formerMemberIds.includes(userId)) broadcastToUser(userId, payload);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ───── Project Members ─────

router.get('/projects/:id/members', async (req, res) => {
  const userId = (req as any).user?.userId;
  const role = (req as any).user?.role;
  const projectId = req.params.id as string;
  // Any member, owner, or admin can view members
  if (role !== 'admin' && userId) {
    const project = await getProject(projectId);
    if (!project) return res.status(404).json({ error: 'project not found' });
    if (project.userId !== userId && !(await isProjectMember(projectId, userId))) {
      return res.status(403).json({ error: 'not a member' });
    }
  }
  res.json(await getProjectMembers(projectId));
});

router.post('/projects/:id/members', async (req, res) => {
  const userId = (req as any).user?.userId;
  const role = (req as any).user?.role;
  const projectId = req.params.id as string;

  // Only owner or admin can add members
  if (role !== 'admin' && !(await isProjectOwner(projectId, userId))) {
    return res.status(403).json({ error: 'only owner or admin can add members' });
  }

  const { userId: targetUserId, groupId: targetGroupId } = req.body;

  if (targetGroupId && typeof targetGroupId === 'number') {
    const added = await inviteGroupToProject(targetGroupId, projectId);
    res.json({ ok: true, added });

    // Realtime: whole group invited — refresh every current member + the full
    // project so newly added users receive it in their sidebar immediately.
    try {
      const project = await getProject(projectId);
      if (project) {
        await broadcastToProjectMembers(projectId, {
          type: 'project_members_changed',
          projectId,
          project,
        });
      }
    } catch { /* best-effort */ }
    return;
  }

  if (!targetUserId || typeof targetUserId !== 'number') {
    return res.status(400).json({ error: 'userId or groupId required' });
  }

  await addProjectMember(projectId, targetUserId, 'member');
  res.json({ ok: true });

  // Realtime: notify existing members + the invitee (who may not be in
  // project_members cache yet — pass explicitly as extraUserId).
  try {
    const project = await getProject(projectId);
    if (project) {
      await broadcastToProjectMembers(
        projectId,
        { type: 'project_member_added', projectId, userId: targetUserId, project },
        targetUserId,
      );
    }
  } catch { /* best-effort */ }
});

router.delete('/projects/:id/members/:uid', async (req, res) => {
  const userId = (req as any).user?.userId;
  const role = (req as any).user?.role;
  const projectId = req.params.id as string;
  const targetUserId = parseInt(req.params.uid as string);

  // Only owner or admin can remove members
  if (role !== 'admin' && !(await isProjectOwner(projectId, userId))) {
    return res.status(403).json({ error: 'only owner or admin can remove members' });
  }

  // Snapshot members BEFORE removal so we can notify the one being kicked.
  let priorMemberIds: number[] = [];
  try {
    const priorMembers = await getProjectMembers(projectId);
    priorMemberIds = Array.from(new Set(priorMembers.map(m => m.userId)));
  } catch { /* best-effort */ }

  const ok = await removeProjectMember(projectId, targetUserId);
  if (!ok) return res.status(400).json({ error: 'cannot remove last owner' });
  res.json({ ok: true });

  // Realtime: tell remaining members + the removed user. The removed user
  // gets a distinct payload so the frontend can drop the project from their sidebar.
  const payload = { type: 'project_member_removed', projectId, userId: targetUserId };
  for (const uid of priorMemberIds) broadcastToUser(uid, payload);
  // Make sure the removed user gets the notice even if they were already gone from cache.
  if (!priorMemberIds.includes(targetUserId)) {
    broadcastToUser(targetUserId, payload);
  }
});

// ───── User Search (for member invitation) ─────

router.get('/users/search', async (req, res) => {
  // NOTE on limits: the invite dropdown filters by `!memberIds.includes(u.id)`
  // on the client, so the empty-query branch MUST return every active user or
  // large teams would silently lose alphabetically-late names. 1000 is a safe
  // hard cap against runaway payloads; typed-search stays at 20.
  const q = (req.query.q as string || '').trim();
  if (!q) {
    const users = await query<{ id: number; username: string }>(
      `SELECT id, username FROM users WHERE disabled = 0 ORDER BY username LIMIT 1000`
    );
    return res.json(users);
  }
  const users = await query<{ id: number; username: string }>(
    `SELECT id, username FROM users WHERE disabled = 0 AND username LIKE $1 ORDER BY username LIMIT 20`,
    [`%${q}%`]
  );
  res.json(users);
});

router.post('/projects/reorder', async (req, res) => {
  try {
    const { projectIds } = req.body;
    if (!Array.isArray(projectIds)) return res.status(400).json({ error: 'projectIds array required' });
    await reorderProjects(projectIds);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sessions/:id/move', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const { projectId } = req.body;

    // 1. Verify session ownership (only owner or admin can move)
    if (userId) {
      const access = await canAccessSession(req.params.id as string, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }

    // 2. Verify target project membership (must be member to move into)
    if (projectId) {
      const projAccess = await canCreateInProject(projectId, userId, role);
      if (!projAccess.allowed) return res.status(projAccess.status).json({ error: projAccess.message });
    }

    const ok = await moveSessionToProject(req.params.id as string, projectId ?? null);
    if (!ok) return res.status(404).json({ error: 'session or project not found' });
    // Broadcast so all connected clients update their session lists
    broadcast({ type: 'session_moved', sessionId: req.params.id as string, projectId: projectId ?? null });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ───── Kanban Tasks ─────
router.get('/tasks', async (req, res) => {
  try {
    const tasks = await getTasks((req as any).user?.userId, (req as any).user?.role);
    res.json(tasks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tasks/meta', async (req, res) => {
  try {
    const cwds = await getDistinctCwds((req as any).user?.userId);
    res.json({ cwds });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks', async (req, res) => {
  try {
    const { title, description, cwd, model, scheduledAt, scheduleCron, scheduleEnabled, workflow, parentTaskId, projectId } = req.body;
    if (!title || !cwd) return res.status(400).json({ error: 'title and cwd required' });
    const schedule = (scheduledAt || scheduleCron || scheduleEnabled)
      ? { scheduledAt, scheduleCron, scheduleEnabled }
      : undefined;
    const task = await createTask(title, description || '', cwd, (req as any).user?.userId, model, schedule, workflow, parentTaskId, projectId);
    // Broadcast to all connected clients so kanban boards update in real-time
    broadcast({ type: 'task_created', task });
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/tasks/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessTask(req.params.id as string, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const task = await updateTask(req.params.id as string, req.body);
    if (!task) return res.status(404).json({ error: 'task not found' });
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/tasks/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessTask(req.params.id as string, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const ok = await deleteTask(req.params.id as string);
    if (!ok) return res.status(404).json({ error: 'task not found' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tasks/:id/children', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessTask(req.params.id as string, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const children = await getChildTasks(req.params.id as string);
    res.json(children);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks/:id/cleanup-worktree', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessTask(req.params.id as string, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const task = await getTask(req.params.id as string);
    if (!task) return res.status(404).json({ error: 'task not found' });
    if (task.status === 'in_progress') return res.status(400).json({ error: 'cannot cleanup worktree for running task' });
    if (!task.worktreePath) return res.status(400).json({ error: 'task has no worktree' });

    const ok = removeWorktree(task.worktreePath);
    if (ok) {
      await updateTask(req.params.id as string, { worktreePath: null });
    }
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks/reorder', async (req, res) => {
  try {
    // reorder: verify all tasks belong to user or user has access
    // For now, only admin can reorder arbitrary tasks; others limited to own
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const { taskIds, status } = req.body;
    if (!taskIds || !status) return res.status(400).json({ error: 'taskIds and status required' });
    if (role !== 'admin' && userId && taskIds.length > 0) {
      // Spot-check first task for access
      const access = await canAccessTask(taskIds[0], userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    await reorderTasks(taskIds, status);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── History (archived sessions + tasks) ──────────────────
router.get('/history', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    const sessions = await getArchivedSessions(userId, role);
    const tasks = await getArchivedTasks(userId);
    res.json({ sessions, tasks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sessions/:id/restore', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canDeleteSession(req.params.id, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const ok = await restoreSession(req.params.id as string);
    if (!ok) return res.status(404).json({ error: 'session not found' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/sessions/:id/permanent', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canDeleteSession(req.params.id, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const ok = await permanentlyDeleteSession(req.params.id as string);
    if (!ok) return res.status(404).json({ error: 'session not found' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks/:id/restore', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessTask(req.params.id as string, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const ok = await restoreTask(req.params.id as string);
    if (!ok) return res.status(404).json({ error: 'task not found' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/tasks/:id/permanent', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessTask(req.params.id as string, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const ok = await permanentlyDeleteTask(req.params.id as string);
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
    const userRole = (req as any).user.role;
    const [rooms, unreadMap] = await Promise.all([
      listRooms(userId, userRole),
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
    const { createRoom, getMembers } = await import('../services/room-manager.js');
    const { name, description, roomType, projectId } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    // Project access check for room creation
    const userId = (req as any).user.userId;
    const role = (req as any).user.role;
    if (projectId) {
      const access = await canCreateInProject(projectId, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const room = await createRoom(name, description ?? null, roomType || 'team', userId, projectId);
    res.json(room);

    // Realtime: createRoom already auto-adds project/group members. Fetch the
    // final roster and push the new room to each so their sidebar updates.
    try {
      const members = await getMembers(room.id);
      const payload = { type: 'room_created', room };
      const seen = new Set<number>();
      for (const m of members) {
        if (seen.has(m.userId)) continue;
        seen.add(m.userId);
        broadcastToUser(m.userId, payload);
      }
      if (!seen.has(userId)) broadcastToUser(userId, payload);
    } catch { /* best-effort */ }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/rooms/:id', authMiddleware, async (req, res) => {
  try {
    const { getRoom, getMembers, isMember } = await import('../services/room-manager.js');
    const room = await getRoom(req.params.id as string);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const userId = (req as any).user.userId;
    if (!(await isMember(req.params.id as string, userId))) return res.status(403).json({ error: 'Not a member' });
    const members = await getMembers(req.params.id as string);
    res.json({ ...room, members });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/rooms/:id', authMiddleware, async (req, res) => {
  try {
    const roomId = req.params.id as string;
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessRoom(roomId, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const { updateRoom, getMembers } = await import('../services/room-manager.js');
    const room = await updateRoom(roomId, req.body);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room);

    // Realtime: send updated room metadata to every member (sidebar + header)
    try {
      const members = await getMembers(roomId);
      const payload = { type: 'room_updated', room };
      const seen = new Set<number>();
      for (const m of members) {
        if (seen.has(m.userId)) continue;
        seen.add(m.userId);
        broadcastToUser(m.userId, payload);
      }
    } catch { /* best-effort */ }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/rooms/:id', authMiddleware, async (req, res) => {
  try {
    const roomId = req.params.id as string;
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessRoom(roomId, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const { deleteRoom, getMembers } = await import('../services/room-manager.js');

    // Snapshot members BEFORE deletion so we can notify them.
    let formerMemberIds: number[] = [];
    try {
      const members = await getMembers(roomId);
      formerMemberIds = Array.from(new Set(members.map(m => m.userId)));
    } catch { /* best-effort */ }

    const ok = await deleteRoom(roomId);
    if (!ok) return res.status(404).json({ error: 'Room not found' });
    res.json({ success: true });

    // Realtime: drop the room from every former member's sidebar.
    const payload = { type: 'room_deleted', roomId };
    for (const uid of formerMemberIds) broadcastToUser(uid, payload);
    if (userId && !formerMemberIds.includes(userId)) broadcastToUser(userId, payload);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/rooms/:id/invitable-users', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessRoom(req.params.id as string, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const { getMembers } = await import('../services/room-manager.js');
    const members = await getMembers(req.params.id as string);
    const memberUserIds = new Set(members.map(m => m.userId));

    // Get all active users, exclude current members
    const allUsers = await query<{ id: number; username: string; role: string }>(
      'SELECT id, username, role FROM users WHERE disabled = 0 ORDER BY username'
    );

    const invitable = allUsers
      .filter(u => !memberUserIds.has(u.id))
      .map(u => ({ id: u.id, username: u.username, role: u.role }));

    res.json({ users: invitable });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/rooms/:id/members', authMiddleware, async (req, res) => {
  try {
    const reqUserId = (req as any).user?.userId;
    const reqRole = (req as any).user?.role;
    if (reqUserId) {
      const access = await canAccessRoom(req.params.id as string, reqUserId, reqRole);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const { addMember, getRoom } = await import('../services/room-manager.js');
    const { userId, role } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const member = await addMember(req.params.id as string, userId, role);
    res.json(member);

    // Notify room members about new member (real-time update)
    try {
      const { broadcastToRoom, broadcastToUser } = await import('./ws-handler.js');
      broadcastToRoom(req.params.id as string, {
        type: 'room_member_added',
        roomId: req.params.id as string,
        member,
      });

      // Notify the invited user so they see the room in their list
      const room = await getRoom(req.params.id as string);
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
    const reqUserId = (req as any).user?.userId;
    const reqRole = (req as any).user?.role;
    if (reqUserId) {
      const access = await canAccessRoom(req.params.id as string, reqUserId, reqRole);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const { removeMember } = await import('../services/room-manager.js');
    const removedUserId = parseInt(req.params.userId as string);
    const ok = await removeMember(req.params.id as string, removedUserId);
    if (!ok) return res.status(404).json({ error: 'Member not found' });
    res.json({ success: true });

    // Notify room members about removed member
    try {
      const { broadcastToRoom, broadcastToUser } = await import('./ws-handler.js');
      broadcastToRoom(req.params.id as string, {
        type: 'room_member_removed',
        roomId: req.params.id as string,
        userId: removedUserId,
      });
      // Notify the removed user
      broadcastToUser(removedUserId, {
        type: 'room_removed',
        roomId: req.params.id as string,
      });
    } catch { /* WS notification is best-effort */ }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/rooms/:id/messages', authMiddleware, async (req, res) => {
  try {
    const { getMessages: getRoomMessages, isMember } = await import('../services/room-manager.js');
    const userId = (req as any).user.userId;
    if (!(await isMember(req.params.id as string, userId))) return res.status(403).json({ error: 'Not a member' });
    const messages = await getRoomMessages(req.params.id as string, {
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
    const userId = (req as any).user?.userId;
    const notifId = req.params.id as string;
    const { markNotificationRead, getUnreadCount } = await import('../services/room-manager.js');
    await markNotificationRead(notifId, userId);
    res.json({ success: true });

    // Realtime: sync read state across this user's tabs/devices.
    // Include the fresh unreadCount so each tab can update its badge directly.
    if (userId) {
      try {
        const unreadCount = await getUnreadCount(userId);
        broadcastToUser(userId, {
          type: 'notification_read',
          notificationId: notifId,
          unreadCount,
        });
      } catch { /* best-effort */ }
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/notifications/read-all', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { markAllNotificationsRead } = await import('../services/room-manager.js');
    const count = await markAllNotificationsRead(userId);
    res.json({ success: true, count });

    // Realtime: sync read-all state across this user's tabs/devices.
    broadcastToUser(userId, {
      type: 'notification_read_all',
      unreadCount: 0,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Heartbeat ───────────────────────────────────────────────────────

router.get('/heartbeats', authMiddleware, async (_req, res) => {
  try {
    const { listHeartbeats } = await import('../services/heartbeat.js');
    res.json({ heartbeats: listHeartbeats() });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/heartbeats', authMiddleware, async (req, res) => {
  try {
    const { registerHeartbeat } = await import('../services/heartbeat.js');
    const config = req.body;
    if (!config.projectId || !config.projectName || !config.projectPath) {
      return res.status(400).json({ error: 'projectId, projectName, projectPath required' });
    }
    registerHeartbeat({
      intervalMinutes: 60,
      autonomyLevel: 1,
      enabled: true,
      ...config,
    });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/heartbeats/:projectId', adminMiddleware, async (req, res) => {
  try {
    const { updateHeartbeat, getHeartbeatConfig } = await import('../services/heartbeat.js');
    const { projectId } = req.params;
    if (!getHeartbeatConfig(projectId as string)) {
      return res.status(404).json({ error: 'Heartbeat not found' });
    }
    updateHeartbeat(projectId as string, req.body);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/heartbeats/:projectId', authMiddleware, async (req, res) => {
  try {
    const { unregisterHeartbeat } = await import('../services/heartbeat.js');
    unregisterHeartbeat(req.params.projectId as string);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Run heartbeat now (all or single project)
router.post('/heartbeats/run', adminMiddleware, async (req, res) => {
  try {
    const { runHeartbeatNow } = await import('../services/heartbeat.js');
    const { projectId } = req.body || {};
    const result = await runHeartbeatNow(projectId);
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Help docs ── */

const _apiDirname = path.dirname(new URL(import.meta.url).pathname);
// Tower repo root: from packages/backend/routes/ go up 3 levels, or from dist/ go up 4
const _towerRoot = _apiDirname.includes('dist')
  ? path.resolve(_apiDirname, '..', '..', '..', '..')
  : path.resolve(_apiDirname, '..', '..', '..');
const HELP_DIR = path.join(_towerRoot, 'docs', 'help');

router.get('/help', async (req, res) => {
  try {
    const lang = (req.query.lang === 'ko') ? 'ko' : 'en';
    const helpDir = path.join(HELP_DIR, lang);
    const files = await fsPromises.readdir(helpDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));
    const topics: { slug: string; title: string; icon: string; order: number }[] = [];
    for (const file of mdFiles) {
      const raw = await fsPromises.readFile(path.join(helpDir, file), 'utf-8');
      const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---/);
      let title = file.replace(/\.md$/, '');
      let icon = '📄';
      let order = 99;
      if (frontmatterMatch) {
        const fm = frontmatterMatch[1];
        const titleMatch = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m);
        const iconMatch = fm.match(/^icon:\s*["']?(.+?)["']?\s*$/m);
        const orderMatch = fm.match(/^order:\s*(\d+)/m);
        if (titleMatch) title = titleMatch[1];
        if (iconMatch) icon = iconMatch[1];
        if (orderMatch) order = parseInt(orderMatch[1]);
      }
      topics.push({ slug: file.replace(/\.md$/, ''), title, icon, order });
    }
    topics.sort((a, b) => a.order - b.order);
    res.json(topics);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/help/:slug', async (req, res) => {
  try {
    const lang = (req.query.lang === 'ko') ? 'ko' : 'en';
    const helpDir = path.join(HELP_DIR, lang);
    const slug = req.params.slug.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(helpDir, `${slug}.md`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Help topic not found' });
    }
    const raw = await fsPromises.readFile(filePath, 'utf-8');
    // Strip YAML frontmatter
    const content = raw.replace(/^---\n[\s\S]*?\n---\n*/, '');
    res.type('text/plain').send(content);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ───── Publishing & Deploy Engine ─────
import { deploy, listDeployments, deleteDeployment, detectCodeType, getPublishStatus, getTrafficStats } from '../services/deploy-engine.js';
import { publishViaGateway } from '../services/publish-client.js';

// Publish status (replaces Hub /health) — returns sites/apps with live status checks
router.get('/publish/status', authMiddleware, async (_req, res) => {
  try {
    const status = await getPublishStatus();
    res.json(status);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Publish traffic stats (replaces Hub /stats) — parses nginx access log
router.get('/publish/stats', authMiddleware, async (_req, res) => {
  try {
    const stats = await getTrafficStats();
    res.json(stats);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Publish info — returns tower role + config for frontend UI
router.get('/publish/info', authMiddleware, async (_req, res) => {
  const info: Record<string, unknown> = {
    role: config.towerRole,
    gatewayConfigured: config.towerRole === 'managed' && !!config.publishGatewayUrl,
  };
  // For managed mode, show gateway URL (not the key)
  if (config.towerRole === 'managed' && config.publishGatewayUrl) {
    info.gatewayUrl = config.publishGatewayUrl;
  }
  // For full mode, indicate gateway is serving
  if (config.towerRole === 'full') {
    info.gatewayEnabled = true;
  }
  res.json(info);
});

// Detect code type for a directory
router.post('/deploy/detect', authMiddleware, async (req, res) => {
  try {
    const { sourceDir } = req.body;
    if (!sourceDir) return res.status(400).json({ error: 'sourceDir required' });
    const type = await detectCodeType(sourceDir);
    res.json({ type, recommendedTarget: type === 'static' ? 'cloudflare-pages' : 'azure-container-apps' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Deploy a site or app
// When TOWER_ROLE=managed, routes through the Central Publish Gateway
// When full/standalone, deploys directly via Cloudflare/Azure
router.post('/deploy', authMiddleware, async (req, res) => {
  try {
    const { name, sourceDir, target, port, env, description } = req.body;
    if (!name || !sourceDir) return res.status(400).json({ error: 'name and sourceDir required' });

    // Validate name format
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      return res.status(400).json({ error: 'name must be lowercase alphanumeric with hyphens' });
    }

    if (config.towerRole === 'managed') {
      // Route through Central Publish Gateway
      const result = await publishViaGateway({ name, sourceDir, type: undefined, target, port, description });
      res.json(result);
    } else {
      // Direct deploy (full or standalone)
      const result = await deploy({ name, sourceDir, target, port, env, description });
      res.json(result);
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// List all deployments
router.get('/deploy/list', authMiddleware, async (_req, res) => {
  try {
    const deployments = await listDeployments();
    res.json(deployments);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Delete a deployment
router.delete('/deploy/:type/:name', authMiddleware, async (req, res) => {
  try {
    const { type, name } = req.params;
    if (type !== 'site' && type !== 'app') return res.status(400).json({ error: 'type must be site or app' });
    const result = await deleteDeployment(name as string, type);
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// Unified Schedules — 스케줄 통합 시스템
// ═══════════════════════════════════════════════════════════════

import {
  getSchedules, getSchedule, createSchedule, updateSchedule, deleteSchedule,
  getScheduleRuns, runScheduleNow,
} from '../services/unified-scheduler.js';

router.get('/schedules', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const schedules = await getSchedules(userId);
    res.json(schedules);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/schedules/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const schedule = await getSchedule(id);
    if (!schedule) return res.status(404).json({ error: 'not found' });
    res.json(schedule);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/schedules', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const { name, prompt, model, mode, targetId, triggerType, cronConfig, onceAt, projectId } = req.body;
    if (!name || !prompt) return res.status(400).json({ error: 'name and prompt required' });
    if (!['spawn', 'inject', 'channel'].includes(mode || 'spawn')) {
      return res.status(400).json({ error: 'mode must be spawn, inject, or channel' });
    }

    const schedule = await createSchedule({
      userId,
      projectId,
      name,
      prompt,
      model,
      mode: mode || 'spawn',
      targetId,
      triggerType: triggerType || 'cron',
      cronConfig,
      onceAt,
    });
    res.json(schedule);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/schedules/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const existing = await getSchedule(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const userId = (req as any).user?.userId;
    if (existing.userId !== userId) return res.status(403).json({ error: 'forbidden' });

    const schedule = await updateSchedule(id, req.body);
    res.json(schedule);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/schedules/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const existing = await getSchedule(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const userId = (req as any).user?.userId;
    if (existing.userId !== userId) return res.status(403).json({ error: 'forbidden' });

    await deleteSchedule(id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/schedules/:id/run-now', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const existing = await getSchedule(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const userId = (req as any).user?.userId;
    if (existing.userId !== userId) return res.status(403).json({ error: 'forbidden' });

    const result = await runScheduleNow(id);
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/schedules/:id/runs', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const limit = parseInt(req.query.limit as string) || 20;
    const runs = await getScheduleRuns(id, Math.min(limit, 100));
    res.json(runs);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// Automations — Tasks + Schedules 통합 API
// ═══════════════════════════════════════════════════════════════

import {
  getAutomations, getAutomation, createAutomation, updateAutomation,
  deleteAutomation, restoreAutomation, permanentlyDeleteAutomation,
  getChildAutomations, reorderAutomations, getArchivedAutomations,
  getAutomationRuns, getDistinctCwds as getAutomationCwds,
  getTemplates, createFromTemplate,
  type AutomationFilters,
} from '../services/automation-manager.js';

// List automations (with filters)
router.get('/automations', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const filters: AutomationFilters = {};
    if (req.query.status) {
      const s = req.query.status as string;
      filters.status = s.includes(',') ? s.split(',') as any : s as any;
    }
    if (req.query.trigger) filters.triggerType = req.query.trigger as any;
    if (req.query.project) filters.projectId = req.query.project as string;
    if (req.query.mode) filters.mode = req.query.mode as any;
    if (req.query.includeArchived === 'true') filters.includeArchived = true;

    const automations = await getAutomations(userId, role, filters);
    res.json(automations);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// CWD metadata
router.get('/automations/meta', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const cwds = await getAutomationCwds(userId);
    res.json({ cwds });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Templates
router.get('/automations/templates', authMiddleware, async (_req, res) => {
  try {
    res.json(getTemplates());
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Create from template
router.post('/automations/from-template', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const { templateId, ...overrides } = req.body;
    if (!templateId) return res.status(400).json({ error: 'templateId required' });

    const automation = await createFromTemplate(templateId, userId, overrides);
    res.json(automation);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Get one
router.get('/automations/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const automation = await getAutomation(id);
    if (!automation) return res.status(404).json({ error: 'not found' });
    res.json(automation);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Create
router.post('/automations', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const { name, prompt, description, model, workflow, mode, targetId, cwd,
            triggerType, cronConfig, onceAt, parentId, projectId,
            roomId, triggeredBy, roomMessageId } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const automation = await createAutomation({
      userId, projectId, name, description, prompt: prompt || '',
      model, workflow, mode, targetId, cwd,
      triggerType, cronConfig, onceAt, parentId,
      roomId, triggeredBy, roomMessageId,
    });
    res.json(automation);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Update
router.patch('/automations/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const existing = await getAutomation(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (existing.userId !== userId && role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }

    const automation = await updateAutomation(id, req.body);
    res.json(automation);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Delete (soft)
router.delete('/automations/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const existing = await getAutomation(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (existing.userId !== userId && role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }

    await deleteAutomation(id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Permanently delete
router.delete('/automations/:id/permanent', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    await permanentlyDeleteAutomation(id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Restore from archive
router.post('/automations/:id/restore', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const ok = await restoreAutomation(id);
    res.json({ success: ok });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Child automations
router.get('/automations/:id/children', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const children = await getChildAutomations(id);
    res.json(children);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Run history
router.get('/automations/:id/runs', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const limit = parseInt(req.query.limit as string) || 20;
    const runs = await getAutomationRuns(id, Math.min(limit, 100));
    res.json(runs);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Reorder (kanban drag-drop)
router.post('/automations/reorder', authMiddleware, async (req, res) => {
  try {
    const { taskIds, status } = req.body;
    if (!Array.isArray(taskIds) || !status) {
      return res.status(400).json({ error: 'taskIds array and status required' });
    }
    await reorderAutomations(taskIds, status);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Archived
router.get('/automations/archived', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const archived = await getArchivedAutomations(userId);
    res.json(archived);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// Proactive Agent — AI가 먼저 말을 거는 시스템
// ═══════════════════════════════════════════════════════════════

router.post('/proactive/fire', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const userRole = (req as any).user?.role;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    if (userRole !== 'admin') return res.status(403).json({ error: 'admin only (phase 1)' });

    const { templateName, prompt, context, projectId, model, targetSessionId } = req.body;
    if (!templateName || !prompt) {
      return res.status(400).json({ error: 'templateName and prompt are required' });
    }

    const { fireProactive } = await import('../services/proactive-agent.js');

    const template = {
      id: `manual-${Date.now()}`,
      name: templateName,
      prompt,
      model: model || undefined,
      projectId: projectId || undefined,
    };

    const result = await fireProactive(
      userId,
      template,
      context ? { summary: context } : undefined,
      targetSessionId ? { targetSessionId } : undefined,
    );

    res.json(result);
  } catch (err: any) {
    console.error('[proactive] Fire error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ───── Fleet Management (admin-only, internal) ─────
import {
  getCustomers, getCustomer, getFleetStatus, getVMStatus,
  checkWorkspace, getLogs, remoteExec,
} from '../services/fleet-manager.js';

// List all customers
router.get('/admin/fleet', adminMiddleware, async (_req, res) => {
  try {
    const customers = await getCustomers();
    res.json(customers);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Full fleet status (SSHs into all VMs)
router.get('/admin/fleet/status', adminMiddleware, async (_req, res) => {
  try {
    const status = await getFleetStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Single customer status
router.get('/admin/fleet/:customer/status', adminMiddleware, async (req, res) => {
  try {
    const info = await getCustomer(req.params.customer as string);
    if (!info) return res.status(404).json({ error: 'Customer not found' });
    const status = await getVMStatus(info);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Workspace health check
router.get('/admin/fleet/:customer/workspace', adminMiddleware, async (req, res) => {
  try {
    const info = await getCustomer(req.params.customer as string);
    if (!info) return res.status(404).json({ error: 'Customer not found' });
    const check = await checkWorkspace(info);
    res.json(check);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Logs
router.get('/admin/fleet/:customer/logs', adminMiddleware, async (req, res) => {
  try {
    const info = await getCustomer(req.params.customer as string);
    if (!info) return res.status(404).json({ error: 'Customer not found' });
    const lines = parseInt(req.query.lines as string) || 30;
    const logs = await getLogs(info, Math.min(lines, 200));
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Remote command execution
router.post('/admin/fleet/:customer/exec', adminMiddleware, async (req, res) => {
  try {
    const info = await getCustomer(req.params.customer as string);
    if (!info) return res.status(404).json({ error: 'Customer not found' });
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'command required' });
    const output = await remoteExec(info, command);
    res.json({ output });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
