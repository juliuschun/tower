import { create } from 'zustand';

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
}

export interface RateLimitInfo {
  status: string;
  resetsAt?: number;
  type?: string;
}

export interface SlashCommandInfo {
  name: string;
  description: string;
  source: 'sdk' | 'commands';
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
  isCompacting: boolean;

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
  setCompacting: (v: boolean) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  clearMessages: () => void;
  markPendingDelivered: () => void;
  markPendingFailed: () => void;
  retryMessage: (id: string) => string | null;
  addAttachment: (att: Attachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setPendingQuestion: (pq: PendingQuestion | null) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  sessionId: null,
  claudeSessionId: null,
  slashCommands: [],
  tools: [],
  model: null,
  cost: { totalCost: 0, inputTokens: 0, outputTokens: 0 },
  rateLimit: null,
  attachments: [],
  pendingQuestion: null,
  isCompacting: false,

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
  setCompacting: (v) => set({ isCompacting: v }),
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
  setCost: (cost) => set((s) => ({ cost: { ...s.cost, ...cost } })),
  setRateLimit: (info) => set({ rateLimit: info }),
  setMessages: (msgs) => set({ messages: msgs }),
  clearMessages: () => set({ messages: [], cost: { totalCost: 0, inputTokens: 0, outputTokens: 0 }, rateLimit: null, pendingQuestion: null }),
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
  addAttachment: (att) => set((s) => {
    if (s.attachments.some((a) => a.id === att.id)) return s;
    return { attachments: [...s.attachments, att] };
  }),
  removeAttachment: (id) => set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),
  clearAttachments: () => set({ attachments: [] }),
  setPendingQuestion: (pq) => set({ pendingQuestion: pq }),
}));
