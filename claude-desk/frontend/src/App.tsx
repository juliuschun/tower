import React, { useState, useEffect, useCallback } from 'react';
import { Toaster } from 'sonner';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { ChatPanel } from './components/chat/ChatPanel';
import { ContextPanel } from './components/layout/ContextPanel';
import { LoginPage } from './components/auth/LoginPage';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { PromptEditor } from './components/prompts/PromptEditor';
import { ResizeHandle, DEFAULT_WIDTH } from './components/layout/ResizeHandle';
import { useClaudeChat } from './hooks/useClaudeChat';
import { useChatStore } from './stores/chat-store';
import { useSessionStore, type SessionMeta } from './stores/session-store';
import { useFileStore } from './stores/file-store';
import { usePinStore, type Pin } from './stores/pin-store';
import { usePromptStore, type PromptItem } from './stores/prompt-store';
import { useSettingsStore } from './stores/settings-store';
import { useModelStore } from './stores/model-store';
import { normalizeContentBlocks } from './utils/message-parser';
import { toastSuccess, toastError } from './utils/toast';

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
  const [contextPanelWidth, setContextPanelWidth] = useState(() => {
    const saved = localStorage.getItem('contextPanelWidth');
    return saved ? parseInt(saved) : DEFAULT_WIDTH;
  });

  const handleContextPanelResize = useCallback((width: number) => {
    setContextPanelWidth(width);
    localStorage.setItem('contextPanelWidth', String(width));
  }, []);

  const { sendMessage, abort, requestFile, requestFileTree, saveFile, connected } = useClaudeChat();

  const sidebarOpen = useSessionStore((s) => s.sidebarOpen);
  const setSidebarOpen = useSessionStore((s) => s.setSidebarOpen);
  const contextPanelOpen = useFileStore((s) => s.contextPanelOpen);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
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

  // Create a session in DB and return it (reusable)
  const createSessionInDb = useCallback(async (name?: string): Promise<SessionMeta | null> => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: name || `세션 ${new Date().toLocaleString('ko-KR')}` }),
      });
      if (res.ok) {
        const session = await res.json();
        addSession(session);
        return session;
      }
    } catch { }
    return null;
  }, [token, addSession]);

  const handleNewSession = useCallback(async () => {
    const session = await createSessionInDb();
    if (session) {
      setActiveSessionId(session.id);
      useChatStore.getState().setSessionId(session.id);
      useChatStore.getState().setClaudeSessionId(null);
      clearMessages();
    }
  }, [createSessionInDb, setActiveSessionId, clearMessages]);

  const handleSelectSession = useCallback(async (session: SessionMeta) => {
    // Skip if already on this session
    const currentId = useSessionStore.getState().activeSessionId;
    if (currentId === session.id) return;

    setActiveSessionId(session.id);
    clearMessages();
    useChatStore.getState().setSessionId(session.id);

    // Set Claude session ID for resume
    if (session.claudeSessionId) {
      useChatStore.getState().setClaudeSessionId(session.claudeSessionId);
    } else {
      useChatStore.getState().setClaudeSessionId(null);
    }

    // Load persisted messages
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/sessions/${session.id}/messages`, { headers });
      if (res.ok) {
        const stored = await res.json();
        if (stored.length > 0) {
          const msgs = stored.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: normalizeContentBlocks(
              typeof m.content === 'string' ? JSON.parse(m.content) : m.content
            ),
            timestamp: new Date(m.created_at).getTime(),
            parentToolUseId: m.parent_tool_use_id,
          }));
          useChatStore.getState().setMessages(msgs);
          return; // Skip system message if we restored messages
        }
      }
    } catch {}

    // Show switch indicator (only if no messages restored)
    useChatStore.getState().addMessage({
      id: crypto.randomUUID(),
      role: 'system',
      content: [{ type: 'text', text: `세션 "${session.name}" 으로 전환됨${session.claudeSessionId ? ' (이전 대화 이어가기 가능)' : ''}` }],
      timestamp: Date.now(),
    });
  }, [setActiveSessionId, clearMessages, token]);

  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${API_BASE}/sessions/${id}`, { method: 'DELETE', headers });
      removeSession(id);
      toastSuccess('세션 삭제됨');
    } catch { }
  }, [token, removeSession]);

  const handleFileClick = useCallback((path: string) => {
    const fs = useFileStore.getState();
    // Unsaved guard when switching files
    if (fs.openFile && fs.openFile.modified && fs.openFile.path !== path) {
      if (!window.confirm('저장하지 않은 변경사항이 있습니다. 다른 파일을 여시겠습니까?')) return;
    }
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
        body: JSON.stringify({ name, autoNamed: 0 }),
      });
      useSessionStore.getState().updateSessionMeta(id, { name, autoNamed: 0 });
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

  // Auto-create session on first message if no active session
  const handleSendMessage = useCallback(async (message: string, cwd?: string) => {
    const currentActiveId = useSessionStore.getState().activeSessionId;
    if (!currentActiveId) {
      // Auto-create a session
      const session = await createSessionInDb();
      if (session) {
        setActiveSessionId(session.id);
        useChatStore.getState().setSessionId(session.id);
      }
    }
    sendMessage(message, cwd);
  }, [sendMessage, createSessionInDb, setActiveSessionId]);

  const handleSaveFile = useCallback((path: string, content: string) => {
    // prompt: 경로면 prompt store 업데이트
    if (path.startsWith('prompt:')) {
      const title = path.slice('prompt:'.length);
      const prompts = usePromptStore.getState().prompts;
      const match = prompts.find((p) => p.title === title);
      if (match && typeof match.id === 'number') {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        fetch(`${API_BASE}/prompts/${match.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ title: match.title, content }),
        }).then(() => {
          usePromptStore.getState().updatePrompt(match.id, { content });
          useFileStore.getState().setOpenFile({
            path, content, language: 'markdown', modified: false,
          });
          toastSuccess('프롬프트 저장됨');
        }).catch(() => toastError('프롬프트 저장 실패'));
      }
      return;
    }
    saveFile(path, content);
  }, [saveFile, token]);

  // ───── Pin handlers ─────
  const handlePinFile = useCallback(async (filePath: string) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const name = filePath.split('/').pop() || filePath;
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const typeMap: Record<string, string> = {
        md: 'markdown', html: 'html', htm: 'html', txt: 'text',
        py: 'python', ts: 'typescript', tsx: 'typescript',
        js: 'javascript', jsx: 'javascript', json: 'json',
      };
      const res = await fetch(`${API_BASE}/pins`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: name, filePath, fileType: typeMap[ext] || 'text' }),
      });
      if (res.ok) {
        const pin = await res.json();
        usePinStore.getState().addPin(pin);
        toastSuccess(`${name} 핀 추가됨`);
      }
    } catch {}
  }, [token]);

  const handleUnpinFile = useCallback(async (id: number) => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${API_BASE}/pins/${id}`, { method: 'DELETE', headers });
      usePinStore.getState().removePin(id);
      toastSuccess('핀 해제됨');
    } catch {}
  }, [token]);

  const handlePinClick = useCallback((pin: Pin) => {
    requestFile(pin.file_path);
  }, [requestFile]);

  // ───── Prompt handlers ─────
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<PromptItem | null>(null);

  const handlePromptClick = useCallback((prompt: PromptItem) => {
    // Show prompt content in ContextPanel
    useFileStore.getState().setContextPanelTab('preview');
    useFileStore.getState().setOpenFile({
      path: `prompt:${prompt.title}`,
      content: prompt.content || '(내용 없음)',
      language: 'markdown',
      modified: false,
    });
  }, []);

  const handlePromptAdd = useCallback(() => {
    setEditingPrompt(null);
    setPromptEditorOpen(true);
  }, []);

  const handlePromptEdit = useCallback((prompt: PromptItem) => {
    setEditingPrompt(prompt);
    setPromptEditorOpen(true);
  }, []);

  const handlePromptSave = useCallback(async (title: string, content: string) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      if (editingPrompt && typeof editingPrompt.id === 'number') {
        await fetch(`${API_BASE}/prompts/${editingPrompt.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ title, content }),
        });
        usePromptStore.getState().updatePrompt(editingPrompt.id, { title, content });
      } else {
        const res = await fetch(`${API_BASE}/prompts`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ title, content }),
        });
        if (res.ok) {
          const pin = await res.json();
          usePromptStore.getState().addPrompt({
            id: pin.id,
            title: pin.title,
            content: pin.content || '',
            source: 'user',
            readonly: false,
          });
        }
      }
    } catch {}
    setEditingPrompt(null);
  }, [token, editingPrompt]);

  const handlePromptDelete = useCallback(async (id: number | string) => {
    if (typeof id !== 'number') return; // Can't delete command-sourced prompts
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${API_BASE}/prompts/${id}`, { method: 'DELETE', headers });
      usePromptStore.getState().removePrompt(id);
    } catch {}
  }, [token]);

  // ───── Settings handlers ─────
  const handleOpenSettings = useCallback(() => {
    useSettingsStore.getState().setOpen(true);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
  }, []);

  // Global Ctrl+S handler (fallback when CodeMirror doesn't have focus)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const fs = useFileStore.getState();
        if (fs.openFile && fs.openFile.modified) {
          handleSaveFile(fs.openFile.path, fs.openFile.content);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSaveFile]);

  // Toggle panel handler — reopen last file
  const lastOpenedFilePath = useFileStore((s) => s.lastOpenedFilePath);
  const handleToggleContextPanel = useCallback(() => {
    if (lastOpenedFilePath) {
      requestFile(lastOpenedFilePath);
    }
  }, [lastOpenedFilePath, requestFile]);

  // Load pins + server config on mount
  useEffect(() => {
    if (authStatus === null) return;
    if (authStatus.authEnabled && !token) return;

    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(`${API_BASE}/pins`, { headers })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => usePinStore.getState().setPins(data))
      .catch(() => {});

    fetch(`${API_BASE}/prompts`, { headers })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => usePromptStore.getState().setPrompts(data))
      .catch(() => {});

    fetch(`${API_BASE}/config`, { headers })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          useSettingsStore.getState().setServerConfig(data);
          if (data.models) useModelStore.getState().setAvailableModels(data.models);
          if (data.connectionType) useModelStore.getState().setConnectionType(data.connectionType);
        }
      })
      .catch(() => {});
  }, [token, authStatus]);

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
      <Toaster position="top-right" theme="dark" richColors closeButton />
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
            onPinFile={handlePinFile}
            onUnpinFile={handleUnpinFile}
            onPinClick={handlePinClick}
            onSettingsClick={handleOpenSettings}
            onPromptClick={handlePromptClick}
            onPromptEdit={handlePromptEdit}
            onPromptDelete={handlePromptDelete}
            onPromptAdd={handlePromptAdd}
          />
        )}

        {/* Center: Chat panel */}
        <main className="flex-1 min-w-0 flex justify-center">
          <div className="w-full max-w-4xl flex flex-col h-full bg-surface-950/50 backdrop-blur-3xl shadow-xl shadow-black/20 border-x border-surface-900/50">
            <ErrorBoundary fallbackLabel="Chat error">
              <ChatPanel
                onSend={handleSendMessage}
                onAbort={abort}
                onFileClick={handleFileClick}
              />
            </ErrorBoundary>
          </div>
        </main>

        {/* Right: Context panel */}
        {contextPanelOpen ? (
          <>
            <ResizeHandle onResize={handleContextPanelResize} />
            <div className="shrink-0 bg-surface-900/90 backdrop-blur-md" style={{ width: contextPanelWidth }}>
              <ErrorBoundary fallbackLabel="Context panel error">
                <ContextPanel onSave={handleSaveFile} onReload={requestFile} />
              </ErrorBoundary>
            </div>
          </>
        ) : lastOpenedFilePath ? (
          <button
            onClick={handleToggleContextPanel}
            className="shrink-0 w-6 flex items-center justify-center bg-surface-900/60 hover:bg-surface-800/80 border-l border-surface-700/50 transition-colors text-gray-500 hover:text-gray-300"
            title="패널 열기"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* Bottom bar */}
      <BottomBar />

      {/* Settings modal */}
      <SettingsPanel onLogout={handleLogout} />

      {/* Prompt editor modal */}
      <PromptEditor
        open={promptEditorOpen}
        onClose={() => { setPromptEditorOpen(false); setEditingPrompt(null); }}
        onSave={handlePromptSave}
        initial={editingPrompt ? { title: editingPrompt.title, content: editingPrompt.content } : undefined}
      />
    </div>
  );
}

function BottomBar() {
  const cost = useChatStore((s) => s.cost);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sdkModel = useChatStore((s) => s.model);
  const selectedModel = useModelStore((s) => s.selectedModel);
  const availableModels = useModelStore((s) => s.availableModels);
  const currentModelInfo = availableModels.find((m) => m.id === selectedModel);
  const model = sdkModel || currentModelInfo?.name || selectedModel;

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
