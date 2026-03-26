/**
 * messaging/index.ts — Initialize all messaging channels + singleton manager.
 *
 * Exports the shared oauthManager and messageRouter instances.
 */

export { MessageRouter } from './router.js';
export type { MessageChannel, SendOptions, SendResult } from './types.js';

import { createOAuthManager } from '../oauth-manager.js';
import { pgOAuthStore } from '../oauth-store-pg.js';
import { MessageRouter } from './router.js';
import { KakaoChannel, kakaoRefresher } from './kakao.js';

// ── Singleton OAuth manager (uses PostgreSQL store) ──
export const oauthManager = createOAuthManager(pgOAuthStore);
oauthManager.registerRefresher('kakao', kakaoRefresher);

// ── Singleton message router ──
export const messageRouter = new MessageRouter();

// ── Register channels ──
const kakao = new KakaoChannel((userId, provider) => oauthManager.getValidToken(userId, provider));
messageRouter.register(kakao);

// Future:
// messageRouter.register(new SlackChannel(...));
// messageRouter.register(new TelegramChannel(...));
