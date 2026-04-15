// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from './session-store';

beforeEach(() => {
  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
    streamingSessions: new Set(),
    unreadSessions: new Set(),
    lastTurnTextBySession: {},
    sidebarOpen: true,
    sidebarTab: 'sessions',
    searchQuery: '',
    isMobile: false,
    mobileTab: 'chat',
    mobileContextOpen: false,
    mobileTabBeforeContext: 'chat',
    activeView: 'chat',
  });
});

describe('setLastTurnText — multi-turn msgId accumulation', () => {
  it('accumulates text from different msgIds in the same turn', () => {
    const store = useSessionStore.getState();

    // First assistant message in the turn
    store.setLastTurnText('s1', 'I will analyze the code.', false, 'msg-1');
    expect(useSessionStore.getState().lastTurnTextBySession['s1']?.text)
      .toBe('I will analyze the code.');

    // Second assistant message (after tool use) with a different msgId
    store.setLastTurnText('s1', 'Here are the results.', false, 'msg-2');
    expect(useSessionStore.getState().lastTurnTextBySession['s1']?.text)
      .toBe('I will analyze the code.\n\nHere are the results.');

    // Third assistant message
    store.setLastTurnText('s1', 'All done!', false, 'msg-3');
    expect(useSessionStore.getState().lastTurnTextBySession['s1']?.text)
      .toBe('I will analyze the code.\n\nHere are the results.\n\nAll done!');
  });

  it('updates text for the same msgId without duplicating (streaming)', () => {
    const store = useSessionStore.getState();

    // Streaming: same msgId with growing text
    store.setLastTurnText('s1', 'Hel', false, 'msg-1');
    store.setLastTurnText('s1', 'Hello world', false, 'msg-1');
    expect(useSessionStore.getState().lastTurnTextBySession['s1']?.text)
      .toBe('Hello world');

    // Add a second msgId
    store.setLastTurnText('s1', 'Second part', false, 'msg-2');
    expect(useSessionStore.getState().lastTurnTextBySession['s1']?.text)
      .toBe('Hello world\n\nSecond part');
  });

  it('resets msgTexts when previous turn was finalized (new turn)', () => {
    const store = useSessionStore.getState();

    // Turn 1: two assistant messages, then finalized
    store.setLastTurnText('s1', 'Turn 1 msg A', false, 'msg-1');
    store.setLastTurnText('s1', 'Turn 1 msg B', false, 'msg-2');
    expect(useSessionStore.getState().lastTurnTextBySession['s1']?.text)
      .toBe('Turn 1 msg A\n\nTurn 1 msg B');

    // Finalize the turn (turn_done)
    const compositeText = useSessionStore.getState().lastTurnTextBySession['s1']!.text;
    store.setLastTurnText('s1', compositeText, true);

    // New turn begins — should NOT include old msgTexts
    store.setLastTurnText('s1', 'Turn 2 msg A', false, 'msg-3');
    expect(useSessionStore.getState().lastTurnTextBySession['s1']?.text)
      .toBe('Turn 2 msg A');
    expect(useSessionStore.getState().lastTurnTextBySession['s1']?.finalized)
      .toBe(false);
  });

  it('legacy path (no msgId) replaces text entirely', () => {
    const store = useSessionStore.getState();

    store.setLastTurnText('s1', 'Initial text');
    expect(useSessionStore.getState().lastTurnTextBySession['s1']?.text)
      .toBe('Initial text');

    store.setLastTurnText('s1', 'Replaced text');
    expect(useSessionStore.getState().lastTurnTextBySession['s1']?.text)
      .toBe('Replaced text');
  });

  it('skips no-op updates for same msgId + text', () => {
    const store = useSessionStore.getState();

    store.setLastTurnText('s1', 'Same text', false, 'msg-1');
    const entry1 = useSessionStore.getState().lastTurnTextBySession['s1'];

    // Same call — should be a no-op (returns same state reference)
    store.setLastTurnText('s1', 'Same text', false, 'msg-1');
    const entry2 = useSessionStore.getState().lastTurnTextBySession['s1'];

    // updatedAt should be the same since it was a no-op
    expect(entry1?.updatedAt).toBe(entry2?.updatedAt);
  });

  it('handles independent sessions without cross-contamination', () => {
    const store = useSessionStore.getState();

    store.setLastTurnText('s1', 'Session 1 msg', false, 'msg-1');
    store.setLastTurnText('s2', 'Session 2 msg', false, 'msg-2');

    expect(useSessionStore.getState().lastTurnTextBySession['s1']?.text)
      .toBe('Session 1 msg');
    expect(useSessionStore.getState().lastTurnTextBySession['s2']?.text)
      .toBe('Session 2 msg');
  });

  it('clearLastTurnText removes session entry', () => {
    const store = useSessionStore.getState();

    store.setLastTurnText('s1', 'Some text', false, 'msg-1');
    expect(useSessionStore.getState().lastTurnTextBySession['s1']).toBeDefined();

    store.clearLastTurnText('s1');
    expect(useSessionStore.getState().lastTurnTextBySession['s1']).toBeUndefined();
  });
});
