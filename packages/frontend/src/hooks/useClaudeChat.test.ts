// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { useChatStore } from '../stores/chat-store';
import { useSessionStore } from '../stores/session-store';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  localStorage.clear();
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    sessionId: null,
    claudeSessionId: null,
    slashCommands: [],
    tools: [],
    model: null,
    cost: { totalCost: 0, inputTokens: 0, outputTokens: 0, cumulativeInputTokens: 0, cumulativeOutputTokens: 0, turnCount: 0, contextInputTokens: 0, contextOutputTokens: 0, contextWindowSize: 0 },
    rateLimit: null,
    attachments: [],
    pendingQuestion: null,
    compactingSessionId: null,
    sessionStartTime: null,
    turnStartTime: null,
    lastTurnMetrics: null,
    messageQueue: {},
    hasMoreMessages: false,
    loadingMoreMessages: false,
    oldestMessageId: null,
    scrollGeneration: 0,
  });
  useSessionStore.setState({
    sessions: [{
      id: 's1',
      name: 'Shared session',
      cwd: '/tmp',
      tags: [],
      favorite: false,
      totalCost: 0,
      totalTokens: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerUsername: 'owner-user',
    }],
    activeSessionId: 's1',
    streamingSessions: new Set(),
    unreadSessions: new Set(),
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

describe('recoverMessagesFromDb username mapping', () => {
  it('prefers per-message username from DB over session owner username', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        messages: [{
          id: 'm1',
          role: 'user',
          content: JSON.stringify([{ type: 'text', text: 'hello' }]),
          created_at: new Date().toISOString(),
          username: 'alice',
        }],
        hasMore: false,
        oldestId: 'm1',
      }),
    });

    const mod = await import('./useClaudeChat');
    await (mod as any).__test_recoverMessagesFromDb('s1');

    expect(useChatStore.getState().messages[0]?.username).toBe('alice');
  });

  it('falls back to ownerUsername when DB message has no username', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        messages: [{
          id: 'm2',
          role: 'user',
          content: JSON.stringify([{ type: 'text', text: 'hi' }]),
          created_at: new Date().toISOString(),
          // no username field
        }],
        hasMore: false,
        oldestId: 'm2',
      }),
    });

    const mod = await import('./useClaudeChat');
    await (mod as any).__test_recoverMessagesFromDb('s1');

    expect(useChatStore.getState().messages[0]?.username).toBe('owner-user');
  });

  it('falls back to ownerUsername when DB message has empty string username', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        messages: [{
          id: 'm3',
          role: 'user',
          content: JSON.stringify([{ type: 'text', text: 'hey' }]),
          created_at: new Date().toISOString(),
          username: '  ',  // whitespace only
        }],
        hasMore: false,
        oldestId: 'm3',
      }),
    });

    const mod = await import('./useClaudeChat');
    await (mod as any).__test_recoverMessagesFromDb('s1');

    expect(useChatStore.getState().messages[0]?.username).toBe('owner-user');
  });

  it('assistant messages do not get username', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        messages: [{
          id: 'm4',
          role: 'assistant',
          content: JSON.stringify([{ type: 'text', text: 'I can help' }]),
          created_at: new Date().toISOString(),
          username: 'should-be-ignored',
        }],
        hasMore: false,
        oldestId: 'm4',
      }),
    });

    const mod = await import('./useClaudeChat');
    await (mod as any).__test_recoverMessagesFromDb('s1');

    expect(useChatStore.getState().messages[0]?.username).toBeUndefined();
  });
});
