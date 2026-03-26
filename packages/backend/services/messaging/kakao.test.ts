/**
 * kakao.test.ts — TDD Red phase
 *
 * Tests for KakaoChannel: message sending, template building, error handling.
 * Mocks fetch (no real Kakao API calls).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { KakaoChannel, buildTextTemplate, buildFeedTemplate } from './kakao';

// ── Mock getValidToken ──

const mockGetValidToken = vi.fn();

// ── Tests ──

describe('KakaoChannel', () => {
  let channel: KakaoChannel;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    channel = new KakaoChannel(mockGetValidToken);
    mockGetValidToken.mockResolvedValue('mock-access-token');
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── Template builders ──

  describe('buildTextTemplate', () => {
    it('builds a text template with content and link', () => {
      const t = buildTextTemplate('안녕하세요', { linkUrl: 'https://tower.moatai.app' });
      expect(t.object_type).toBe('text');
      expect(t.text).toBe('안녕하세요');
      expect(t.link.web_url).toBe('https://tower.moatai.app');
    });

    it('truncates text to 200 chars', () => {
      const long = 'A'.repeat(300);
      const t = buildTextTemplate(long);
      expect(t.text.length).toBeLessThanOrEqual(200);
    });

    it('sets default link when none provided', () => {
      const t = buildTextTemplate('hello');
      expect(t.link.web_url).toBeTruthy();
    });
  });

  describe('buildFeedTemplate', () => {
    it('builds a feed template with title and description', () => {
      const t = buildFeedTemplate('모닝 브리핑', '오늘의 일정입니다', {
        linkUrl: 'https://tower.moatai.app',
        buttonTitle: '자세히 보기',
      });
      expect(t.object_type).toBe('feed');
      expect(t.content.title).toBe('모닝 브리핑');
      expect(t.content.description).toBe('오늘의 일정입니다');
      expect(t.buttons[0].title).toBe('자세히 보기');
    });

    it('includes image_url when provided', () => {
      const t = buildFeedTemplate('Title', 'Desc', { imageUrl: 'https://img.com/a.png' });
      expect(t.content.image_url).toBe('https://img.com/a.png');
    });

    it('omits image_url when not provided', () => {
      const t = buildFeedTemplate('Title', 'Desc');
      expect(t.content.image_url).toBeUndefined();
    });
  });

  // ── send ──

  describe('send', () => {
    it('sends text template for simple message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result_code: 0 }),
      });

      const result = await channel.send(1, '테스트 메시지');
      expect(result.success).toBe(true);

      // Verify fetch was called with correct URL and token
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://kapi.kakao.com/v2/api/talk/memo/default/send',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-access-token',
          }),
        }),
      );
    });

    it('sends feed template when title is provided', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result_code: 0 }),
      });

      const result = await channel.send(1, '브리핑 내용', { title: '모닝 브리핑' });
      expect(result.success).toBe(true);

      // Verify template_object contains feed type
      const callArgs = (globalThis.fetch as any).mock.calls[0];
      const body = callArgs[1].body as URLSearchParams;
      const tmpl = JSON.parse(body.get('template_object')!);
      expect(tmpl.object_type).toBe('feed');
      expect(tmpl.content.title).toBe('모닝 브리핑');
    });

    it('returns error when Kakao API returns non-ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'unauthorized', error_description: 'invalid token' }),
      });

      const result = await channel.send(1, 'fail');
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('returns error when result_code is not 0', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result_code: -1 }),
      });

      const result = await channel.send(1, 'fail');
      expect(result.success).toBe(false);
    });

    it('returns error when getValidToken throws', async () => {
      mockGetValidToken.mockRejectedValue(new Error('No token'));

      const result = await channel.send(1, 'fail');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No token');
    });

    it('returns error on network failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await channel.send(1, 'fail');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });
  });

  // ── isConnected ──

  describe('isConnected', () => {
    it('returns true when token exists', async () => {
      mockGetValidToken.mockResolvedValue('some-token');
      expect(await channel.isConnected(1)).toBe(true);
    });

    it('returns false when no token', async () => {
      mockGetValidToken.mockRejectedValue(new Error('No token'));
      expect(await channel.isConnected(1)).toBe(false);
    });
  });
});
