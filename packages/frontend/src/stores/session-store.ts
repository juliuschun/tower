import { create } from 'zustand';
import { dedupeSessionsById, addSessionIfNew } from '../utils/session-filters';
export type { SessionMeta } from '@tower/shared';
import type { SessionMeta } from '@tower/shared';

export type MobileTab = 'sessions' | 'chat' | 'files' | 'edit' | 'pins' | 'board' | 'channel';

interface SessionState {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  streamingSessions: Set<string>;
  unreadSessions: Set<string>;
  sidebarOpen: boolean;
  sidebarTab: 'sessions' | 'files' | 'prompts' | 'pins' | 'rooms' | 'history';
  lastSidebarTab: 'sessions' | 'files' | 'prompts' | 'pins' | 'rooms' | 'history';
  searchQuery: string;
  isMobile: boolean;
  mobileTab: MobileTab;
  mobileContextOpen: boolean;
  mobileTabBeforeContext: MobileTab;  // 파일 열기 전 탭 기억 (뒤로가기용)
  activeView: 'chat' | 'kanban' | 'history' | 'rooms' | 'files';

  setSessions: (sessions: SessionMeta[]) => void;
  setActiveSessionId: (id: string | null) => void;
  addSession: (session: SessionMeta) => void;
  removeSession: (id: string) => void;
  updateSessionMeta: (id: string, updates: Partial<SessionMeta>) => void;
  setSessionStreaming: (id: string, streaming: boolean) => void;
  markSessionRead: (id: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarTab: (tab: 'sessions' | 'files' | 'prompts' | 'pins' | 'rooms' | 'history') => void;
  setLastSidebarTab: (tab: 'sessions' | 'files' | 'prompts' | 'pins' | 'rooms' | 'history') => void;
  setSearchQuery: (query: string) => void;
  setIsMobile: (v: boolean) => void;
  setMobileTab: (tab: MobileTab) => void;
  setMobileContextOpen: (v: boolean) => void;
  openMobileContext: () => void;   // 현재 탭 기억하고 context panel 열기
  closeMobileContext: (fromPopState?: boolean) => void;  // 기억한 탭으로 복귀
  setActiveView: (view: 'chat' | 'kanban' | 'history' | 'rooms' | 'files') => void;
}

// Detect mobile at store creation to avoid first-render layout flash
const _initialIsMobile = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches;

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  streamingSessions: new Set(),
  unreadSessions: new Set(),
  sidebarOpen: true,
  sidebarTab: 'sessions',
  lastSidebarTab: 'sessions',
  searchQuery: '',
  isMobile: _initialIsMobile,
  mobileTab: 'chat',
  mobileContextOpen: false,
  mobileTabBeforeContext: 'chat',
  activeView: 'chat',

  setSessions: (sessions) => {
    set({ sessions: dedupeSessionsById(sessions) });
  },
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  addSession: (session) => set((s) => {
    const updated = addSessionIfNew(s.sessions, session);
    if (updated === s.sessions) return s; // no change — skip rerender
    return { sessions: updated };
  }),
  removeSession: (id) => set((s) => ({ sessions: s.sessions.filter((ss) => ss.id !== id) })),
  updateSessionMeta: (id, updates) =>
    set((s) => ({
      sessions: s.sessions.map((ss) =>
        ss.id === id
          ? { ...ss, ...updates, updatedAt: updates.updatedAt ?? ss.updatedAt }
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
  setLastSidebarTab: (tab) => set({ lastSidebarTab: tab }),
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
}));
