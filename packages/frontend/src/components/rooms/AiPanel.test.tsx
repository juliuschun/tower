// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AiPanel } from './AiPanel';
import { useAiPanelStore } from '../../stores/ai-panel-store';
import { useRoomStore } from '../../stores/room-store';
import { useSessionStore } from '../../stores/session-store';

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();

  (window as any).__claudeWs = {
    readyState: WebSocket.OPEN,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    send: vi.fn(),
  };

  useAiPanelStore.setState({
    open: true,
    contextType: 'room',
    contextId: 'room-1',
    roomId: 'room-1',
    threads: [{
      id: 'thread-1',
      name: 'Thread 1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any],
    activeThreadId: 'thread-1',
    messages: [],
    isStreaming: true,
    pendingQuestion: {
      questionId: 'q-1',
      sessionId: 'thread-1',
      questions: [
        {
          question: '환경을 선택해 주세요',
          options: [{ label: '개발' }, { label: '운영' }],
        },
      ],
    },
    loading: false,
  });

  useRoomStore.setState({ activeRoomId: 'room-1' } as any);
  useSessionStore.setState({ isMobile: false } as any);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AiPanel AskUserQuestion UI', () => {
  it('renders floating question UI for panel threads', async () => {
    render(<AiPanel />);

    expect(await screen.findByText('Claude is asking')).toBeInTheDocument();
    expect(screen.getByText('환경을 선택해 주세요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '개발' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '운영' })).toBeInTheDocument();
  });
});
