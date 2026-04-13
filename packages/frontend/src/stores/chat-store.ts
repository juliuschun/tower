import { create } from 'zustand';

// --- Message Queue localStorage persistence ---
const QUEUE_STORAGE_KEY = 'tower:messageQueue';

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
  title?: string;
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
  username?: string;
  parentToolUseId?: string | null;
  sendStatus?: 'pending' | 'queued' | 'delivered' | 'failed';
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';
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
  // Context window tracking (from SDK last iteration)
  contextInputTokens: number;   // last iteration input (= real context size)
  contextOutputTokens: number;  // last iteration output
  contextWindowSize: number;    // model's context window (e.g. 200000)
}

export interface TurnMetrics {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  stopReason?: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';
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
  scope?: 'company' | 'project' | 'personal';
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

export type TurnPhase =
  | 'idle'
  | 'queued'
  | 'preparing'
  | 'streaming'
  | 'tool_running'
  | 'awaiting_user'
  | 'compacting'
  | 'done'
  | 'stopped'
  | 'error';

export interface SessionTurnState {
  phase: TurnPhase;
  startedAt: number | null;
  lastActivityAt: number | null;
  pendingMessageCount: number;
  activeToolUseId?: string;
  activeToolId?: string;
  activeToolName?: string;
  activeToolSummary?: string;
  pendingQuestionId?: string;
  errorMessage?: string;
  /** True when the user has viewed this session after the turn ended (done/stopped/error).
   *  Badge hides once read. Resets when a new turn starts (preparing). */
  read?: boolean;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  sessionId: string | null;
  claudeSessionId: string | null;
  engineSessionId: string | null;
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
  /** Runtime turn state per session */
  turnStateBySession: Record<string, SessionTurnState>;
  /** Pagination state for windowed message loading */
  hasMoreMessages: boolean;
  loadingMoreMessages: boolean;
  oldestMessageId: string | null;
  /** Incremented when background refresh replaces messages — signals ChatPanel to scroll to bottom */
  scrollGeneration: number;
  /** True while switching to a session and loading its messages from server */
  sessionLoading: boolean;

