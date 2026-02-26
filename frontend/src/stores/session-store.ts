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

export type MobileTab = 'sessions' | 'chat' | 'files' | 'edit' | 'pins';

interface SessionState {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  streamingSessions: Set<string>;
  unreadSessions: Set<string>;
  sidebarOpen: boolean;
  sidebarTab: 'sessions' | 'files' | 'prompts' | 'pins';
  searchQuery: string;
  isMobile: boolean;
  mobileTab: MobileTab;
  mobileContextOpen: boolean;
  activeView: 'chat' | 'kanban';

  setSessions: (sessions: SessionMeta[]) => void;
  setActiveSessionId: (id: string | null) => void;
  addSession: (session: SessionMeta) => void;
  removeSession: (id: string) => void;
  updateSessionMeta: (id: string, updates: Partial<SessionMeta>) => void;
  setSessionStreaming: (id: string, streaming: boolean) => void;
  markSessionRead: (id: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarTab: (tab: 'sessions' | 'files' | 'prompts' | 'pins') => void;
  setSearchQuery: (query: string) => void;
  setIsMobile: (v: boolean) => void;
  setMobileTab: (tab: MobileTab) => void;
  setMobileContextOpen: (v: boolean) => void;
  setActiveView: (view: 'chat' | 'kanban') => void;
}

export const useSessionStore = create<SessionState>((set) => ({
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
  activeView: 'chat',

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
      if (streaming) {
        next.add(id);
        return { streamingSessions: next };
      } else {
        next.delete(id);
        if (s.activeSessionId !== id) {
          const unread = new Set(s.unreadSessions);
          unread.add(id);
          return { streamingSessions: next, unreadSessions: unread };
        }
        return { streamingSessions: next };
      }
    }),
  markSessionRead: (id) =>
    set((s) => {
      if (!s.unreadSessions.has(id)) return s;
      const unread = new Set(s.unreadSessions);
      unread.delete(id);
      return { unreadSessions: unread };
    }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setIsMobile: (v) => set({ isMobile: v }),
  setMobileTab: (tab) => set({ mobileTab: tab }),
  setMobileContextOpen: (v) => set({ mobileContextOpen: v }),
  setActiveView: (view) => set({ activeView: view }),
}));
