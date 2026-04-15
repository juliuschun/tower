import { create } from 'zustand';
import { dedupeSessionsById, addSessionIfNew } from '../utils/session-filters';
export type { SessionMeta } from '@tower/shared';
import type { SessionMeta } from '@tower/shared';

export type MobileTab = 'sessions' | 'chat' | 'files' | 'edit' | 'pins' | 'board' | 'channel';

/**
 * A cached "last AI turn text" per session — populated live from WebSocket
 * tower_message events for ALL sessions (even background ones).
 *
 * Why it exists: Inbox cards need the latest assistant response to preview.
 * Without this cache, InboxPanel fires a REST fetch after the card appears,
 * which is slow for long task sessions (limit=500, often takes seconds) and
 * shows stale content when the same session re-completes. With this cache,
 * the text is already in memory the moment the card appears.
 */
export interface LastTurnCacheEntry {
  /** The full assistant text for the last turn, extracted from all text blocks. */
  text: string;
  /** When the last streaming update arrived (not session.updatedAt). */
  updatedAt: number;
  /** Set when turn_done/engine_done has been observed; text is final. */
  finalized: boolean;
  /**
   * Per-msgId text accumulator for multi-turn tool cycles.
   * Each assistant message in a turn has a different msgId.
   * We track each msgId's text separately, then join them for the final `text`.
   * This prevents the "replace" problem where only the last assistant msg shows.
   */
  msgTexts?: Record<string, string>;
}

interface SessionState {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  streamingSessions: Set<string>;
  unreadSessions: Set<string>;
  /** sessionId → last-turn text cache (see LastTurnCacheEntry) */
  lastTurnTextBySession: Record<string, LastTurnCacheEntry>;
  sidebarOpen: boolean;
  sidebarTab: 'sessions' | 'files' | 'prompts' | 'pins' | 'rooms' | 'history';
  lastSidebarTab: 'sessions' | 'files' | 'prompts' | 'pins' | 'rooms' | 'history';
  searchQuery: string;
  isMobile: boolean;
  mobileTab: MobileTab;
  mobileContextOpen: boolean;
  mobileTabBeforeContext: MobileTab;  // 파일 열기 전 탭 기억 (뒤로가기용)
  activeView: 'chat' | 'kanban' | 'history' | 'rooms' | 'files' | 'inbox' | 'usage' | 'schedules' | 'automations';

  // Inbox → ChatPanel pending reply queue (set in InboxPanel, consumed in ChatPanel)
  pendingReplies: Record<string, string>;
  setPendingReply: (sessionId: string, text: string) => void;
  clearPendingReply: (sessionId: string) => void;

  setSessions: (sessions: SessionMeta[]) => void;
  setActiveSessionId: (id: string | null) => void;
  addSession: (session: SessionMeta) => void;
  removeSession: (id: string) => void;
  updateSessionMeta: (id: string, updates: Partial<SessionMeta>) => void;
  setSessionStreaming: (id: string, streaming: boolean) => void;
  markSessionRead: (id: string) => void;
  /**
   * Write/update the cached last-turn text for a session.
   * When msgId is provided, accumulates text across multiple assistant messages
   * in a single turn (multi-turn tool cycles). Without msgId, replaces the entire text.
   */
  setLastTurnText: (sessionId: string, text: string, finalized?: boolean, msgId?: string) => void;
  /** Clear the cached last-turn text (e.g. when a session is deleted). */
  clearLastTurnText: (sessionId: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarTab: (tab: 'sessions' | 'files' | 'prompts' | 'pins' | 'rooms' | 'history') => void;
  setLastSidebarTab: (tab: 'sessions' | 'files' | 'prompts' | 'pins' | 'rooms' | 'history') => void;
  setSearchQuery: (query: string) => void;
  setIsMobile: (v: boolean) => void;
  setMobileTab: (tab: MobileTab) => void;
  setMobileContextOpen: (v: boolean) => void;
  openMobileContext: () => void;   // 현재 탭 기억하고 context panel 열기
  closeMobileContext: (fromPopState?: boolean) => void;  // 기억한 탭으로 복귀
  setActiveView: (view: 'chat' | 'kanban' | 'history' | 'rooms' | 'files' | 'inbox' | 'usage' | 'schedules' | 'automations') => void;
}

// Detect mobile at store creation to avoid first-render layout flash
const _initialIsMobile = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches;

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  streamingSessions: new Set(),
  unreadSessions: new Set(),
  lastTurnTextBySession: {},
  sidebarOpen: true,
  sidebarTab: 'sessions',
  lastSidebarTab: 'sessions',
  searchQuery: '',
  isMobile: _initialIsMobile,
  mobileTab: 'chat',
  mobileContextOpen: false,
  mobileTabBeforeContext: 'chat',
  activeView: 'chat',
  pendingReplies: {},

