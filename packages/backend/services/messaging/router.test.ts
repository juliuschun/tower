/**
 * router.test.ts — TDD Red phase
 *
 * Tests for MessageRouter: register channels, send, sendAny, getConnected.
 * Uses fake channels (no real API calls).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageRouter } from './router';
import type { MessageChannel, SendResult } from './types';

// ── Fake channel for testing ──

function makeFakeChannel(
  provider: string,
  opts: { connected?: boolean; sendResult?: SendResult } = {},
): MessageChannel {
  const { connected = true, sendResult = { success: true } } = opts;
  return {
    provider,
    send: vi.fn().mockResolvedValue(sendResult),
    isConnected: vi.fn().mockResolvedValue(connected),
  };
}

// ── Tests ──

describe('MessageRouter', () => {
  let router: MessageRouter;

  beforeEach(() => {
    router = new MessageRouter();
  });

  // ── register / get ──

  describe('register', () => {
    it('registers a channel and retrieves it', () => {
      const ch = makeFakeChannel('kakao');
      router.register(ch);
      expect(router.get('kakao')).toBe(ch);
    });

    it('returns undefined for unregistered provider', () => {
      expect(router.get('nonexistent')).toBeUndefined();
    });
  });

  // ── send (specific channel) ──

  describe('send', () => {
    it('sends to specific channel', async () => {
      const ch = makeFakeChannel('kakao');
      router.register(ch);

      const result = await router.send(1, 'kakao', 'hello');
      expect(result.success).toBe(true);
      expect(ch.send).toHaveBeenCalledWith(1, 'hello', undefined);
    });

    it('passes options through', async () => {
      const ch = makeFakeChannel('kakao');
      router.register(ch);

      const opts = { title: 'Test', linkUrl: 'https://example.com' };
      await router.send(1, 'kakao', 'hello', opts);
      expect(ch.send).toHaveBeenCalledWith(1, 'hello', opts);
    });

    it('returns error for unknown provider', async () => {
      const result = await router.send(1, 'unknown', 'hello');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown provider');
    });
  });

  // ── sendAny (first available) ──

  describe('sendAny', () => {
    it('sends to the first connected channel', async () => {
      const kakao = makeFakeChannel('kakao', { connected: true });
      const slack = makeFakeChannel('slack', { connected: true });
      router.register(kakao);
      router.register(slack);

      const result = await router.sendAny(1, 'hello');
      expect(result.success).toBe(true);
      // Should have used kakao (registered first)
      expect(kakao.send).toHaveBeenCalled();
      expect(slack.send).not.toHaveBeenCalled();
    });

    it('skips disconnected channels', async () => {
      const kakao = makeFakeChannel('kakao', { connected: false });
      const slack = makeFakeChannel('slack', { connected: true });
      router.register(kakao);
      router.register(slack);

      const result = await router.sendAny(1, 'hello');
      expect(result.success).toBe(true);
      expect(kakao.send).not.toHaveBeenCalled();
      expect(slack.send).toHaveBeenCalled();
    });

    it('returns error when no channels connected', async () => {
      const kakao = makeFakeChannel('kakao', { connected: false });
      router.register(kakao);

      const result = await router.sendAny(1, 'hello');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No connected');
    });

    it('returns error when no channels registered', async () => {
      const result = await router.sendAny(1, 'hello');
      expect(result.success).toBe(false);
    });
  });

  // ── getConnected ──

  describe('getConnected', () => {
    it('returns empty array when nothing connected', async () => {
      expect(await router.getConnected(1)).toEqual([]);
    });

    it('returns only connected providers', async () => {
      router.register(makeFakeChannel('kakao', { connected: true }));
      router.register(makeFakeChannel('slack', { connected: false }));
      router.register(makeFakeChannel('telegram', { connected: true }));

      const connected = await router.getConnected(1);
      expect(connected).toContain('kakao');
      expect(connected).toContain('telegram');
      expect(connected).not.toContain('slack');
    });
  });
});
