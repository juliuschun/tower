/**
 * messaging/telegram.ts — Telegram Bot API adapter.
 *
 * Bidirectional messaging via Telegram Bot API:
 * - Outbound: sendMessage API
 * - Inbound: Webhook receives user messages
 *
 * Bot API docs: https://core.telegram.org/bots/api
 * No OAuth needed — users link via /start command with a unique token.
 */

import type { MessageChannel, SendOptions, SendResult } from './types.js';

const TELEGRAM_API = 'https://api.telegram.org';
const TEXT_LIMIT = 4096; // Telegram message limit

type GetChatIdFn = (userId: number) => Promise<string | null>;
type GetValidTokenFn = (userId: number, provider: string) => Promise<string>;

export interface TelegramChannelConfig {
  botToken: string;
  getChatId: GetChatIdFn;
  getValidToken?: GetValidTokenFn; // optional, for future use
}

// ── Text builder (exported for testing) ──

export function buildTelegramText(content: string, options?: SendOptions): string {
  let text = '';

  if (options?.title) {
    text += `<b>${options.title}</b>\n\n`;
  }

  text += content;

  if (options?.linkUrl) {
    const label = options.buttonTitle || '열기';
    text += `\n\n<a href="${options.linkUrl}">${label}</a>`;
  }

  return text.slice(0, TEXT_LIMIT);
}

// ── Webhook parser ──

export interface TelegramWebhookMessage {
  chatId: string;
  fromId: string;
  fromName: string;
  text: string;
  messageId: number;
  date: number;
  isCommand: boolean;
  command?: string;
  commandArg?: string;
}

export function parseTelegramWebhook(update: any): TelegramWebhookMessage | null {
  const msg = update?.message;
  if (!msg || !msg.text) return null;

  // Ignore bot messages
  if (msg.from?.is_bot) return null;

  const text = msg.text as string;
  const isCommand = text.startsWith('/');
  let command: string | undefined;
  let commandArg: string | undefined;

  if (isCommand) {
    const parts = text.split(' ');
    command = parts[0].slice(1); // remove leading '/'
    commandArg = parts.slice(1).join(' ') || undefined;
  }

  return {
    chatId: String(msg.chat.id),
    fromId: String(msg.from.id),
    fromName: msg.from.first_name || 'Unknown',
    text,
    messageId: msg.message_id,
    date: msg.date,
    isCommand,
    command,
    commandArg,
  };
}

// ── TelegramChannel ──

export class TelegramChannel implements MessageChannel {
  readonly provider = 'telegram';
  private botToken: string;
  private getChatId: GetChatIdFn;

  constructor(cfg: TelegramChannelConfig) {
    this.botToken = cfg.botToken;
    this.getChatId = cfg.getChatId;
  }

  async send(userId: number, content: string, options?: SendOptions): Promise<SendResult> {
    try {
      const chatId = await this.getChatId(userId);
      if (!chatId) {
        return { success: false, error: 'No Telegram chat_id found for user. Please link via /start.' };
      }

      const text = buildTelegramText(content, options);
      const hasHtml = options?.title || options?.linkUrl;

      const res = await fetch(`${TELEGRAM_API}/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...(hasHtml && { parse_mode: 'HTML' }),
          disable_web_page_preview: true,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error');
        return { success: false, error: `Telegram HTTP ${res.status}: ${errText}` };
      }

      const data = await res.json();
      if (!data.ok) {
        return { success: false, error: `Telegram API: ${data.description || 'Unknown error'}` };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async isConnected(userId: number): Promise<boolean> {
    const chatId = await this.getChatId(userId);
    return chatId !== null && chatId !== undefined;
  }

  /** Send a raw message to a chat_id (for webhook replies) */
  async sendToChat(chatId: string, text: string, parseMode?: string): Promise<SendResult> {
    try {
      const res = await fetch(`${TELEGRAM_API}/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...(parseMode && { parse_mode: parseMode }),
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error');
        return { success: false, error: errText };
      }

      const data = await res.json();
      return { success: data.ok, error: data.ok ? undefined : data.description };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