  setSessions: (sessions) => {
    set({ sessions: dedupeSessionsById(sessions) });
  },
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  addSession: (session) => set((s) => {
    const updated = addSessionIfNew(s.sessions, session);
    if (updated === s.sessions) return s; // no change — skip rerender
    return { sessions: updated };
  }),
  removeSession: (id) =>
    set((s) => {
      // Also drop any cached last-turn text — otherwise a deleted session's
      // cache entry would linger indefinitely. Mirrors how Set-based state
      // (unreadSessions, streamingSessions) is cleaned up on session lifecycle.
      const next: Record<string, LastTurnCacheEntry> = {};
      for (const [sid, entry] of Object.entries(s.lastTurnTextBySession)) {
        if (sid !== id) next[sid] = entry;
      }
      return {
        sessions: s.sessions.filter((ss) => ss.id !== id),
        lastTurnTextBySession: next,
      };
    }),
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
        // Only mark as unread if not currently viewed AND owned by current user.
        // "Currently viewed" means the session is activeSessionId AND the user
        // is actually on the chat view.  If the user navigated to Inbox, Kanban,
        // etc., the session is no longer "being viewed" even though
        // activeSessionId hasn't been cleared.
        const currentUsername = localStorage.getItem('username') || '';
        const session = s.sessions.find((ss) => ss.id === id);
        const isOwnSession = session && session.ownerUsername === currentUsername;
        const isViewingSession = s.activeSessionId === id && s.activeView === 'chat';
        if (!isViewingSession && isOwnSession) {
          const unread = new Set(s.unreadSessions);
          unread.add(id);
          // Add session-done notification to room store (deferred to avoid circular import)
          setTimeout(async () => {
            const { useRoomStore } = await import('./room-store');
            const notif = {
              id: `session-done-${id}-${Date.now()}`,
              userId: 0,
              roomId: null,
              type: 'session_done' as const,
              title: `${session?.name || 'Session'} — done`,
              body: null,
              metadata: { sessionId: id } as Record<string, unknown>,
              read: false,
              createdAt: new Date().toISOString(),
            };
            useRoomStore.getState().addNotification(notif);
          }, 0);
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
  setLastTurnText: (sessionId, text, finalized = false, msgId?: string) =>
    set((s) => {
      const prev = s.lastTurnTextBySession[sessionId];

      // When msgId is provided, accumulate text across multiple assistant messages
      // in a single turn (multi-turn tool cycles). Each msgId's text is tracked
      // separately and joined for the composite `text` field.
      if (msgId) {
        // If the previous entry was finalized (turn_done), this is a new turn —
        // reset the accumulator so old turn's text doesn't leak into the new one.
        const prevMsgTexts = (prev?.finalized ? {} : prev?.msgTexts) ?? {};
        // Skip no-op: same msgId with identical text
        if (prevMsgTexts[msgId] === text && prev?.finalized === finalized) return s;
        const msgTexts = { ...prevMsgTexts, [msgId]: text };
        const compositeText = Object.values(msgTexts).filter(Boolean).join('\n\n');
        return {
          lastTurnTextBySession: {
            ...s.lastTurnTextBySession,
            [sessionId]: { text: compositeText, updatedAt: Date.now(), finalized, msgTexts },
          },
        };
      }

      // Legacy path (no msgId) — simple replace.
      // Skip no-op updates (same text, same finalized flag) to avoid rerendering
      // every subscriber on each streaming token.
      if (prev && prev.text === text && prev.finalized === finalized) return s;
      return {
        lastTurnTextBySession: {
          ...s.lastTurnTextBySession,
          [sessionId]: { text, updatedAt: Date.now(), finalized },
        },
      };
    }),
  clearLastTurnText: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.lastTurnTextBySession)) return s;
      const next = { ...s.lastTurnTextBySession };
      delete next[sessionId];
      return { lastTurnTextBySession: next };
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
  setPendingReply: (sessionId, text) =>
    set((s) => ({ pendingReplies: { ...s.pendingReplies, [sessionId]: text } })),
  clearPendingReply: (sessionId) =>
    set((s) => {
      const { [sessionId]: _, ...rest } = s.pendingReplies;
      return { pendingReplies: rest };
    }),
}));
