import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { ChatPanel } from './components/chat/ChatPanel';
import { ContextPanel } from './components/layout/ContextPanel';
import { LoginPage } from './components/auth/LoginPage';
import { useClaudeChat } from './hooks/useClaudeChat';
import { useChatStore } from './stores/chat-store';
import { useSessionStore, type SessionMeta } from './stores/session-store';
import { useFileStore } from './stores/file-store';

const API_BASE = '/api';

function findEntry(entries: import('./stores/file-store').FileEntry[], path: string): import('./stores/file-store').FileEntry | null {
  for (const e of entries) {
    if (e.path === path) return e;
    if (e.children) {
      const found = findEntry(e.children, path);
      if (found) return found;
    }
  }
  return null;
}

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [authStatus, setAuthStatus] = useState<{ authEnabled: boolean; hasUsers: boolean } | null>(null);
  const [authError, setAuthError] = useState('');

  const { sendMessage, abort, requestFile, requestFileTree, saveFile, connected } = useClaudeChat();

  const sidebarOpen = useSessionStore((s) => s.sidebarOpen);
  const setSidebarOpen = useSessionStore((s) => s.setSidebarOpen);
  const contextPanelOpen = useFileStore((s) => s.contextPanelOpen);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const addSession = useSessionStore((s) => s.addSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const setSessions = useSessionStore((s) => s.setSessions);

  // Check auth status
  useEffect(() => {
    fetch(`${API_BASE}/auth/status`)
      .then((r) => r.json())
      .then(setAuthStatus)
      .catch(() => setAuthStatus({ authEnabled: false, hasUsers: false }));
  }, []);

  // Load sessions when auth resolves
  useEffect(() => {
    if (authStatus === null) return; // Still loading auth
    if (authStatus.authEnabled && !token) return; // Need login first

    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(`${API_BASE}/sessions`, { headers })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setSessions(data))
      .catch(() => {});
  }, [token, authStatus, setSessions]);

  const handleLogin = async (username: string, password: string) => {
    setAuthError('');
    const isSetup = !authStatus?.hasUsers;
    const endpoint = isSetup ? '/auth/setup' : '/auth/login';
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || '로그인 실패');
        return;
      }
      localStorage.setItem('token', data.token);
      setToken(data.token);
      if (isSetup) {
        setAuthStatus({ ...authStatus!, hasUsers: true });
      }
    } catch {
      setAuthError('서버에 연결할 수 없습니다');
    }
  };

  const handleNewSession = useCallback(async () => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: `세션 ${new Date().toLocaleString('ko-KR')}` }),
      });
      if (res.ok) {
        const session = await res.json();
        addSession(session);
        setActiveSessionId(session.id);
        clearMessages();
      }
    } catch { }
  }, [token, addSession, setActiveSessionId, clearMessages]);

  const handleSelectSession = useCallback((session: SessionMeta) => {
    setActiveSessionId(session.id);
    clearMessages();
    // If session has a Claude session ID, we'll resume from it in the next message
    if (session.claudeSessionId) {
      useChatStore.getState().setClaudeSessionId(session.claudeSessionId);
    }
  }, [setActiveSessionId, clearMessages]);

  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${API_BASE}/sessions/${id}`, { method: 'DELETE', headers });
      removeSession(id);
    } catch { }
  }, [token, removeSession]);

  const handleFileClick = useCallback((path: string) => {
    requestFile(path);
  }, [requestFile]);

  const handleDirectoryClick = useCallback((dirPath: string) => {
    const fileStore = useFileStore.getState();
    const entry = findEntry(fileStore.tree, dirPath);
    if (entry && entry.isExpanded) {
      // Collapse
      fileStore.toggleDirectory(dirPath);
    } else {
      // Expand: set loading, fetch children, then set them
      fileStore.setDirectoryLoading(dirPath, true);
      fileStore.toggleDirectory(dirPath);
      requestFileTree(dirPath);
    }
  }, [requestFileTree]);

  const handleRenameSession = useCallback(async (id: string, name: string) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${API_BASE}/sessions/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name }),
      });
      useSessionStore.getState().updateSessionMeta(id, { name });
    } catch { }
  }, [token]);

  const handleToggleFavorite = useCallback(async (id: string, favorite: boolean) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${API_BASE}/sessions/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ favorite }),
      });
      useSessionStore.getState().updateSessionMeta(id, { favorite });
    } catch { }
  }, [token]);

  const handleSaveFile = useCallback((path: string, content: string) => {
    saveFile(path, content);
  }, [saveFile]);

  // Auth gate
  if (authStatus === null) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  if (authStatus.authEnabled && !token) {
    return (
      <LoginPage
        isSetup={!authStatus.hasUsers}
        onLogin={handleLogin}
        error={authError}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col bg-surface-950 text-gray-100 font-sans selection:bg-primary-500/30 selection:text-primary-100">
      <Header
        connected={connected}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        {sidebarOpen && (
          <Sidebar
            onNewSession={handleNewSession}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onRenameSession={handleRenameSession}
            onToggleFavorite={handleToggleFavorite}
            onFileClick={handleFileClick}
            onDirectoryClick={handleDirectoryClick}
            onRequestFileTree={() => requestFileTree()}
          />
        )}

        {/* Center: Chat panel */}
        <main className="flex-1 min-w-0 flex justify-center">
          <div className="w-full max-w-4xl flex flex-col h-full bg-surface-950/50 backdrop-blur-3xl shadow-xl shadow-black/20 border-x border-surface-900/50">
            <ChatPanel
              onSend={sendMessage}
              onAbort={abort}
              onFileClick={handleFileClick}
            />
          </div>
        </main>

        {/* Right: Context panel */}
        {contextPanelOpen && (
          <div className="w-96 border-l border-surface-800 bg-surface-900/90 backdrop-blur-md">
            <ContextPanel onSave={handleSaveFile} />
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <BottomBar />
    </div>
  );
}

function BottomBar() {
  const cost = useChatStore((s) => s.cost);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const model = useChatStore((s) => s.model);

  return (
    <footer className="h-8 bg-surface-900 border-t border-surface-800 flex items-center px-4 text-[11px] text-gray-400 gap-5 shrink-0 tabular-nums font-medium tracking-wide">
      <span className="flex items-center gap-2">
        {isStreaming ? (
          <><span className="w-1.5 h-1.5 rounded-full bg-primary-400 thinking-indicator shadow-[0_0_8px_rgba(167,139,250,0.8)]"></span> <span className="text-primary-300">응답 중...</span></>
        ) : (
          <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span> <span className="text-emerald-400/90">대기</span></>
        )}
      </span>
      {model && <span className="px-2 py-0.5 rounded-full bg-surface-800 border border-surface-700 text-gray-300 flex items-center gap-1.5"><svg className="w-3 h-3 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>{model}</span>}
      {cost.totalCost > 0 && (
        <div className="flex items-center gap-4 ml-auto">
          <span className="text-primary-300/90 font-semibold px-2 py-0.5 rounded-md bg-primary-900/20 border border-primary-500/20 flex items-center gap-1">
            <span className="text-primary-400">$</span>{cost.totalCost.toFixed(4)}
          </span>
          <span className="flex items-center gap-1.5" title="Input Tokens"><svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" /></svg>{cost.inputTokens.toLocaleString()}</span>
          <span className="flex items-center gap-1.5" title="Output Tokens"><svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" /></svg>{cost.outputTokens.toLocaleString()}</span>
          {cost.duration && <span className="flex items-center gap-1.5" title="Duration"><svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>{(cost.duration / 1000).toFixed(1)}s</span>}
        </div>
      )}
    </footer>
  );
}

export default App;
