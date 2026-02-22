import { describe, it, expect } from 'vitest';
import {
  isEpochStale,
  resolveSessionClient,
  switchSession,
  abortCleanup,
  type SessionClient,
} from './session-guards';

function makeClient(overrides: Partial<SessionClient> = {}): SessionClient {
  return { id: 'c1', activeQueryEpoch: 1, ...overrides };
}

describe('isEpochStale', () => {
  it('returns false when epoch matches (loop should continue)', () => {
    const client = makeClient({ activeQueryEpoch: 5 });
    expect(isEpochStale(client, 5)).toBe(false);
  });

  it('returns true when epoch differs (loop should stop)', () => {
    const client = makeClient({ activeQueryEpoch: 6 });
    expect(isEpochStale(client, 5)).toBe(true);
  });
});

describe('resolveSessionClient', () => {
  it('returns client when mapping is valid', () => {
    const sessionClients = new Map([['s1', 'c1']]);
    const client = makeClient({ id: 'c1', sessionId: 's1' });
    const clients = new Map([['c1', client]]);

    const result = resolveSessionClient(sessionClients, clients, 's1');
    expect(result).toBe(client);
    expect(sessionClients.has('s1')).toBe(true);
  });

  it('returns undefined and cleans up when client is missing', () => {
    const sessionClients = new Map([['s1', 'c1']]);
    const clients = new Map<string, SessionClient>();

    const result = resolveSessionClient(sessionClients, clients, 's1');
    expect(result).toBeUndefined();
    expect(sessionClients.has('s1')).toBe(false);
  });

  it('returns undefined and cleans up when client switched sessions', () => {
    const sessionClients = new Map([['s1', 'c1']]);
    const client = makeClient({ id: 'c1', sessionId: 's2' }); // client now on s2
    const clients = new Map([['c1', client]]);

    const result = resolveSessionClient(sessionClients, clients, 's1');
    expect(result).toBeUndefined();
    expect(sessionClients.has('s1')).toBe(false);
  });

  it('returns undefined from empty maps without deletion attempt', () => {
    const sessionClients = new Map<string, string>();
    const clients = new Map<string, SessionClient>();

    const result = resolveSessionClient(sessionClients, clients, 's1');
    expect(result).toBeUndefined();
    expect(sessionClients.size).toBe(0);
  });

  it('returns undefined for missing sessionId while preserving other mappings', () => {
    const sessionClients = new Map([['s1', 'c1']]);
    const client = makeClient({ id: 'c1', sessionId: 's1' });
    const clients = new Map([['c1', client]]);

    const result = resolveSessionClient(sessionClients, clients, 's-unknown');
    expect(result).toBeUndefined();
    // s1→c1 mapping must be preserved
    expect(sessionClients.get('s1')).toBe('c1');
  });
});

describe('switchSession', () => {
  it('cleans old mapping, bumps epoch, sets new mapping', () => {
    const client = makeClient({ id: 'c1', sessionId: 'old-s', activeQueryEpoch: 3 });
    const sessionClients = new Map([['old-s', 'c1']]);

    const newEpoch = switchSession(client, sessionClients, 'old-s', 'new-s');

    // Old mapping removed
    expect(sessionClients.has('old-s')).toBe(false);
    // New mapping set
    expect(sessionClients.get('new-s')).toBe('c1');
    // Epoch incremented
    expect(newEpoch).toBe(4);
    expect(client.activeQueryEpoch).toBe(4);
    // Client sessionId updated
    expect(client.sessionId).toBe('new-s');
  });

  it('does not delete old mapping owned by a different client', () => {
    const client = makeClient({ id: 'c1', sessionId: 'old-s', activeQueryEpoch: 1 });
    // old-s is owned by c2, not c1
    const sessionClients = new Map([['old-s', 'c2']]);

    switchSession(client, sessionClients, 'old-s', 'new-s');

    // c2's mapping must be preserved
    expect(sessionClients.get('old-s')).toBe('c2');
    // new mapping for c1
    expect(sessionClients.get('new-s')).toBe('c1');
  });

  it('still bumps epoch when oldSessionId === newSessionId', () => {
    const client = makeClient({ id: 'c1', sessionId: 's1', activeQueryEpoch: 5 });
    const sessionClients = new Map([['s1', 'c1']]);

    const newEpoch = switchSession(client, sessionClients, 's1', 's1');

    expect(newEpoch).toBe(6);
    expect(client.activeQueryEpoch).toBe(6);
    expect(sessionClients.get('s1')).toBe('c1');
  });

  it('handles undefined oldSessionId (first connection)', () => {
    const client = makeClient({ id: 'c1', activeQueryEpoch: 0 });
    const sessionClients = new Map<string, string>();

    const newEpoch = switchSession(client, sessionClients, undefined, 'new-s');

    expect(newEpoch).toBe(1);
    expect(client.sessionId).toBe('new-s');
    expect(sessionClients.get('new-s')).toBe('c1');
  });
});

describe('abortCleanup', () => {
  it('bumps epoch and removes session mapping', () => {
    const client = makeClient({ id: 'c1', activeQueryEpoch: 2 });
    const sessionClients = new Map([['s1', 'c1']]);

    const newEpoch = abortCleanup(client, sessionClients, 's1');

    expect(newEpoch).toBe(3);
    expect(client.activeQueryEpoch).toBe(3);
    expect(sessionClients.has('s1')).toBe(false);
  });

  it('preserves mapping when session is owned by a different client', () => {
    const client = makeClient({ id: 'c1', activeQueryEpoch: 2 });
    // s1 is owned by c2
    const sessionClients = new Map([['s1', 'c2']]);

    const newEpoch = abortCleanup(client, sessionClients, 's1');

    // epoch still bumps for c1
    expect(newEpoch).toBe(3);
    // c2's mapping must be preserved
    expect(sessionClients.get('s1')).toBe('c2');
  });
});