  addMessage: (msg: ChatMessage) => void;
  updateAssistantById: (id: string, content: ContentBlock[]) => void;
  appendToLastAssistant: (block: ContentBlock) => void;
  attachToolResult: (toolUseId: string, result: string) => void;
  markLatestUserQueued: (text: string) => void;
  promoteLatestQueuedUser: (text: string) => void;
  clearQueuedUsersForSession: (sessionId: string) => void;
  cancelQueuedMessage: (messageId: string) => string | null;
  setStreaming: (v: boolean) => void;
  setSessionId: (id: string | null) => void;
  setClaudeSessionId: (id: string | null) => void;
  setEngineSessionId: (id: string | null) => void;
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
  updateMessageMetrics: (id: string, metrics: { durationMs?: number; inputTokens?: number; outputTokens?: number; stopReason?: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' }) => void;
  enqueueMessage: (sessionId: string, message: string) => void;
  dequeueMessage: (sessionId: string) => string | null;
  removeQueuedMessage: (sessionId: string, index: number) => void;
  clearSessionQueue: (sessionId: string) => void;
  setTurnPhase: (sessionId: string, phase: TurnPhase, meta?: Partial<Omit<SessionTurnState, 'phase'>>) => void;
  /** Mark the turn badge as read (user viewed the session). Badge hides for done/stopped/error. */
  markTurnRead: (sessionId: string) => void;
  clearTurnState: (sessionId: string) => void;
  setHasMoreMessages: (v: boolean) => void;
  setLoadingMoreMessages: (v: boolean) => void;
  setOldestMessageId: (id: string | null) => void;
  prependMessages: (msgs: ChatMessage[]) => void;
  bumpScrollGeneration: () => void;
  setSessionLoading: (v: boolean) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  sessionId: null,
  claudeSessionId: null,
  engineSessionId: null,
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
  messageQueue: loadQueueFromStorage(),
  turnStateBySession: {},
  hasMoreMessages: false,
  loadingMoreMessages: false,
  oldestMessageId: null,
  scrollGeneration: 0,
  sessionLoading: false,

  addMessage: (msg) => set((s) => {
    if (s.messages.some((m) => m.id === msg.id)) {
      console.warn('[chat-store] duplicate message dropped:', msg.id, msg.role);
      return s;
    }
    return { messages: [...s.messages, msg] };
  }),

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

  markLatestUserQueued: (text) =>
    set((s) => {
      const normalized = text.trim();
      if (!normalized) return s;
      for (let i = s.messages.length - 1; i >= 0; i--) {
        const msg = s.messages[i];
        if (msg.role !== 'user' || msg.sendStatus !== 'pending') continue;
        const body = msg.content.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n').trim();
        if (body === normalized) {
          const next = [...s.messages];
          next[i] = { ...msg, sendStatus: 'queued' };
          return { messages: next };
        }
      }
      return s;
    }),

  promoteLatestQueuedUser: (text) =>
    set((s) => {
      const normalized = text.trim();
      if (!normalized) return s;
      for (let i = s.messages.length - 1; i >= 0; i--) {
        const msg = s.messages[i];
        if (msg.role !== 'user' || msg.sendStatus !== 'queued') continue;
        const body = msg.content.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n').trim();
        if (body === normalized) {
          const next = [...s.messages];
          next[i] = { ...msg, sendStatus: 'pending' };
          return { messages: next };
        }
      }
      return s;
    }),

  clearQueuedUsersForSession: (sessionId) =>
    set((s) => {
      if (s.sessionId !== sessionId) return s;
      return {
        messages: s.messages.map((msg) =>
          msg.role === 'user' && msg.sendStatus === 'queued'
            ? { ...msg, sendStatus: 'failed' as const }
            : msg
        ),
      };
    }),

  cancelQueuedMessage: (messageId) => {
    const state = get();
    const idx = state.messages.findIndex((m) => m.id === messageId && m.role === 'user' && m.sendStatus === 'queued');
    if (idx === -1) return null;
    const msg = state.messages[idx];
    const text = msg.content.find((b) => b.type === 'text')?.text?.trim() || null;
    if (!text) return null;

    const sid = state.sessionId;
    if (!sid) return null;
    const queue = state.messageQueue[sid] || [];
    const removeIndex = queue.findIndex((q) => q.trim() === text);
    const nextQueue = removeIndex >= 0 ? queue.filter((_, i) => i !== removeIndex) : queue;
    const updatedQueue = { ...state.messageQueue, [sid]: nextQueue };
    saveQueueToStorage(updatedQueue);

    set((s) => {
      const nextMessages = s.messages.filter((m) => m.id !== messageId);
      const prev = s.turnStateBySession[sid];
      return {
        messages: nextMessages,
        messageQueue: updatedQueue,
        turnStateBySession: {
          ...s.turnStateBySession,
          [sid]: {
            phase: nextQueue.length > 0 ? 'queued' : (prev?.phase === 'queued' ? 'idle' : (prev?.phase || 'idle')),
            startedAt: prev?.startedAt ?? null,
            lastActivityAt: Date.now(),
            pendingMessageCount: nextQueue.length,
            activeToolName: prev?.activeToolName,
            activeToolSummary: prev?.activeToolSummary,
            pendingQuestionId: prev?.pendingQuestionId,
            errorMessage: prev?.errorMessage,
          },
        },
      };
    });

    return text;
  },

  setStreaming: (v) => set({ isStreaming: v }),
  setCompacting: (sessionId) => set({ compactingSessionId: sessionId }),
  setSessionId: (id) => set({ sessionId: id }),
  setClaudeSessionId: (id) => set({ claudeSessionId: id, engineSessionId: id }),
  setEngineSessionId: (id) => set({ engineSessionId: id, claudeSessionId: id }),
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
    const merged = {
      ...s.cost,
      ...cost,
      cumulativeInputTokens: s.cost.cumulativeInputTokens + newInput,
      cumulativeOutputTokens: s.cost.cumulativeOutputTokens + newOutput,
      turnCount: s.cost.turnCount + (newInput > 0 || newOutput > 0 ? 1 : 0),
    };
    return { cost: merged };
  }),
  setRateLimit: (info) => set({ rateLimit: info }),
  setMessages: (msgs) => set({ messages: msgs }),
  clearMessages: () => set({ messages: [], cost: { totalCost: 0, inputTokens: 0, outputTokens: 0, cumulativeInputTokens: 0, cumulativeOutputTokens: 0, turnCount: 0, contextInputTokens: 0, contextOutputTokens: 0, contextWindowSize: 0 }, rateLimit: null, pendingQuestion: null, lastTurnMetrics: null, hasMoreMessages: false, loadingMoreMessages: false, oldestMessageId: null, compactingSessionId: null, turnStateBySession: {}, engineSessionId: null, claudeSessionId: null }),
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

