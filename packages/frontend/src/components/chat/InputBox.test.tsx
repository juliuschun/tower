// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { act } from 'react';
import { InputBox } from './InputBox';
import { useChatStore } from '../../stores/chat-store';
import { useSessionStore } from '../../stores/session-store';

beforeEach(() => {
  useChatStore.setState({
    isStreaming: false,
    sessionId: null,
    claudeSessionId: null,
    messages: [],
    slashCommands: [],
    attachments: [],
    messageQueue: {},
  });
  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
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

  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('tower:inputDraft')) toRemove.push(key);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
});

describe('InputBox queue + session isolation', () => {
  it('clears queued message when session changes', async () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();

    useChatStore.setState({ isStreaming: true, sessionId: 's1' });
    useSessionStore.setState({ activeSessionId: 's1', streamingSessions: new Set(['s1']) });
    render(<InputBox onSend={onSend} onAbort={onAbort} />);

    const textarea = screen.getByPlaceholderText(/Type a message|send on the next turn/i);
    fireEvent.change(textarea, { target: { value: 'queued msg' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    act(() => {
      useChatStore.setState({ sessionId: 's2' });
      useSessionStore.setState({ activeSessionId: 's2', streamingSessions: new Set() });
    });

    act(() => {
      useChatStore.setState({ isStreaming: false });
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('auto-sends queued message when session streaming ends', () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();

    useChatStore.setState({ isStreaming: true, sessionId: 's1' });
    useSessionStore.setState({ activeSessionId: 's1', streamingSessions: new Set(['s1']) });
    render(<InputBox onSend={onSend} onAbort={onAbort} />);

    const textarea = screen.getByPlaceholderText(/Type a message|send on the next turn/i);
    fireEvent.change(textarea, { target: { value: 'my message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    act(() => {
      useChatStore.setState({ isStreaming: false });
      useSessionStore.setState({ streamingSessions: new Set() });
    });

    expect(onSend).toHaveBeenCalledWith('my message');
  });

  it('drops queued message when streaming ends but session differs', () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();

    useChatStore.setState({ isStreaming: true, sessionId: 's1' });
    useSessionStore.setState({ activeSessionId: 's1', streamingSessions: new Set(['s1']) });
    render(<InputBox onSend={onSend} onAbort={onAbort} />);

    const textarea = screen.getByPlaceholderText(/Type a message|send on the next turn/i);
    fireEvent.change(textarea, { target: { value: 'stale msg' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    act(() => {
      useChatStore.setState({ isStreaming: false, sessionId: 's2' });
      useSessionStore.setState({ activeSessionId: 's2', streamingSessions: new Set() });
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('drops queued message after rapid session switches (s1→s2→s3→s4)', () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();

    useChatStore.setState({ isStreaming: true, sessionId: 's1' });
    useSessionStore.setState({ activeSessionId: 's1', streamingSessions: new Set(['s1']) });
    render(<InputBox onSend={onSend} onAbort={onAbort} />);

    const textarea = screen.getByPlaceholderText(/Type a message|send on the next turn/i);
    fireEvent.change(textarea, { target: { value: 'rapid msg' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    act(() => {
      useChatStore.setState({ sessionId: 's2' });
      useSessionStore.setState({ activeSessionId: 's2' });
    });
    act(() => {
      useChatStore.setState({ sessionId: 's3' });
      useSessionStore.setState({ activeSessionId: 's3' });
    });
    act(() => {
      useChatStore.setState({ sessionId: 's4', isStreaming: false });
      useSessionStore.setState({ activeSessionId: 's4', streamingSessions: new Set() });
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('cancels queued message on Escape key press', () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();

    useChatStore.setState({ isStreaming: true, sessionId: 's1' });
    useSessionStore.setState({ activeSessionId: 's1', streamingSessions: new Set(['s1']) });
    render(<InputBox onSend={onSend} onAbort={onAbort} />);

    const textarea = screen.getByPlaceholderText(/Type a message|send on the next turn/i);
    fireEvent.change(textarea, { target: { value: 'cancel me' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    fireEvent.keyDown(textarea, { key: 'Escape' });

    act(() => {
      useChatStore.setState({ isStreaming: false });
      useSessionStore.setState({ streamingSessions: new Set() });
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows send UI when only the stale global flag is true', () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();

    useChatStore.setState({ isStreaming: true, sessionId: 's1' });
    useSessionStore.setState({ activeSessionId: 's1', streamingSessions: new Set() });
    render(<InputBox onSend={onSend} onAbort={onAbort} />);

    expect(screen.queryByTitle('Stop')).not.toBeInTheDocument();
    expect(screen.getByTitle('Send')).toBeInTheDocument();
  });
});
