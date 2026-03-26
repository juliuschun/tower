/**
 * telegram-link.test.ts — Tests for Telegram account linking tokens.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLinkToken, consumeLinkToken, getPendingCount } from './telegram-link';

describe('telegram-link', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a token and consumes it', () => {
    const token = createLinkToken(1, 'admin');
    expect(token).toHaveLength(32); // 16 bytes hex = 32 chars
    expect(getPendingCount()).toBeGreaterThanOrEqual(1);

    const link = consumeLinkToken(token);
    expect(link).not.toBeNull();
    expect(link!.userId).toBe(1);
    expect(link!.username).toBe('admin');
  });

  it('returns null for unknown token', () => {
    expect(consumeLinkToken('nonexistent')).toBeNull();
  });

  it('is single-use — second consume returns null', () => {
    const token = createLinkToken(2, 'user2');
    expect(consumeLinkToken(token)).not.toBeNull();
    expect(consumeLinkToken(token)).toBeNull();
  });

  it('invalidates previous token for same user', () => {
    const token1 = createLinkToken(3, 'user3');
    const token2 = createLinkToken(3, 'user3');

    // First token should be invalidated
    expect(consumeLinkToken(token1)).toBeNull();

    // Second token should work
    const link = consumeLinkToken(token2);
    expect(link).not.toBeNull();
    expect(link!.userId).toBe(3);
  });

  it('returns null for expired token', () => {
    vi.useFakeTimers();
    const token = createLinkToken(4, 'user4');

    // Fast-forward 11 minutes
    vi.advanceTimersByTime(11 * 60 * 1000);

    expect(consumeLinkToken(token)).toBeNull();
    vi.useRealTimers();
  });
});
