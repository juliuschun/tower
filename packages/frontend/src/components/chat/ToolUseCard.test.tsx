// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ToolChip, ToolUseCard } from './ToolUseCard';
import { useChatStore } from '../../stores/chat-store';
import { useSessionStore } from '../../stores/session-store';

beforeEach(() => {
  useChatStore.setState({
    isStreaming: false,
    sessionId: 's1',
    claudeSessionId: null,
    engineSessionId: null,
    messages: [],
    slashCommands: [],
    attachments: [],
    messageQueue: {},
  });

  useSessionStore.setState({
    sessions: [],
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

describe('ToolUseCard streaming state', () => {
  it('does not show running state from stale global flag when current session is idle', () => {
    useChatStore.setState({ isStreaming: true, sessionId: 's1' });
    useSessionStore.setState({ streamingSessions: new Set(['other-session']) });

    render(
      <ToolChip
        name="Bash"
        input={{ command: 'ls -la' }}
        isActive={false}
        isLast={true}
        onClick={() => {}}
      />
    );

    expect(screen.queryByText(/^running$/i)).not.toBeInTheDocument();
  });

  it('shows running state when the current session is marked streaming', () => {
    useChatStore.setState({
      isStreaming: false,
      sessionId: 's1',
      turnStateBySession: {
        s1: {
          phase: 'tool_running',
          startedAt: Date.now(),
          lastActivityAt: Date.now(),
          pendingMessageCount: 0,
        },
      },
    });
    useSessionStore.setState({ streamingSessions: new Set(['s1']) });

    render(
      <ToolUseCard
        name="Bash"
        input={{ command: 'ls -la' }}
        defaultExpanded={true}
      />
    );

    expect(screen.getByText('Running')).toBeInTheDocument();
  });
});
