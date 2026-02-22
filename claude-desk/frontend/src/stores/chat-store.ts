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

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  sessionId: string | null;
  claudeSessionId: string | null;
  slashCommands: string[];
  tools: string[];
  model: string | null;
  cost: CostInfo;
  rateLimit: RateLimitInfo | null;

  addMessage: (msg: ChatMessage) => void;
  updateLastAssistant: (content: ContentBlock[]) => void;
  appendToLastAssistant: (block: ContentBlock) => void;
  attachToolResult: (toolUseId: string, result: string) => void;
  setStreaming: (v: boolean) => void;
  setSessionId: (id: string | null) => void;
  setClaudeSessionId: (id: string | null) => void;
  setSystemInfo: (info: { slashCommands?: string[]; tools?: string[]; model?: string }) => void;
  setCost: (cost: Partial<CostInfo>) => void;
  setRateLimit: (info: RateLimitInfo | null) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  sessionId: null,
  claudeSessionId: null,
  slashCommands: [],
  tools: [],
  model: null,
  cost: { totalCost: 0, inputTokens: 0, outputTokens: 0 },
  rateLimit: null,

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  updateLastAssistant: (content) =>
    set((s) => {
      const msgs = [...s.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          msgs[i] = { ...msgs[i], content };
          break;
        }
      }
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
  setSessionId: (id) => set({ sessionId: id }),
  setClaudeSessionId: (id) => set({ claudeSessionId: id }),
  setSystemInfo: (info) =>
    set((s) => ({
      slashCommands: info.slashCommands ?? s.slashCommands,
      tools: info.tools ?? s.tools,
      model: info.model ?? s.model,
    })),
  setCost: (cost) => set((s) => ({ cost: { ...s.cost, ...cost } })),
  setRateLimit: (info) => set({ rateLimit: info }),
  setMessages: (msgs) => set({ messages: msgs }),
  clearMessages: () => set({ messages: [], cost: { totalCost: 0, inputTokens: 0, outputTokens: 0 }, rateLimit: null }),
}));
