import { create } from 'zustand';
import type { SessionMeta } from '@tower/shared';
import type { ChatMessage } from './chat-store';
import { normalizeContentBlocks } from '../utils/message-parser';

interface AiPanelState {
  open: boolean;
  roomId: string | null;
  threads: SessionMeta[];
  activeThreadId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  loading: boolean;

  setOpen: (open: boolean) => void;
  toggle: () => void;
  setRoomId: (roomId: string | null) => void;
  setThreads: (threads: SessionMeta[]) => void;
  addThread: (thread: SessionMeta) => void;
  setActiveThreadId: (id: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  updateAssistantById: (id: string, content: ChatMessage['content']) => void;
  setStreaming: (v: boolean) => void;
  setLoading: (v: boolean) => void;
  reset: () => void;
}

export const useAiPanelStore = create<AiPanelState>((set) => ({
  open: false,
  roomId: null,
  threads: [],
  activeThreadId: null,
  messages: [],
  isStreaming: false,
  loading: false,

  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  setRoomId: (roomId) => set({ roomId }),
  setThreads: (threads) => set({ threads }),
  addThread: (thread) => set((s) => ({
    threads: [thread, ...s.threads],
  })),
  setActiveThreadId: (id) => set({ activeThreadId: id }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((s) => ({
    messages: [...s.messages, message],
  })),
  updateAssistantById: (id, content) =>
    set((s) => {
      const idx = s.messages.findIndex((m) => m.id === id);
      if (idx === -1) return s;
      const msgs = [...s.messages];
      msgs[idx] = { ...msgs[idx], content };
      return { messages: msgs };
    }),
  setStreaming: (v) => set({ isStreaming: v }),
  setLoading: (v) => set({ loading: v }),
  reset: () => set({
    open: false,
    roomId: null,
    threads: [],
    activeThreadId: null,
    messages: [],
    isStreaming: false,
    loading: false,
  }),
}));

// ── API helpers ──

const authHeaders = (): Record<string, string> => {
  const tk = localStorage.getItem('token');
  return tk ? { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
};

export async function fetchPanelThreads(roomId: string): Promise<SessionMeta[]> {
  const res = await fetch(`/api/sessions?roomId=${roomId}`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function createPanelThread(roomId: string, engine?: string): Promise<SessionMeta> {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      name: 'New thread',
      roomId,
      engine: engine || 'claude',
    }),
  });
  return res.json();
}

export async function fetchThreadMessages(sessionId: string): Promise<ChatMessage[]> {
  const res = await fetch(`/api/sessions/${sessionId}/messages`, { headers: authHeaders() });
  if (!res.ok) return [];
  const stored = await res.json();
  return stored.map((m: any) => ({
    id: m.id,
    role: m.role,
    content: normalizeContentBlocks(
      typeof m.content === 'string' ? JSON.parse(m.content) : m.content
    ),
    timestamp: new Date(m.created_at).getTime(),
    parentToolUseId: m.parent_tool_use_id,
    durationMs: m.duration_ms || undefined,
    inputTokens: m.input_tokens || undefined,
    outputTokens: m.output_tokens || undefined,
  }));
}
