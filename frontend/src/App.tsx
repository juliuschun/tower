import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Toaster } from 'sonner';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { ChatPanel } from './components/chat/ChatPanel';
import { ContextPanel } from './components/layout/ContextPanel';
import { LoginPage } from './components/auth/LoginPage';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { AdminPanel } from './components/admin/AdminPanel';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { OfflineBanner } from './components/common/OfflineBanner';
import { PromptEditor } from './components/prompts/PromptEditor';
import { ResizeHandle, SidebarResizeHandle, DEFAULT_WIDTH, SIDEBAR_DEFAULT_WIDTH } from './components/layout/ResizeHandle';
import { HorizontalResizeHandle } from './components/layout/HorizontalResizeHandle';
import { MobileTabBar } from './components/layout/MobileTabBar';
import { useClaudeChat } from './hooks/useClaudeChat';
import { useTheme } from './hooks/useTheme';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useChatStore } from './stores/chat-store';
import { useSessionStore, type SessionMeta } from './stores/session-store';
import { useFileStore } from './stores/file-store';
import { usePinStore, type Pin } from './stores/pin-store';
import { usePromptStore, type PromptItem } from './stores/prompt-store';
import { useSettingsStore } from './stores/settings-store';
import { useModelStore } from './stores/model-store';
import { useGitStore } from './stores/git-store';
import { normalizeContentBlocks } from './utils/message-parser';
import { toastSuccess, toastError } from './utils/toast';
import { KanbanBoard } from './components/kanban/KanbanBoard';
import { getTokenUserId, lastViewedKey } from './utils/session-restore';

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

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebarWidth');
    return saved ? parseInt(saved) : SIDEBAR_DEFAULT_WIDTH;
  });

  const handleSidebarResize = useCallback((width: number) => {
    setSidebarWidth(width);
    localStorage.setItem('sidebarWidth', String(width));
  }, []);

  const [expandedPanelHeight, setExpandedPanelHeight] = useState(() => {
    const saved = localStorage.getItem('expandedPanelHeight');
    return saved ? parseInt(saved) : Math.round(window.innerHeight * 0.65);
  });

  const handleExpandedPanelResize = useCallback((height: number) => {
    setExpandedPanelHeight(height);
    localStorage.setItem('expandedPanelHeight', String(height));
  }, []);

  const { sendMessage, abort, setActiveSession, requestFile, requestFileTree, saveFile, answerQuestion, connected } = useClaudeChat();
  const { theme } = useTheme();
  const isMobileQuery = useMediaQuery('(max-width: 768px)');
  const isMobile = useSessionStore((s) => s.isMobile);
  const mobileContextOpen = useSessionStore((s) => s.mobileContextOpen);
  const setMobileContextOpen = useSessionStore((s) => s.setMobileContextOpen);

  // Prevent browser from opening dropped files globally
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  // Sync media query to store
  useEffect(() => {
    useSessionStore.getState().setIsMobile(isMobileQuery);
    if (isMobileQuery) {
      useSessionStore.getState().setSidebarOpen(false);
    }
  }, [isMobileQuery]);

  const sidebarOpen = useSessionStore((s) => s.sidebarOpen);
  const setSidebarOpen = useSessionStore((s) => s.setSidebarOpen);
  const contextPanelOpen = useFileStore((s) => s.contextPanelOpen);
  const contextPanelExpanded = useFileStore((s) => s.contextPanelExpanded);
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
        setAuthError(data.error || 'Login failed');
        return;
      }
      localStorage.setItem('token', data.token);
      if (data.user?.role) localStorage.setItem('userRole', data.user.role);
      setToken(data.token);
      if (isSetup) {
        setAuthStatus({ ...authStatus!, hasUsers: true });
      }
    } catch {
      setAuthError('Cannot connect to server');
    }
  };

  // Create a session in DB and return it (reusable)
  const createSessionInDb = useCallback(async (name?: string): Promise<SessionMeta | null> => {
    try {
      // Inherit cwd from current active session
      const currentSessions = useSessionStore.getState().sessions;
      const currentActiveId = useSessionStore.getState().activeSessionId;
      const currentSession = currentSessions.find((s) => s.id === currentActiveId);
      const cwd = currentSession?.cwd || undefined;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: name || `Session ${new Date().toLocaleString('en-US')}`, cwd }),
      });
      if (res.ok) {
        const session = await res.json();
        addSession(session);
        return session;
      }
    } catch (err) { console.warn('[app] createSessionInDb failed:', err); }
    return null;
  }, [token, addSession]);

  const handleNewSession = useCallback(async () => {
    // Don't abort streaming — let the SDK query run in background and save to DB
    useChatStore.getState().setStreaming(false);
    useChatStore.getState().clearAttachments();
    const session = await createSessionInDb();
    if (session) {
      setActiveSessionId(session.id);
      useChatStore.getState().setSessionId(session.id);
      useChatStore.getState().setClaudeSessionId(null);
      clearMessages();
      setActiveSession(session.id);
    }
  }, [createSessionInDb, setActiveSessionId, clearMessages, setActiveSession]);

  const handleNewSessionInFolder = useCallback(async (cwd: string) => {
    // Don't abort streaming — let the SDK query run in background and save to DB
    useChatStore.getState().setStreaming(false);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: `Session ${new Date().toLocaleString('en-US')}`, cwd }),
      });
      if (res.ok) {
        const session = await res.json();
        addSession(session);
        setActiveSessionId(session.id);
        useChatStore.getState().setSessionId(session.id);
        useChatStore.getState().setClaudeSessionId(null);
        clearMessages();
        setActiveSession(session.id);
      }
    } catch (err) { console.warn('[app] handleNewSessionInFolder failed:', err); }
  }, [token, addSession, setActiveSessionId, clearMessages, setActiveSession]);

  const handleSelectSession = useCallback(async (session: SessionMeta) => {
    // Skip if already on this session
    const currentId = useSessionStore.getState().activeSessionId;
    if (currentId === session.id) return;

    // DON'T abort streaming — let the SDK query run in the background and save to DB.
    // When user switches back, messages are loaded from DB.
    useChatStore.getState().setStreaming(false);

    useChatStore.getState().clearAttachments();
    setActiveSessionId(session.id);
    localStorage.setItem(lastViewedKey(getTokenUserId(token)), session.id);
    clearMessages();
    useChatStore.getState().setSessionId(session.id);

    // Set Claude session ID for resume
    if (session.claudeSessionId) {
      useChatStore.getState().setClaudeSessionId(session.claudeSessionId);
    } else {
      useChatStore.getState().setClaudeSessionId(null);
    }

    // Notify backend of session switch
    setActiveSession(session.id, session.claudeSessionId);

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
    } catch (err) { console.warn('[app] handleSelectSession load messages failed:', err); }

    // Show switch indicator (only if no messages restored)
    useChatStore.getState().addMessage({
      id: crypto.randomUUID(),
      role: 'system',
      content: [{ type: 'text', text: `Switched to session "${session.name}"${session.claudeSessionId ? ' (can resume previous conversation)' : ''}` }],
      timestamp: Date.now(),
    });

  }, [setActiveSessionId, clearMessages, token, setActiveSession]);

  // Load sessions when auth resolves
  useEffect(() => {
    if (authStatus === null) return; // Still loading auth
    if (authStatus.authEnabled && !token) return; // Need login first

    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(`${API_BASE}/sessions`, { headers })
      .then((r) => {
        if (r.status === 401) { localStorage.removeItem('token'); setToken(null); return []; }
        return r.ok ? r.json() : [];
      })
      .then((data) => {
        setSessions(data);
        // Silently restore the last session the user was viewing
        const lastId = localStorage.getItem(lastViewedKey(getTokenUserId(token)));
        if (lastId) {
          const lastSession = data.find((s: SessionMeta) => s.id === lastId);
          if (lastSession) {
            handleSelectSession(lastSession);
          }
        }
      })
      .catch(() => {});
  }, [token, authStatus, setSessions, handleSelectSession]);

  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${API_BASE}/sessions/${id}`, { method: 'DELETE', headers });
      removeSession(id);
      toastSuccess('Session deleted');
    } catch (err) { console.warn('[app] handleDeleteSession failed:', err); }
  }, [token, removeSession]);

  const handleFileClick = useCallback((path: string) => {
    const fs = useFileStore.getState();
    if (fs.openFile && fs.openFile.modified && fs.openFile.path !== path) {
      if (!window.confirm('You have unsaved changes. Open another file?')) return;
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
    } catch (err) { console.warn('[app] handleRenameSession failed:', err); }
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
    } catch (err) { console.warn('[app] handleToggleFavorite failed:', err); }
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
    // Pass active session's cwd so SDK runs in the correct directory
    const activeSess = useSessionStore.getState().sessions.find(
      (s) => s.id === useSessionStore.getState().activeSessionId
    );
    sendMessage(message, cwd || activeSess?.cwd);
  }, [sendMessage, createSessionInDb, setActiveSessionId]);

  const handleSaveFile = useCallback((path: string, content: string) => {
    // If path starts with prompt:, update prompt store
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
          toastSuccess('Prompt saved');
        }).catch(() => toastError('Failed to save prompt'));
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
        toastSuccess(`${name} pinned`);
      }
    } catch (err) { console.warn('[app] handlePinFile failed:', err); }
  }, [token]);

  const handleUnpinFile = useCallback(async (id: number) => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${API_BASE}/pins/${id}`, { method: 'DELETE', headers });
      usePinStore.getState().removePin(id);
      toastSuccess('Unpinned');
    } catch (err) { console.warn('[app] handleUnpinFile failed:', err); }
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
      content: prompt.content || '(no content)',
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
    } catch (err) { console.warn('[app] handlePromptSave failed:', err); }
    setEditingPrompt(null);
  }, [token, editingPrompt]);

  const handlePromptDelete = useCallback(async (id: number | string) => {
    if (typeof id !== 'number') return; // Can't delete command-sourced prompts
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${API_BASE}/prompts/${id}`, { method: 'DELETE', headers });
      usePromptStore.getState().removePrompt(id);
    } catch (err) { console.warn('[app] handlePromptDelete failed:', err); }
  }, [token]);

  // ───── Git handlers ─────
  const handleViewDiff = useCallback((diff: string) => {
    useFileStore.getState().setContextPanelTab('preview');
    useFileStore.getState().setOpenFile({
      path: 'diff:git',
      content: diff,
      language: 'diff',
      modified: false,
    });
  }, []);

  // ───── Settings handlers ─────
  const handleOpenSettings = useCallback(() => {
    useSettingsStore.getState().setOpen(true);
  }, []);

  const [adminOpen, setAdminOpen] = useState(false);
  const isAdmin = localStorage.getItem('userRole') === 'admin';
  const handleOpenAdmin = useCallback(() => setAdminOpen(true), []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('userRole');
    setToken(null);
  }, []);

  // Kanban: navigate to session when card is clicked
  useEffect(() => {
    const handler = async (e: Event) => {
      const { sessionId } = (e as CustomEvent).detail;
      if (!sessionId) return;
      let session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
      // Fallback: fetch from API if not in store (e.g. task session not yet added)
      if (!session) {
        try {
          const headers: Record<string, string> = {};
          const t = localStorage.getItem('token');
          if (t) headers['Authorization'] = `Bearer ${t}`;
          const res = await fetch(`${API_BASE}/sessions/${sessionId}`, { headers });
          if (res.ok) {
            session = await res.json();
            if (session) addSession(session);
          }
        } catch {}
      }
      if (session) handleSelectSession(session);
    };
    window.addEventListener('kanban-select-session', handler);
    return () => window.removeEventListener('kanban-select-session', handler);
  }, [handleSelectSession, addSession]);

  const activeView = useSessionStore((s) => s.activeView);

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

    fetch(`${API_BASE}/git/log?limit=50`, { headers })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => useGitStore.getState().setCommits(data))
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
        <div className="text-gray-500">Loading...</div>
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
    <div className="h-screen flex flex-col app-bg text-gray-100 font-sans selection:bg-primary-500/30 selection:text-primary-100">
      <Toaster position="top-right" theme={theme} richColors closeButton />
      <OfflineBanner />
      <Header
        connected={connected}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onNewSession={handleNewSession}
        onAdminClick={isAdmin ? handleOpenAdmin : undefined}
        onViewDiff={handleViewDiff}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — drawer on mobile */}
        {sidebarOpen && isMobile && (
          <div className="fixed inset-0 z-40" onClick={() => setSidebarOpen(false)}>
            <div className="absolute inset-0 bg-black/50" />
            <div
              className="absolute left-0 top-0 bottom-0 w-[280px] animate-slide-in-left"
              onClick={(e) => e.stopPropagation()}
            >
              <Sidebar
                onNewSession={() => { handleNewSession(); setSidebarOpen(false); useSessionStore.getState().setMobileTab('chat'); }}
                onSelectSession={(s) => { handleSelectSession(s); setSidebarOpen(false); useSessionStore.getState().setMobileTab('chat'); }}
                onDeleteSession={handleDeleteSession}
                onRenameSession={handleRenameSession}
                onToggleFavorite={handleToggleFavorite}
                onFileClick={(p) => { handleFileClick(p); setSidebarOpen(false); }}
                onDirectoryClick={handleDirectoryClick}
                onRequestFileTree={(path) => requestFileTree(path)}
                onPinFile={handlePinFile}
                onUnpinFile={handleUnpinFile}
                onPinClick={(pin) => { handlePinClick(pin); setSidebarOpen(false); }}
                onSettingsClick={handleOpenSettings}
                onPromptClick={handlePromptClick}
                onPromptEdit={handlePromptEdit}
                onPromptDelete={handlePromptDelete}
                onPromptAdd={handlePromptAdd}
                onNewSessionInFolder={handleNewSessionInFolder}
              />
            </div>
          </div>
        )}
        {sidebarOpen && !isMobile && (
          <>
            <div className="shrink-0" style={{ width: sidebarWidth }}>
              <Sidebar
                onNewSession={handleNewSession}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
                onRenameSession={handleRenameSession}
                onToggleFavorite={handleToggleFavorite}
                onFileClick={handleFileClick}
                onDirectoryClick={handleDirectoryClick}
                onRequestFileTree={(path) => requestFileTree(path)}
                onPinFile={handlePinFile}
                onUnpinFile={handleUnpinFile}
                onPinClick={handlePinClick}
                onSettingsClick={handleOpenSettings}
                onPromptClick={handlePromptClick}
                onPromptEdit={handlePromptEdit}
                onPromptDelete={handlePromptDelete}
                onPromptAdd={handlePromptAdd}
              />
            </div>
            <SidebarResizeHandle onResize={handleSidebarResize} />
          </>
        )}

        {/* Mobile: fullscreen context panel modal */}
        {isMobile && mobileContextOpen && (
          <div className="fixed inset-0 z-40 bg-surface-950 flex flex-col">
            <div className="flex-1 overflow-hidden">
              <ErrorBoundary fallbackLabel="Context panel error">
                <ContextPanel
                  onSave={handleSaveFile}
                  onReload={requestFile}
                  onMobileClose={() => {
                    setMobileContextOpen(false);
                    useSessionStore.getState().setMobileTab('chat');
                  }}
                />
              </ErrorBoundary>
            </div>
          </div>
        )}

        {/* Desktop: expanded mode — vertical split (top: context, bottom: chat) */}
        {!isMobile && contextPanelExpanded && contextPanelOpen ? (
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {/* Top: ContextPanel — takes most space */}
            <div className="shrink-0 bg-surface-900/90 backdrop-blur-md overflow-hidden" style={{ height: expandedPanelHeight }}>
              <ErrorBoundary fallbackLabel="Context panel error">
                <ContextPanel onSave={handleSaveFile} onReload={requestFile} />
              </ErrorBoundary>
            </div>
            {/* Horizontal resize handle */}
            <HorizontalResizeHandle onResize={handleExpandedPanelResize} />
            {/* Bottom: ChatPanel or KanbanBoard — compact */}
            <main className="flex-1 min-h-0 flex justify-center">
              <div className={`w-full flex flex-col h-full shadow-xl shadow-black/20 ${activeView === 'kanban' ? 'bg-surface-950' : 'bg-surface-950/50 backdrop-blur-3xl'}`}>
                <ErrorBoundary fallbackLabel="Chat error">
                  {activeView === 'kanban' ? (
                    <KanbanBoard />
                  ) : (
                    <ChatPanel
                      onSend={handleSendMessage}
                      onAbort={abort}
                      onFileClick={handleFileClick}
                      onAnswerQuestion={answerQuestion}
                    />
                  )}
                </ErrorBoundary>
              </div>
            </main>
          </div>
        ) : !isMobile ? (
          <>
            {/* Normal mode: horizontal split (left: chat/kanban, right: context) */}
            <main className="flex-1 min-w-0 flex justify-center">
              <div className={`w-full flex flex-col h-full shadow-xl shadow-black/20 border-x border-surface-900/50 ${activeView === 'kanban' ? 'bg-surface-950' : 'max-w-4xl bg-surface-950/50 backdrop-blur-3xl'}`}>
                <ErrorBoundary fallbackLabel="Chat error">
                  {activeView === 'kanban' ? (
                    <KanbanBoard />
                  ) : (
                    <ChatPanel
                      onSend={handleSendMessage}
                      onAbort={abort}
                      onFileClick={handleFileClick}
                      onAnswerQuestion={answerQuestion}
                    />
                  )}
                </ErrorBoundary>
              </div>
            </main>

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
                title="Open panel"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            ) : null}
          </>
        ) : (
          /* Mobile: normal chat panel or kanban */
          <main className="flex-1 min-w-0 flex justify-center">
            <div className={`w-full flex flex-col h-full shadow-xl shadow-black/20 ${activeView === 'kanban' ? 'bg-surface-950' : 'bg-surface-950/50 backdrop-blur-3xl'}`}>
              <ErrorBoundary fallbackLabel="Chat error">
                {activeView === 'kanban' ? (
                  <KanbanBoard />
                ) : (
                  <ChatPanel
                    onSend={handleSendMessage}
                    onAbort={abort}
                    onFileClick={handleFileClick}
                    onAnswerQuestion={answerQuestion}
                  />
                )}
              </ErrorBoundary>
            </div>
          </main>
        )}
      </div>

      {/* Bottom bar / Mobile tab bar */}
      {isMobile ? <MobileTabBar /> : <BottomBar requestFileTree={requestFileTree} />}

      {/* Settings modal */}
      <SettingsPanel onLogout={handleLogout} />
      <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} token={token} />

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

function BottomBar({ requestFileTree }: { requestFileTree: (path?: string) => void }) {
  const cost = useChatStore((s) => s.cost);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sdkModel = useChatStore((s) => s.model);
  const selectedModel = useModelStore((s) => s.selectedModel);
  const availableModels = useModelStore((s) => s.availableModels);
  const currentModelInfo = availableModels.find((m) => m.id === selectedModel);
  const model = sdkModel || currentModelInfo?.name || selectedModel;
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const cwd = activeSession?.cwd;
  const [cwdPickerOpen, setCwdPickerOpen] = useState(false);

  return (
    <footer className="h-8 bg-surface-900 border-t border-surface-800 flex items-center px-4 text-[11px] text-gray-400 gap-5 shrink-0 tabular-nums font-medium tracking-wide relative">
      <span className="flex items-center gap-2">
        {isStreaming ? (
          <><span className="w-1.5 h-1.5 rounded-full bg-primary-400 thinking-indicator shadow-[0_0_8px_rgba(167,139,250,0.8)]"></span> <span className="text-primary-300">Responding...</span></>
        ) : (
          <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span> <span className="text-emerald-400/90">Ready</span></>
        )}
      </span>
      {model && <span className="px-2 py-0.5 rounded-full bg-surface-800 border border-surface-700 text-gray-300 flex items-center gap-1.5"><svg className="w-3 h-3 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>{model}</span>}
      {cwd && (
        <button
          onClick={() => !isStreaming && setCwdPickerOpen(!cwdPickerOpen)}
          disabled={isStreaming}
          className={`flex items-center gap-1.5 text-gray-500 hover:text-gray-300 transition-colors ${isStreaming ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          title={isStreaming ? 'Cannot change while streaming' : `Working directory: ${cwd} (click to change)`}
        >
          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>
          <span className="truncate max-w-[400px]">{cwd.replace(/^\/home\/[^/]+/, '~')}</span>
          <svg className={`w-2.5 h-2.5 transition-transform ${cwdPickerOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
        </button>
      )}
      {cwdPickerOpen && activeSessionId && cwd && (
        <CwdPicker
          currentCwd={cwd}
          sessionId={activeSessionId}
          onClose={() => setCwdPickerOpen(false)}
          requestFileTree={requestFileTree}
        />
      )}
      <div className="flex items-center gap-4 ml-auto">
      {activeSessionId && (
        <span
          className="text-gray-600 cursor-pointer hover:text-gray-400 transition-colors"
          title={`Session: ${activeSessionId}`}
          onClick={() => { navigator.clipboard.writeText(activeSessionId); }}
        >{activeSessionId.slice(0, 8)}</span>
      )}
      {cost.totalCost > 0 && (
        <div className="flex items-center gap-4">
          <span className="text-primary-300/90 font-semibold px-2 py-0.5 rounded-md bg-primary-900/20 border border-primary-500/20 flex items-center gap-1">
            <span className="text-primary-400">$</span>{cost.totalCost.toFixed(4)}
          </span>
          <span className="flex items-center gap-1.5" title="Input Tokens"><svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" /></svg>{cost.inputTokens.toLocaleString()}</span>
          <span className="flex items-center gap-1.5" title="Output Tokens"><svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" /></svg>{cost.outputTokens.toLocaleString()}</span>
          {cost.duration && <span className="flex items-center gap-1.5" title="Duration"><svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>{(cost.duration / 1000).toFixed(1)}s</span>}
        </div>
      )}
      </div>
    </footer>
  );
}

function CwdPicker({ currentCwd, sessionId, onClose, requestFileTree }: { currentCwd: string; sessionId: string; onClose: () => void; requestFileTree: (path?: string) => void }) {
  const [browsePath, setBrowsePath] = useState(currentCwd);
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [inputValue, setInputValue] = useState(currentCwd);
  const [loading, setLoading] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const sessions = useSessionStore((s) => s.sessions);

  // Recent unique cwds from sessions
  const recentCwds = Array.from(new Set(sessions.map((s) => s.cwd).filter(Boolean)))
    .filter((c) => c !== currentCwd)
    .slice(0, 5);

  // Fetch directories
  useEffect(() => {
    setLoading(true);
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch(`/api/directories?path=${encodeURIComponent(browsePath)}`, { headers })
      .then((r) => r.ok ? r.json() : { entries: [] })
      .then((data) => setDirs(data.entries || []))
      .catch(() => setDirs([]))
      .finally(() => setLoading(false));
  }, [browsePath]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const selectCwd = async (newCwd: string) => {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ cwd: newCwd }),
      });
      if (res.ok) {
        useSessionStore.getState().updateSessionMeta(sessionId, { cwd: newCwd });
        requestFileTree(newCwd);
        onClose();
      } else {
        const err = await res.json();
        toastError(err.error || 'Failed to change CWD');
      }
    } catch {
      toastError('Failed to change CWD');
    }
  };

  const goUp = () => {
    const parent = browsePath.replace(/\/[^/]+\/?$/, '') || '/';
    setBrowsePath(parent);
    setInputValue(parent);
  };

  const handleInputSubmit = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      selectCwd(inputValue.trim());
    }
  };

  return (
    <div ref={pickerRef} className="absolute bottom-full left-0 mb-1 w-96 bg-surface-900 border border-surface-700 rounded-lg shadow-2xl z-50 overflow-hidden">
      {/* Manual input */}
      <div className="p-2 border-b border-surface-800">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleInputSubmit}
          className="w-full bg-surface-950 border border-surface-700 rounded-md px-3 py-1.5 text-[12px] text-gray-200 font-mono focus:outline-none focus:border-primary-500/50"
          placeholder="Enter path and press Enter"
        />
      </div>

      {/* Recent cwds */}
      {recentCwds.length > 0 && (
        <div className="px-2 py-1.5 border-b border-surface-800">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 px-1">Recent</div>
          {recentCwds.map((c) => (
            <button
              key={c}
              onClick={() => selectCwd(c)}
              className="w-full text-left px-2 py-1 rounded text-[11px] text-gray-400 hover:bg-surface-800 hover:text-gray-200 truncate font-mono"
            >
              {c.replace(/^\/home\/[^/]+/, '~')}
            </button>
          ))}
        </div>
      )}

      {/* Directory browser */}
      <div className="max-h-48 overflow-y-auto">
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-surface-800">
          <button
            onClick={goUp}
            disabled={browsePath === '/'}
            className="p-1 rounded hover:bg-surface-800 text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Parent directory"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
          </button>
          <span className="text-[11px] text-gray-500 font-mono truncate flex-1">{browsePath.replace(/^\/home\/[^/]+/, '~')}</span>
          <button
            onClick={() => selectCwd(browsePath)}
            className="text-[10px] px-2 py-0.5 rounded bg-primary-600/20 border border-primary-500/30 text-primary-300 hover:bg-primary-600/30"
          >
            Select
          </button>
        </div>
        {loading ? (
          <div className="py-4 text-center text-[11px] text-gray-500">Loading...</div>
        ) : dirs.length === 0 ? (
          <div className="py-4 text-center text-[11px] text-gray-500">No subdirectories</div>
        ) : (
          dirs.map((d) => (
            <button
              key={d.path}
              onClick={() => { setBrowsePath(d.path); setInputValue(d.path); }}
              onDoubleClick={() => selectCwd(d.path)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-800/60 transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-yellow-500/60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>
              <span className="text-[11px] text-gray-300 truncate">{d.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default App;
