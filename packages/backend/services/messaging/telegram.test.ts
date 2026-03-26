/**
 * telegram.test.ts — TDD Red phase
 *
 * Tests for TelegramChannel: message sending, webhook handling, error handling.
 * Mocks fetch (no real Telegram API calls).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TelegramChannel, parseTelegramWebhook, buildTelegramText } from './telegram';

// ── Mock dependencies ──

const mockGetValidToken = vi.fn();
const mockGetChatId = vi.fn();

// ── Tests ──

describe('TelegramChannel', () => {
  let channel: TelegramChannel;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    channel = new TelegramChannel({
      botToken: 'test-bot-token',
      getChatId: mockGetChatId,
      getValidToken: mockGetValidToken,
    });
    originalFetch = globalThis.fetch;
    mockGetChatId.mockResolvedValue('123456789');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── buildTelegramText ──

  describe('buildTelegramText', () => {
    it('builds plain text message', () => {
      const text = buildTelegramText('안녕하세요');
      expect(text).toBe('안녕하세요');
    });

    it('builds text with title in bold', () => {
      const text = buildTelegramText('내용입니다', { title: '알림' });
      expect(text).toBe('<b>알림</b>\n\n내용입니다');
    });

    it('appends link button text when linkUrl provided', () => {
      const text = buildTelegramText('내용', { linkUrl: 'https://tower.moatai.app', buttonTitle: 'Tower 열기' });
      expect(text).toContain('Tower 열기');
      expect(text).toContain('https://tower.moatai.app');
    });

    it('truncates to 4096 chars (Telegram limit)', () => {
      const long = 'A'.repeat(5000);
      const text = buildTelegramText(long);
      expect(text.length).toBeLessThanOrEqual(4096);
    });
  });

  // ── send ──

  describe('send', () => {
    it('sends message via Telegram Bot API', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 42 } }),
      });

      const result = await channel.send(1, '테스트 메시지');
      expect(result.success).toBe(true);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-bot-token/sendMessage',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );

      // Verify body contains chat_id and text
      const callArgs = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.chat_id).toBe('123456789');
      expect(body.text).toBe('테스트 메시지');
    });

    it('sends HTML formatted message when title provided', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 43 } }),
      });

      await channel.send(1, '내용', { title: '알림 제목' });

      const callArgs = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.parse_mode).toBe('HTML');
      expect(body.text).toContain('<b>알림 제목</b>');
    });

    it('returns error when Telegram API returns non-ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: false, description: 'Bad Request: chat not found' }),
      });

      const result = await channel.send(1, 'fail');
      expect(result.success).toBe(false);
      expect(result.error).toContain('chat not found');
    });

    it('returns error when fetch fails', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await channel.send(1, 'fail');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('returns error when no chat_id found', async () => {
      mockGetChatId.mockResolvedValue(null);

      const result = await channel.send(1, 'fail');
      expect(result.success).toBe(false);
      expect(result.error).toContain('chat_id');
    });

    it('returns error on HTTP failure', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      const result = await channel.send(1, 'fail');
      expect(result.success).toBe(false);
    });
  });

  // ── isConnected ──

  describe('isConnected', () => {
    it('returns true when chat_id exists', async () => {
      mockGetChatId.mockResolvedValue('123456');
      expect(await channel.isConnected(1)).toBe(true);
    });

    it('returns false when no chat_id', async () => {
      mockGetChatId.mockResolvedValue(null);
      expect(await channel.isConnected(1)).toBe(false);
    });
  });
});

// ── Webhook parsing ──

describe('parseTelegramWebhook', () => {
  it('parses a text message update', () => {
    const update = {
      update_id: 12345,
      message: {
        message_id: 1,
        from: { id: 999, first_name: 'John', is_bot: false },
        chat: { id: 999, type: 'private' },
        date: 1711000000,
        text: '안녕하세요',
      },
    };

    const parsed = parseTelegramWebhook(update);
    expect(parsed).not.toBeNull();
    expect(parsed!.chatId).toBe('999');
    expect(parsed!.text).toBe('안녕하세요');
    expect(parsed!.fromId).toBe('999');
    expect(parsed!.fromName).toBe('John');
  });

  it('parses /start command', () => {
    const update = {
      update_id: 12346,
      message: {
        message_id: 2,
        from: { id: 999, first_name: 'John', is_bot: false },
        chat: { id: 999, type: 'private' },
        date: 1711000000,
        text: '/start abc123',
      },
    };

    const parsed = parseTelegramWebhook(update);
    expect(parsed!.text).toBe('/start abc123');
    expect(parsed!.isCommand).toBe(true);
    expect(parsed!.command).toBe('start');
    expect(parsed!.commandArg).toBe('abc123');
  });

  it('returns null for non-message updates', () => {
    const update = { update_id: 12347, edited_message: {} };
    const parsed = parseTelegramWebhook(update);
    expect(parsed).toBeNull();
  });

  it('returns null for bot messages', () => {
    const update = {
      update_id: 12348,
      message: {
        message_id: 3,
        from: { id: 111, first_name: 'Bot', is_bot: true },
        chat: { id: 111, type: 'private' },
        date: 1711000000,
        text: 'bot message',
      },
    };
    const parsed = parseTelegramWebhook(update);
    expect(parsed).toBeNull();
  });
});