  updateMessageMetrics: (id, metrics) =>
    set((s) => {
      const idx = s.messages.findIndex((m) => m.id === id);
      if (idx === -1) return s;
      const msgs = [...s.messages];
      msgs[idx] = { ...msgs[idx], ...metrics };
      return { messages: msgs };
    }),

  enqueueMessage: (sessionId, message) => set((s) => {
    const updated = {
      ...s.messageQueue,
      [sessionId]: [...(s.messageQueue[sessionId] || []), message],
    };
    saveQueueToStorage(updated);
    const prev = s.turnStateBySession[sessionId];
    return {
      messageQueue: updated,
      turnStateBySession: {
        ...s.turnStateBySession,
        [sessionId]: {
          phase: 'queued',
          startedAt: prev?.startedAt ?? Date.now(),
          lastActivityAt: Date.now(),
          pendingMessageCount: updated[sessionId]?.length || 0,
          activeToolUseId: prev?.activeToolUseId,
          activeToolId: prev?.activeToolId,
          activeToolName: prev?.activeToolName,
          activeToolSummary: prev?.activeToolSummary,
          pendingQuestionId: prev?.pendingQuestionId,
          errorMessage: prev?.errorMessage,
        },
      },
    };
  }),

  dequeueMessage: (sessionId) => {
    const state = get();
    const queue = state.messageQueue[sessionId];
    if (!queue || queue.length === 0) return null;
    const [first, ...rest] = queue;
    const updated = { ...state.messageQueue, [sessionId]: rest };
    saveQueueToStorage(updated);
    set((s) => {
      const prev = s.turnStateBySession[sessionId];
      return {
        messageQueue: updated,
        turnStateBySession: {
          ...s.turnStateBySession,
          [sessionId]: {
            phase: rest.length > 0 ? 'queued' : (prev?.phase === 'queued' ? 'idle' : (prev?.phase || 'idle')),
            startedAt: prev?.startedAt ?? null,
            lastActivityAt: Date.now(),
            pendingMessageCount: rest.length,
            activeToolUseId: prev?.activeToolUseId,
            activeToolId: prev?.activeToolId,
            activeToolName: prev?.activeToolName,
            activeToolSummary: prev?.activeToolSummary,
            pendingQuestionId: prev?.pendingQuestionId,
            errorMessage: prev?.errorMessage,
          },
        },
      };
    });
    return first;
  },

