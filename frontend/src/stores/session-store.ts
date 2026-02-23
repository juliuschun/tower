import { create } from 'zustand';

export interface SessionMeta {
  id: string;
  claudeSessionId?: string;
  name: string;
  cwd: string;
  tags: string[];
  favorite: boolean;
  totalCost: number;
  totalTokens: number;
  createdAt: string;
  updatedAt: string;
  modelUsed?: string;
  autoNamed?: number;
  summary?: string;
  summaryAtTurn?: number;
  turnCount?: number;
  filesEdited?: string[];
}

export type MobileTab = 'chat' | 'files' | 'edit' | 'pins';

interface SessionState {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  streamingSessions: Set<string>;
  sidebarOpen: boolean;
  sidebarTab: 'sessions' | 'files' | 'prompts' | 'pins' | 'git';
  searchQuery: string;
  isMobile: boolean;
  mobileTab: MobileTab;
  mobileContextOpen: boolean;

  setSessions: (sessions: SessionMeta[]) => void;
  setActiveSessionId: (id: string | null) => void;
  addSession: (session: SessionMeta) => void;
  removeSession: (id: string) => void;
  updateSessionMeta: (id: string, updates: Partial<SessionMeta>) => void;
  setSessionStreaming: (id: string, streaming: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarTab: (tab: 'sessions' | 'files' | 'prompts' | 'pins' | 'git') => void;
  setSearchQuery: (query: string) => void;
  setIsMobile: (v: boolean) => void;
  setMobileTab: (tab: MobileTab) => void;
  setMobileContextOpen: (v: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  streamingSessions: new Set(),
  sidebarOpen: true,
  sidebarTab: 'sessions',
  searchQuery: '',
  isMobile: false,
  mobileTab: 'chat',
  mobileContextOpen: false,

  setSessions: (sessions) => set({ sessions }),
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  addSession: (session) => set((s) => ({ sessions: [session, ...s.sessions] })),
  removeSession: (id) => set((s) => ({ sessions: s.sessions.filter((ss) => ss.id !== id) })),
  updateSessionMeta: (id, updates) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => (ss.id === id ? { ...ss, ...updates } : ss)),
    })),
  setSessionStreaming: (id, streaming) =>
    set((s) => {
      const next = new Set(s.streamingSessions);
      if (streaming) next.add(id); else next.delete(id);
      return { streamingSessions: next };
    }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setIsMobile: (v) => set({ isMobile: v }),
  setMobileTab: (tab) => set({ mobileTab: tab }),
  setMobileContextOpen: (v) => set({ mobileContextOpen: v }),
}));
