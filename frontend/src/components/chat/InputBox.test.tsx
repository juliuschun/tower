// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { InputBox } from './InputBox';
import { useChatStore } from '../../stores/chat-store';

beforeEach(() => {
  // Reset store to defaults
  useChatStore.setState({
    isStreaming: false,
    sessionId: null,
    claudeSessionId: null,
    messages: [],
    slashCommands: [],
    attachments: [],
  });
});

describe('InputBox queue + session isolation', () => {
  it('clears queued message when session changes', async () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();

    // Start streaming on session s1
    useChatStore.setState({ isStreaming: true, sessionId: 's1' });
    render(<InputBox onSend={onSend} onAbort={onAbort} />);

    // Type and submit → should queue
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'queued msg' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    // Session switches to s2 — the useEffect [currentSessionId] clears the queue
    act(() => {
      useChatStore.setState({ sessionId: 's2' });
    });

    // Streaming stops — onSend should NOT be called (queue was cleared)
    act(() => {
      useChatStore.setState({ isStreaming: false });
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('auto-sends queued message when streaming ends and session matches', () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();

    // Start streaming on session s1
    useChatStore.setState({ isStreaming: true, sessionId: 's1' });
    render(<InputBox onSend={onSend} onAbort={onAbort} />);

    // Type and submit → should queue
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'my message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    // Streaming stops on same session → onSend should fire
    act(() => {
      useChatStore.setState({ isStreaming: false });
    });

    expect(onSend).toHaveBeenCalledWith('my message');
  });

  it('drops queued message when streaming ends but session differs', () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();

    // Start streaming on session s1
    useChatStore.setState({ isStreaming: true, sessionId: 's1' });
    render(<InputBox onSend={onSend} onAbort={onAbort} />);

    // Type and submit → should queue with sessionId s1
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'stale msg' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    // Session changes AND streaming stops simultaneously
    act(() => {
      useChatStore.setState({ isStreaming: false, sessionId: 's2' });
    });

    // onSend should NOT be called — session mismatch
    expect(onSend).not.toHaveBeenCalled();
  });

  it('drops queued message after rapid session switches (s1→s2→s3→s4)', () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();

    useChatStore.setState({ isStreaming: true, sessionId: 's1' });
    render(<InputBox onSend={onSend} onAbort={onAbort} />);

    // Queue on s1
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'rapid msg' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    // Rapid session switches
    act(() => { useChatStore.setState({ sessionId: 's2' }); });
    act(() => { useChatStore.setState({ sessionId: 's3' }); });
    act(() => { useChatStore.setState({ sessionId: 's4' }); });

    // Streaming ends on s4
    act(() => { useChatStore.setState({ isStreaming: false }); });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('cancels queued message on Escape key press', () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();

    useChatStore.setState({ isStreaming: true, sessionId: 's1' });
    render(<InputBox onSend={onSend} onAbort={onAbort} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'cancel me' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    // Escape cancels queue
    fireEvent.keyDown(textarea, { key: 'Escape' });

    // Streaming stops — onSend should NOT fire (queue was cancelled)
    act(() => { useChatStore.setState({ isStreaming: false }); });

    expect(onSend).not.toHaveBeenCalled();
  });
});
