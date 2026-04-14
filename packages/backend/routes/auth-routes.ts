import { Router } from 'express';
import {
  authenticateUser, createUser, hasUsers, generateToken, verifyToken, authMiddleware, extractToken,
} from '../services/auth.js';
import { oauthManager, messageRouter, telegramLinkManager } from '../services/messaging/index.js';
import { exchangeKakaoCode, getKakaoProfile } from 'notify-hub';
import { isGoogleOAuthConfigured, getGoogleAuthUrl, exchangeGoogleCode, getGoogleUserInfo } from '../services/google-oauth.js';
import { parseTelegramWebhook, TelegramChannel } from 'notify-hub';
import { config } from '../config.js';

const router = Router();

// Helper: set tower_token cookie alongside JSON response
function setTokenCookie(res: any, token: string) {
  res.cookie('tower_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
  });
}

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

export default router;
