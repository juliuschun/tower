/**
 * messaging/kakao.ts — KakaoTalk "나에게 보내기" adapter.
 *
 * Uses Kakao REST API to send messages to user's own KakaoTalk.
 * No business messaging provider needed — direct OAuth integration.
 *
 * API: POST https://kapi.kakao.com/v2/api/talk/memo/default/send
 * Scope: talk_message
 * Rate limit: 100 messages/day per user
 */

import type { MessageChannel, SendOptions, SendResult } from './types.js';
import { config } from '../../config.js';
import type { RefreshFn } from '../oauth-manager.js';

const DEFAULT_LINK = 'https://tower.moatai.app';
const TEXT_LIMIT = 200;

type GetValidTokenFn = (userId: number, provider: string) => Promise<string>;

// ── Kakao OAuth helpers (used by auth routes) ──

export async function exchangeKakaoCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}> {
  const res = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.kakaoRestKey,
      client_secret: config.kakaoClientSecret,
      redirect_uri: config.kakaoRedirectUri,
      code,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kakao token exchange failed: ${err}`);
  }
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    refreshExpiresIn: data.refresh_token_expires_in,
  };
}

export async function getKakaoProfile(accessToken: string): Promise<{
  id: string;
  nickname: string;
}> {
  const res = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to get Kakao profile');
  const data = await res.json();
  return {
    id: String(data.id),
    nickname: data.kakao_account?.profile?.nickname || data.properties?.nickname || 'Unknown',
  };
}

/** Register as refresher in oauthManager during init */
export const kakaoRefresher: RefreshFn = async (refreshToken: string) => {
  const res = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.kakaoRestKey,
      client_secret: config.kakaoClientSecret,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kakao token refresh failed: ${err}`);
  }
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    refreshExpiresIn: data.refresh_token_expires_in,
  };
};

// ── Template builders (exported for testing) ──

export function buildTextTemplate(content: string, options?: SendOptions) {
  return {
    object_type: 'text' as const,
    text: content.slice(0, TEXT_LIMIT),
    link: {
      web_url: options?.linkUrl || DEFAULT_LINK,
      mobile_web_url: options?.linkUrl || DEFAULT_LINK,
    },
    button_title: options?.buttonTitle || 'Tower 열기',
  };
}

export function buildFeedTemplate(title: string, description: string, options?: SendOptions) {
  return {
    object_type: 'feed' as const,
    content: {
      title,
      description: description.slice(0, TEXT_LIMIT),
      ...(options?.imageUrl && { image_url: options.imageUrl }),
      link: {
        web_url: options?.linkUrl || DEFAULT_LINK,
        mobile_web_url: options?.linkUrl || DEFAULT_LINK,
      },
    },
    buttons: [{
      title: options?.buttonTitle || '자세히 보기',
      link: {
        web_url: options?.linkUrl || DEFAULT_LINK,
        mobile_web_url: options?.linkUrl || DEFAULT_LINK,
      },
    }],
  };
}

// ── KakaoChannel ──

export class KakaoChannel implements MessageChannel {
  readonly provider = 'kakao';
  private getValidToken: GetValidTokenFn;

  constructor(getValidToken: GetValidTokenFn) {
    this.getValidToken = getValidToken;
  }

  async send(userId: number, content: string, options?: SendOptions): Promise<SendResult> {
    try {
      const token = await this.getValidToken(userId, 'kakao');

      const templateObject = options?.title
        ? buildFeedTemplate(options.title, content, options)
        : buildTextTemplate(content, options);

      const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        },
        body: new URLSearchParams({
          template_object: JSON.stringify(templateObject),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'unknown' }));
        return { success: false, error: `Kakao API error: ${JSON.stringify(err)}` };
      }

      const data = await res.json();
      return {
        success: data.result_code === 0,
        error: data.result_code !== 0 ? `result_code: ${data.result_code}` : undefined,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async isConnected(userId: number): Promise<boolean> {
    try {
      await this.getValidToken(userId, 'kakao');
      return true;
    } catch {
      return false;
    }
  }
}
