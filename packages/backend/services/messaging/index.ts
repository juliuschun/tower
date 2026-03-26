/**
 * messaging/index.ts — Tower glue code for notify-hub.
 *
 * Wires notify-hub channels with Tower's PostgreSQL store and config.
 */

import {
  createOAuthManager,
  MessageRouter,
  TelegramChannel,
  KakaoChannel,
  createKakaoRefresher,
  createLinkManager,
} from 'notify-hub';
import type { LinkManager } from 'notify-hub';
import { pgOAuthStore } from '../oauth-store-pg.js';
import { config } from '../../config.js';
import { query } from '../../db/pg-repo.js';

// ── Singleton OAuth manager (uses PostgreSQL store) ──
export const oauthManager = createOAuthManager(pgOAuthStore);
oauthManager.registerRefresher('kakao', createKakaoRefresher({
  clientId: config.kakaoRestKey,
  clientSecret: config.kakaoClientSecret,
  redirectUri: config.kakaoRedirectUri,
}));

// ── Singleton message router ──
export const messageRouter = new MessageRouter();

// ── Register Kakao ──
const kakao = new KakaoChannel({
  getValidToken: (userId, provider) => oauthManager.getValidToken(userId, provider),
  defaultLinkUrl: 'https://tower.moatai.app',
});
messageRouter.register(kakao);

// ── Register Telegram ──
async function getTelegramChatId(userId: number): Promise<string | null> {
  const rows = await query<{ provider_user_id: string }>(
    `SELECT provider_user_id FROM user_oauth_tokens WHERE user_id = $1 AND provider = 'telegram'`,
    [userId],
  );
  return rows[0]?.provider_user_id || null;
}

export let telegramLinkManager: LinkManager | undefined;

if (config.telegramBotToken) {
  const telegram = new TelegramChannel({
    botToken: config.telegramBotToken,
    getChatId: getTelegramChatId,
  });
  messageRouter.register(telegram);
  telegramLinkManager = createLinkManager();
}

// Re-export for convenience
export { TelegramChannel, KakaoChannel } from 'notify-hub';