  removeQueuedMessage: (sessionId, index) => set((s) => {
    const queue = s.messageQueue[sessionId] || [];
    const nextQueue = queue.filter((_, i) => i !== index);
    const updated = {
      ...s.messageQueue,
      [sessionId]: nextQueue,
    };
    saveQueueToStorage(updated);
    const prev = s.turnStateBySession[sessionId];
    return {
      messageQueue: updated,
      turnStateBySession: {
        ...s.turnStateBySession,
        [sessionId]: {
          phase: nextQueue.length > 0 ? 'queued' : (prev?.phase === 'queued' ? 'idle' : (prev?.phase || 'idle')),
          startedAt: prev?.startedAt ?? null,
          lastActivityAt: Date.now(),
          pendingMessageCount: nextQueue.length,
          activeToolUseId: prev?.activeToolUseId,
          activeToolId: prev?.activeToolId,
          activeToolName: prev?.activeToolName,
          activeToolSummary: prev?.activeToolSummary,
          pendingQuestionId: prev?.pendingQuestionId,
          errorMessage: prev?.errorMessage,
        },
      },
    };
  }),

  clearSessionQueue: (sessionId) => set((s) => {
    const { [sessionId]: _, ...rest } = s.messageQueue;
    saveQueueToStorage(rest);
    const prev = s.turnStateBySession[sessionId];
    return {
      messageQueue: rest,
      turnStateBySession: {
        ...s.turnStateBySession,
        [sessionId]: {
          phase: prev?.phase === 'queued' ? 'idle' : (prev?.phase || 'idle'),
          startedAt: prev?.startedAt ?? null,
          lastActivityAt: Date.now(),
          pendingMessageCount: 0,
          activeToolUseId: prev?.activeToolUseId,
          activeToolId: prev?.activeToolId,
          activeToolName: prev?.activeToolName,
          activeToolSummary: prev?.activeToolSummary,
          pendingQuestionId: prev?.pendingQuestionId,
          errorMessage: prev?.errorMessage,
        },
      },
    };
  }),

  setTurnPhase: (sessionId, phase, meta = {}) => set((s) => {
    const prev = s.turnStateBySession[sessionId];
    // Reset read flag when a new turn begins (preparing) so the badge shows again
    const read = phase === 'preparing' ? false : (meta.read ?? prev?.read ?? false);
    return {
      turnStateBySession: {
        ...s.turnStateBySession,
        [sessionId]: {
          phase,
          startedAt: phase === 'preparing' && prev?.phase !== 'preparing' ? Date.now() : (meta.startedAt ?? prev?.startedAt ?? null),
          lastActivityAt: meta.lastActivityAt ?? Date.now(),
          pendingMessageCount: meta.pendingMessageCount ?? s.messageQueue[sessionId]?.length ?? prev?.pendingMessageCount ?? 0,
          activeToolUseId: meta.activeToolUseId ?? prev?.activeToolUseId,
          activeToolId: meta.activeToolId ?? prev?.activeToolId,
          activeToolName: meta.activeToolName ?? prev?.activeToolName,
          activeToolSummary: meta.activeToolSummary ?? prev?.activeToolSummary,
          pendingQuestionId: meta.pendingQuestionId ?? prev?.pendingQuestionId,
          errorMessage: meta.errorMessage ?? (phase === 'error' ? prev?.errorMessage : undefined),
          read,
        },
      },
    };
  }),

  markTurnRead: (sessionId) => set((s) => {
    const prev = s.turnStateBySession[sessionId];
    if (!prev || prev.read) return s; // no-op if already read or no state
    return {
      turnStateBySession: {
        ...s.turnStateBySession,
        [sessionId]: { ...prev, read: true },
      },
    };
  }),

  clearTurnState: (sessionId) => set((s) => {
    const { [sessionId]: _, ...rest } = s.turnStateBySession;
    return { turnStateBySession: rest };
  }),

  // Pagination actions
  setHasMoreMessages: (v) => set({ hasMoreMessages: v }),
  setLoadingMoreMessages: (v) => set({ loadingMoreMessages: v }),
  setOldestMessageId: (id) => set({ oldestMessageId: id }),
  prependMessages: (msgs) => set((s) => ({ messages: [...msgs, ...s.messages] })),
  bumpScrollGeneration: () => set((s) => ({ scrollGeneration: s.scrollGeneration + 1 })),
  setSessionLoading: (v) => set({ sessionLoading: v }),
}));
