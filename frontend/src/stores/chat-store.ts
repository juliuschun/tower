import { create } from 'zustand';

// --- Message Queue localStorage persistence ---
const QUEUE_STORAGE_KEY = 'claude-desk:messageQueue';

function saveQueueToStorage(queue: Record<string, string[]>) {
  try {
    const cleaned = Object.fromEntries(
      Object.entries(queue).filter(([, v]) => v.length > 0)
    );
    if (Object.keys(cleaned).length === 0) {
      localStorage.removeItem(QUEUE_STORAGE_KEY);
    } else {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(cleaned));
    }
  } catch { /* storage unavailable or quota exceeded */ }
}

function loadQueueFromStorage(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, any>;
  result?: string;
}

export interface ThinkingBlock {
  text: string;
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  toolUse?: ToolUse;
  thinking?: ThinkingBlock;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: ContentBlock[];
  timestamp: number;
  parentToolUseId?: string | null;
  sendStatus?: 'pending' | 'delivered' | 'failed';
}

export interface CostInfo {
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  duration?: number;
  // Cumulative across turns
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  turnCount: number;
}

export interface TurnMetrics {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface RateLimitInfo {
  status: string;
  resetsAt?: number;
  type?: string;
}

export interface SlashCommandInfo {
  name: string;
  description: string;
  source: 'sdk' | 'commands' | 'skills';
}

export interface Attachment {
  id: string;
  type: 'prompt' | 'command' | 'file' | 'upload';
  label: string;
  content: string;
}

export interface PendingQuestion {
  questionId: string;
  sessionId: string;
  questions: Array<{
    question: string;
    header?: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  sessionId: string | null;
  claudeSessionId: string | null;
  slashCommands: SlashCommandInfo[];
  tools: string[];
  model: string | null;
  cost: CostInfo;
  rateLimit: RateLimitInfo | null;
  attachments: Attachment[];
  pendingQuestion: PendingQuestion | null;
  compactingSessionId: string | null;
  sessionStartTime: number | null;
  turnStartTime: number | null;
  lastTurnMetrics: TurnMetrics | null;
  /** Per-session message queue: sessionId → messages[] */
  messageQueue: Record<string, string[]>;

  addMessage: (msg: ChatMessage) => void;
  updateAssistantById: (id: string, content: ContentBlock[]) => void;
  appendToLastAssistant: (block: ContentBlock) => void;
  attachToolResult: (toolUseId: string, result: string) => void;
  setStreaming: (v: boolean) => void;
  setSessionId: (id: string | null) => void;
  setClaudeSessionId: (id: string | null) => void;
  setSystemInfo: (info: { slashCommands?: string[] | SlashCommandInfo[]; tools?: string[]; model?: string }) => void;
  setCost: (cost: Partial<CostInfo>) => void;
  setRateLimit: (info: RateLimitInfo | null) => void;
  setCompacting: (sessionId: string | null) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  clearMessages: () => void;
  setSessionStartTime: (time: number | null) => void;
  setTurnStartTime: (time: number | null) => void;
  markPendingDelivered: () => void;
  markPendingFailed: () => void;
  retryMessage: (id: string) => string | null;
  setLastTurnMetrics: (m: TurnMetrics | null) => void;
  addAttachment: (att: Attachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setPendingQuestion: (pq: PendingQuestion | null) => void;
  enqueueMessage: (sessionId: string, message: string) => void;
  dequeueMessage: (sessionId: string) => string | null;
  removeQueuedMessage: (sessionId: string, index: number) => void;
  clearSessionQueue: (sessionId: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  sessionId: null,
  claudeSessionId: null,
  slashCommands: [],
  tools: [],
  model: null,
  cost: { totalCost: 0, inputTokens: 0, outputTokens: 0, cumulativeInputTokens: 0, cumulativeOutputTokens: 0, turnCount: 0 },
  rateLimit: null,
  attachments: [],
  pendingQuestion: null,
  compactingSessionId: null,
  sessionStartTime: null,
  turnStartTime: null,
  lastTurnMetrics: null,
  messageQueue: loadQueueFromStorage(),

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  updateAssistantById: (id, content) =>
    set((s) => {
      const idx = s.messages.findIndex((m) => m.id === id);
      if (idx === -1) return s; // stale message — ignore
      const msgs = [...s.messages];
      msgs[idx] = { ...msgs[idx], content };
      return { messages: msgs };
    }),

  appendToLastAssistant: (block) =>
    set((s) => {
      const msgs = [...s.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          msgs[i] = { ...msgs[i], content: [...msgs[i].content, block] };
          break;
        }
      }
      return { messages: msgs };
    }),

  attachToolResult: (toolUseId, result) =>
    set((s) => {
      const msgs = s.messages.map((msg) => {
        if (msg.role !== 'assistant') return msg;
        const updated = msg.content.map((block) => {
          if (block.type === 'tool_use' && block.toolUse?.id === toolUseId) {
            return { ...block, toolUse: { ...block.toolUse, result } };
          }
          return block;
        });
        return { ...msg, content: updated };
      });
      return { messages: msgs };
    }),

  setStreaming: (v) => set({ isStreaming: v }),
  setCompacting: (sessionId) => set({ compactingSessionId: sessionId }),
  setSessionId: (id) => set({ sessionId: id }),
  setClaudeSessionId: (id) => set({ claudeSessionId: id }),
  setSystemInfo: (info) =>
    set((s) => {
      let commands = s.slashCommands;
      if (info.slashCommands) {
        // Normalize: SDK sends string[], convert to SlashCommandInfo[]
        commands = info.slashCommands.map((cmd) =>
          typeof cmd === 'string'
            ? { name: cmd, description: '', source: 'sdk' as const }
            : cmd
        );
      }
      return {
        slashCommands: commands,
        tools: info.tools ?? s.tools,
        model: info.model ?? s.model,
      };
    }),
  setCost: (cost) => set((s) => {
    const newInput = cost.inputTokens ?? 0;
    const newOutput = cost.outputTokens ?? 0;
    return {
      cost: {
        ...s.cost,
        ...cost,
        cumulativeInputTokens: s.cost.cumulativeInputTokens + newInput,
        cumulativeOutputTokens: s.cost.cumulativeOutputTokens + newOutput,
        turnCount: s.cost.turnCount + (newInput > 0 || newOutput > 0 ? 1 : 0),
      },
    };
  }),
  setRateLimit: (info) => set({ rateLimit: info }),
  setMessages: (msgs) => set({ messages: msgs }),
  clearMessages: () => set({ messages: [], cost: { totalCost: 0, inputTokens: 0, outputTokens: 0, cumulativeInputTokens: 0, cumulativeOutputTokens: 0, turnCount: 0 }, rateLimit: null, pendingQuestion: null, lastTurnMetrics: null }),
  setSessionStartTime: (time) => set({ sessionStartTime: time }),
  setTurnStartTime: (time) => set({ turnStartTime: time }),
  markPendingDelivered: () =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.sendStatus === 'pending' ? { ...m, sendStatus: 'delivered' as const } : m
      ),
    })),
  markPendingFailed: () =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.sendStatus === 'pending' ? { ...m, sendStatus: 'failed' as const } : m
      ),
    })),
  retryMessage: (id) => {
    const state = get();
    const msg = state.messages.find((m) => m.id === id);
    if (!msg || msg.role !== 'user') return null;
    const text = msg.content.find((b) => b.type === 'text')?.text;
    if (!text) return null;
    // Remove the failed message
    set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }));
    return text;
  },
  setLastTurnMetrics: (m) => set({ lastTurnMetrics: m }),
  addAttachment: (att) => set((s) => {
    if (s.attachments.some((a) => a.id === att.id)) return s;
    return { attachments: [...s.attachments, att] };
  }),
  removeAttachment: (id) => set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),
  clearAttachments: () => set({ attachments: [] }),
  setPendingQuestion: (pq) => set({ pendingQuestion: pq }),

  enqueueMessage: (sessionId, message) => set((s) => {
    const updated = {
      ...s.messageQueue,
      [sessionId]: [...(s.messageQueue[sessionId] || []), message],
    };
    saveQueueToStorage(updated);
    return { messageQueue: updated };
  }),

  dequeueMessage: (sessionId) => {
    const state = get();
    const queue = state.messageQueue[sessionId];
    if (!queue || queue.length === 0) return null;
    const [first, ...rest] = queue;
    const updated = { ...state.messageQueue, [sessionId]: rest };
    saveQueueToStorage(updated);
    set({ messageQueue: updated });
    return first;
  },

  removeQueuedMessage: (sessionId, index) => set((s) => {
    const queue = s.messageQueue[sessionId] || [];
    const updated = {
      ...s.messageQueue,
      [sessionId]: queue.filter((_, i) => i !== index),
    };
    saveQueueToStorage(updated);
    return { messageQueue: updated };
  }),

  clearSessionQueue: (sessionId) => set((s) => {
    const { [sessionId]: _, ...rest } = s.messageQueue;
    saveQueueToStorage(rest);
    return { messageQueue: rest };
  }),
}));
