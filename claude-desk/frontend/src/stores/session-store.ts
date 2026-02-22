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
}

interface SessionState {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  sidebarOpen: boolean;
  sidebarTab: 'sessions' | 'files' | 'pins';
  searchQuery: string;

  setSessions: (sessions: SessionMeta[]) => void;
  setActiveSessionId: (id: string | null) => void;
  addSession: (session: SessionMeta) => void;
  removeSession: (id: string) => void;
  updateSessionMeta: (id: string, updates: Partial<SessionMeta>) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarTab: (tab: 'sessions' | 'files') => void;
  setSearchQuery: (query: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  sidebarOpen: true,
  sidebarTab: 'sessions',
  searchQuery: '',

  setSessions: (sessions) => set({ sessions }),
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  addSession: (session) => set((s) => ({ sessions: [session, ...s.sessions] })),
  removeSession: (id) => set((s) => ({ sessions: s.sessions.filter((ss) => ss.id !== id) })),
  updateSessionMeta: (id, updates) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => (ss.id === id ? { ...ss, ...updates } : ss)),
    })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setSearchQuery: (query) => set({ searchQuery: query }),
}));
