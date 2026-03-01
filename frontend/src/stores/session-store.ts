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

export type MobileTab = 'sessions' | 'chat' | 'files' | 'edit' | 'pins' | 'board';

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
  mobileTabBeforeContext: MobileTab;  // 파일 열기 전 탭 기억 (뒤로가기용)
  activeView: 'chat' | 'kanban' | 'history';

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
  openMobileContext: () => void;   // 현재 탭 기억하고 context panel 열기
  closeMobileContext: (fromPopState?: boolean) => void;  // 기억한 탭으로 복귀
  setActiveView: (view: 'chat' | 'kanban' | 'history') => void;
  clearAllClaudeSessionIds: () => void;
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
  mobileTabBeforeContext: 'chat',
  activeView: 'chat',

  setSessions: (sessions) => set({ sessions }),
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  addSession: (session) => set((s) => ({ sessions: [session, ...s.sessions] })),
  removeSession: (id) => set((s) => ({ sessions: s.sessions.filter((ss) => ss.id !== id) })),
  updateSessionMeta: (id, updates) =>
    set((s) => ({
      sessions: s.sessions.map((ss) =>
        ss.id === id
          ? { ...ss, ...updates, updatedAt: updates.updatedAt ?? new Date().toISOString() }
          : ss
      ),
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
  openMobileContext: () => {
    // 브라우저 뒤로가기로 닫을 수 있도록 history에 상태 추가
    history.pushState({ mobileContext: true }, '');
    set((s) => ({
      mobileTabBeforeContext: s.mobileTab,
      mobileContextOpen: true,
      mobileTab: 'edit',
    }));
  },
  closeMobileContext: (fromPopState?: boolean) => {
    // UI 버튼(←)으로 닫을 때는 pushState로 넣은 항목 제거
    if (!fromPopState && history.state?.mobileContext) {
      history.back();
      return; // popstate 핸들러가 다시 closeMobileContext(true) 호출
    }
    set((s) => {
      const returnTab = s.mobileTabBeforeContext;
      // files/pins/sessions → 사이드바 열기, chat → 사이드바 닫기
      const needsSidebar = returnTab === 'files' || returnTab === 'sessions' || returnTab === 'pins';
      return {
        mobileContextOpen: false,
        mobileTab: returnTab,
        sidebarOpen: needsSidebar,
        ...(returnTab === 'files' && { sidebarTab: 'files' as const }),
        ...(returnTab === 'sessions' && { sidebarTab: 'sessions' as const }),
        ...(returnTab === 'pins' && { sidebarTab: 'pins' as const }),
      };
    });
  },
  setActiveView: (view) => set({ activeView: view }),
  clearAllClaudeSessionIds: () =>
    set((s) => ({
      sessions: s.sessions.map((ss) => ({ ...ss, claudeSessionId: undefined })),
    })),
}));
