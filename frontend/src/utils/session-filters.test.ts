import { describe, it, expect } from 'vitest';
import {
  shouldDropSessionMessage,
  shouldResetAssistantRef,
  shouldAutoSendQueue,
} from './session-filters';

describe('shouldDropSessionMessage', () => {
  it('returns false when currentSessionId is null (first connection)', () => {
    expect(shouldDropSessionMessage(null, 'any-session')).toBe(false);
  });

  it('returns false when sessions match', () => {
    expect(shouldDropSessionMessage('s1', 's1')).toBe(false);
  });

  it('returns true when sessions differ (drop message)', () => {
    expect(shouldDropSessionMessage('s1', 's2')).toBe(true);
  });

  it('returns false when both currentSessionId is null and incomingSessionId is undefined', () => {
    expect(shouldDropSessionMessage(null, undefined)).toBe(false);
  });

  it('returns true when currentSessionId has value but incomingSessionId is undefined', () => {
    expect(shouldDropSessionMessage('s1', undefined)).toBe(true);
  });

  it('returns false when currentSessionId is empty string (falsy, treated as no session)', () => {
    expect(shouldDropSessionMessage('' as any, 'any')).toBe(false);
  });
});

describe('shouldResetAssistantRef', () => {
  it('returns true when session changed from ref', () => {
    expect(shouldResetAssistantRef('s1', 's2')).toBe(true);
  });

  it('returns false when session matches ref', () => {
    expect(shouldResetAssistantRef('s1', 's1')).toBe(false);
  });

  it('returns false when ref is null (no prior session)', () => {
    expect(shouldResetAssistantRef(null, 's1')).toBe(false);
  });
});

describe('shouldAutoSendQueue', () => {
  it('returns false when still streaming', () => {
    expect(shouldAutoSendQueue(true, 's1', 's1')).toBe(false);
  });

  it('returns true when not streaming and sessions match', () => {
    expect(shouldAutoSendQueue(false, 's1', 's1')).toBe(true);
  });

  it('returns false when not streaming but sessions differ (drop queued)', () => {
    expect(shouldAutoSendQueue(false, 's1', 's2')).toBe(false);
  });

  it('returns false when currentSessionId is null', () => {
    expect(shouldAutoSendQueue(false, 's1', null)).toBe(false);
  });
});
