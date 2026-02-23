import { useCallback, useRef } from 'react';
import { useWebSocket } from './useWebSocket';
import { useChatStore, type ChatMessage, type ContentBlock, type SlashCommandInfo } from '../stores/chat-store';
import { useFileStore } from '../stores/file-store';
import { useSessionStore } from '../stores/session-store';
import { useModelStore } from '../stores/model-store';
import { useGitStore } from '../stores/git-store';
import { parseSDKMessage, normalizeContentBlocks } from '../utils/message-parser';
import { shouldDropSessionMessage, shouldResetAssistantRef } from '../utils/session-filters';
import { toastSuccess, toastError, toastWarning } from '../utils/toast';

/** Debounce timer for auto-reload of externally changed files */
let fileChangeDebounce: ReturnType<typeof setTimeout> | null = null;

/** Recover messages from DB for the active session (full replace) */
async function recoverMessagesFromDb(sessionId: string) {
  try {
    const tk = localStorage.getItem('token');
    const hdrs: Record<string, string> = {};
    if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
    const res = await fetch(`/api/sessions/${sessionId}/messages`, { headers: hdrs });
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
      }
    }
  } catch (err) {
    console.warn('[recoverMessagesFromDb] failed:', err);
  }
}

/** Merge DB messages into current UI messages (for streaming gap recovery) */
async function mergeMessagesFromDb(sessionId: string) {
  try {
    const tk = localStorage.getItem('token');
    const hdrs: Record<string, string> = {};
    if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
    const res = await fetch(`/api/sessions/${sessionId}/messages`, { headers: hdrs });
    if (!res.ok) return;
    const stored = await res.json();
    if (stored.length === 0) return;

    const dbMsgs: import('../stores/chat-store').ChatMessage[] = stored.map((m: any) => ({
      id: m.id,
      role: m.role,
      content: normalizeContentBlocks(
        typeof m.content === 'string' ? JSON.parse(m.content) : m.content
      ),
      timestamp: new Date(m.created_at).getTime(),
      parentToolUseId: m.parent_tool_use_id,
    }));

    const currentMsgs = useChatStore.getState().messages;
    const currentIds = new Set(currentMsgs.map((m) => m.id));

    // Build merged list: start with DB messages (authoritative order),
    // update content for existing ones, add missing ones
    const merged = dbMsgs.map((dbMsg) => {
      if (currentIds.has(dbMsg.id)) {
        // Keep UI version but update content from DB (DB may be more complete)
        const uiMsg = currentMsgs.find((m) => m.id === dbMsg.id)!;
        return { ...uiMsg, content: dbMsg.content };
      }
      return dbMsg;
    });

    // Append any UI-only messages not in DB (e.g. system messages, in-flight streaming)
    const dbIds = new Set(dbMsgs.map((m) => m.id));
    for (const uiMsg of currentMsgs) {
      if (!dbIds.has(uiMsg.id)) {
        merged.push(uiMsg);
      }
    }

    useChatStore.getState().setMessages(merged);
  } catch (err) {
    console.warn('[mergeMessagesFromDb] failed:', err);
  }
}

export function useClaudeChat() {
  const token = localStorage.getItem('token');
  const wsBase = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const wsUrl = token ? `${wsBase}?token=${encodeURIComponent(token)}` : wsBase;
  const currentAssistantMsg = useRef<ChatMessage | null>(null);
  const currentAssistantSessionRef = useRef<string | null>(null);
  const sendRef = useRef<(data: any) => void>(() => {});
  const serverEpochRef = useRef<string | null>(null);

  const {
    addMessage, setStreaming, setSessionId, setClaudeSessionId,
    setSystemInfo, setCost, sessionId, claudeSessionId
  } = useChatStore();

  const { setTree, setDirectoryChildren, handleFileChange } = useFileStore();

  const handleMessage = useCallback((data: any) => {
    switch (data.type) {
      case 'connected': {
        const newEpoch = data.serverEpoch;
        if (serverEpochRef.current && newEpoch && serverEpochRef.current !== newEpoch) {
          // Server restarted — epoch changed
          toastWarning('서버가 재시작되었습니다');
          useChatStore.getState().setStreaming(false);
          currentAssistantMsg.current = null;
        }
        serverEpochRef.current = newEpoch || null;
        break;
      }

      case 'reconnect_result': {
        if (data.status === 'streaming') {
          useChatStore.getState().setStreaming(true);
          safetyTimerFired.current = false;
          // Merge DB messages to fill any gap from disconnection
          if (data.sessionId) {
            mergeMessagesFromDb(data.sessionId);
          }
          toastSuccess('스트림 재연결됨');
        } else {
          // status === 'idle'
          // Check wasStreaming OR safetyTimerFired (timer may have cleared isStreaming before reconnect)
          const wasStreaming = useChatStore.getState().isStreaming || safetyTimerFired.current;
          useChatStore.getState().setStreaming(false);
          safetyTimerFired.current = false;
          currentAssistantMsg.current = null;
          if (wasStreaming && data.sessionId) {
            // Was streaming but SDK finished while disconnected — recover from DB
            recoverMessagesFromDb(data.sessionId);
            toastSuccess('응답 복구됨');
          }
        }
        break;
      }

      case 'sdk_message': {
        // Ignore messages for sessions we're not currently viewing
        const _currentSid = useChatStore.getState().sessionId;
        if (shouldDropSessionMessage(_currentSid, data.sessionId)) return;

        const sdkMsg = data.data;

        // System init — may repeat each turn, only update info without resetting
        if (sdkMsg.type === 'system' && sdkMsg.subtype === 'init') {
          // Only update session IDs if we're still on the same session (or first init)
          const curSid = useChatStore.getState().sessionId;
          if (!shouldDropSessionMessage(curSid, data.sessionId)) {
            setSessionId(data.sessionId);
            setClaudeSessionId(sdkMsg.session_id);
          } else {
            // Stale init from a different session — ignore entirely
            return;
          }

          // Convert SDK string[] to SlashCommandInfo[] and merge with /api/commands
          const sdkCmds: SlashCommandInfo[] = (sdkMsg.slash_commands || []).map((cmd: string) => ({
            name: cmd,
            description: '',
            source: 'sdk' as const,
          }));

          // Fetch descriptions from /api/commands and merge
          const tk = localStorage.getItem('token');
          const hdrs: Record<string, string> = {};
          if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
          fetch('/api/commands', { headers: hdrs })
            .then((r) => r.ok ? r.json() : [])
            .then((serverCmds: Array<{ name: string; description: string; source: string }>) => {
              const cmdMap = new Map(serverCmds.map((c) => [c.name, c]));
              const merged: SlashCommandInfo[] = sdkCmds.map((cmd) => {
                const match = cmdMap.get(`/${cmd.name}`) || cmdMap.get(cmd.name);
                if (match) {
                  cmdMap.delete(match.name);
                  return { ...cmd, description: match.description, source: match.source === 'commands' ? 'commands' as const : 'sdk' as const };
                }
                return cmd;
              });
              // Add any commands-only entries not in SDK list
              for (const [, cmd] of cmdMap) {
                merged.push({ name: cmd.name.replace(/^\//, ''), description: cmd.description, source: 'commands' });
              }
              setSystemInfo({ slashCommands: merged, tools: sdkMsg.tools, model: sdkMsg.model });
            })
            .catch(() => {
              setSystemInfo({ slashCommands: sdkCmds, tools: sdkMsg.tools, model: sdkMsg.model });
            });
          return;
        }

        // User message (tool_result from SDK) — attach result to the matching tool_use
        if (sdkMsg.type === 'user') {
          const content = sdkMsg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_result' && block.tool_use_id) {
                const resultText = typeof block.content === 'string'
                  ? block.content
                  : Array.isArray(block.content)
                    ? block.content.map((c: any) => c.text || '').join('\n')
                    : JSON.stringify(block.content);
                // Also check structured tool_use_result at top level
                const structured = sdkMsg.tool_use_result;
                const finalResult = structured?.stdout || structured?.stderr
                  ? [structured.stdout, structured.stderr].filter(Boolean).join('\n')
                  : resultText;
                useChatStore.getState().attachToolResult(block.tool_use_id, finalResult);
              }
            }
          }
          return;
        }

        // Rate limit event — nested under rate_limit_info
        if (sdkMsg.type === 'rate_limit_event') {
          const info = sdkMsg.rate_limit_info;
          if (info && info.status !== 'allowed') {
            useChatStore.getState().setRateLimit({
              status: info.status,
              resetsAt: info.resetsAt,
              type: info.rateLimitType,
            });
          }
          return;
        }

        // Assistant message — each new UUID gets its own message bubble
        if (sdkMsg.type === 'assistant') {
          const parsed = parseSDKMessage(sdkMsg);
          const msgId = sdkMsg.uuid || crypto.randomUUID();

          // Reset ref if session changed since last assistant message
          if (shouldResetAssistantRef(currentAssistantSessionRef.current, data.sessionId)) {
            currentAssistantMsg.current = null;
          }
          currentAssistantSessionRef.current = data.sessionId;

          if (!currentAssistantMsg.current || currentAssistantMsg.current.id !== msgId) {
            // New assistant message (new turn or new UUID)
            const msg: ChatMessage = {
              id: msgId,
              role: 'assistant',
              content: parsed,
              timestamp: Date.now(),
              parentToolUseId: sdkMsg.parent_tool_use_id,
            };
            currentAssistantMsg.current = msg;
            addMessage(msg);
          } else {
            // Same message updated (streaming increments)
            currentAssistantMsg.current = {
              ...currentAssistantMsg.current,
              content: parsed,
            };
            useChatStore.getState().updateAssistantById(currentAssistantMsg.current.id, parsed);
          }
          return;
        }

        // Result
        if (sdkMsg.type === 'result') {
          setCost({
            totalCost: sdkMsg.total_cost_usd,
            inputTokens: sdkMsg.usage?.input_tokens || 0,
            outputTokens: sdkMsg.usage?.output_tokens || 0,
            cacheCreationTokens: sdkMsg.usage?.cache_creation_input_tokens,
            cacheReadTokens: sdkMsg.usage?.cache_read_input_tokens,
            duration: sdkMsg.duration_ms,
          });
          return;
        }
        break;
      }

      case 'sdk_done': {
        // Ignore done signals for sessions we're not currently viewing
        const _doneSid = useChatStore.getState().sessionId;
        if (shouldDropSessionMessage(_doneSid, data.sessionId)) return;

        setStreaming(false);
        currentAssistantMsg.current = null;
        const activeId = useSessionStore.getState().activeSessionId;
        if (data.claudeSessionId) {
          setClaudeSessionId(data.claudeSessionId);
          // Persist claudeSessionId to DB for session resume
          if (activeId) {
            const tk = localStorage.getItem('token');
            const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
            if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
            fetch(`/api/sessions/${activeId}`, {
              method: 'PATCH',
              headers: hdrs,
              body: JSON.stringify({ claudeSessionId: data.claudeSessionId }),
            }).catch((err) => { console.warn('[chat] persist claudeSessionId failed:', err); });
            useSessionStore.getState().updateSessionMeta(activeId, { claudeSessionId: data.claudeSessionId });
          }
        }

        // Auto-name: trigger if session name looks like default (date format)
        if (activeId) {
          const session = useSessionStore.getState().sessions.find((s) => s.id === activeId);
          const isDefaultName = session?.name?.startsWith('세션 ');
          const msgs = useChatStore.getState().messages;
          const hasUserMsg = msgs.some((m) => m.role === 'user');
          const hasAssistantMsg = msgs.some((m) => m.role === 'assistant');
          if (isDefaultName && hasUserMsg && hasAssistantMsg) {
            const tk = localStorage.getItem('token');
            const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
            if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
            fetch(`/api/sessions/${activeId}/auto-name`, {
              method: 'POST',
              headers: hdrs,
            })
              .then((r) => r.ok ? r.json() : null)
              .then((result) => {
                if (result?.name) {
                  useSessionStore.getState().updateSessionMeta(activeId, { name: result.name });
                }
              })
              .catch((err) => { console.warn('[chat] auto-name failed:', err); });
          }
        }
        break;
      }

      case 'file_tree': {
        // If we already have a tree and this is a subdirectory fetch, set as children
        const currentTree = useFileStore.getState().tree;
        if (currentTree.length > 0 && data.path) {
          // Check if this path is one of the directories in the existing tree (recursive)
          const findInTree = (entries: any[], p: string): boolean => {
            for (const e of entries) {
              if (e.path === p && e.isDirectory) return true;
              if (e.children && findInTree(e.children, p)) return true;
            }
            return false;
          };
          if (findInTree(currentTree, data.path)) {
            setDirectoryChildren(data.path, data.entries);
            break;
          }
        }
        setTree(data.entries);
        break;
      }

      case 'file_content':
        useFileStore.getState().setOpenFile({
          path: data.path,
          content: data.content,
          language: data.language,
          modified: false,
        });
        break;

      case 'file_saved': {
        toastSuccess(`${data.path.split('/').pop()} 저장됨`);
        const fs = useFileStore.getState();
        if (fs.openFile && fs.openFile.path === data.path) {
          fs.markSaved();
        }
        break;
      }

      case 'file_changed': {
        handleFileChange(data.event, data.path);
        const fState = useFileStore.getState();
        if (fState.openFile && fState.openFile.path === data.path && data.event === 'change') {
          if (!fState.openFile.modified) {
            // No local edits — auto-reload with debounce
            if (fileChangeDebounce) clearTimeout(fileChangeDebounce);
            fileChangeDebounce = setTimeout(() => {
              // Re-check state after debounce
              const cur = useFileStore.getState();
              if (cur.openFile && cur.openFile.path === data.path && !cur.openFile.modified) {
                sendRef.current({ type: 'file_read', path: data.path });
              }
            }, 500);
          } else {
            // Local edits exist — show conflict banner
            fState.setExternalChange({ path: data.path, detectedAt: Date.now() });
          }
        }
        break;
      }

      case 'git_commit': {
        if (data.commit) {
          useGitStore.getState().addCommit(data.commit);
          toastSuccess(`스냅샷: ${data.commit.shortHash} (${data.commit.authorName})`);
        }
        break;
      }

      case 'ask_user': {
        const curSid = useChatStore.getState().sessionId;
        if (shouldDropSessionMessage(curSid, data.sessionId)) return;
        useChatStore.getState().setPendingQuestion({
          questionId: data.questionId,
          sessionId: data.sessionId,
          questions: data.questions,
        });
        break;
      }

      case 'ask_user_timeout': {
        const pq = useChatStore.getState().pendingQuestion;
        if (pq && pq.questionId === data.questionId) {
          useChatStore.getState().setPendingQuestion(null);
          toastWarning('응답 시간 초과 — 기본 옵션이 자동 선택되었습니다');
        }
        break;
      }

      case 'error': {
        // Ignore session-specific errors for sessions we're not viewing
        const _errSid = useChatStore.getState().sessionId;
        if (shouldDropSessionMessage(_errSid, data.sessionId)) return;

        setStreaming(false);
        currentAssistantMsg.current = null;
        if (data.errorCode === 'SESSION_LIMIT') {
          toastError('동시 세션 한도 초과');
          addMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: [{ type: 'text', text: `세션 한도 초과: ${data.message}. 다른 세션이 완료될 때까지 기다려주세요.` }],
            timestamp: Date.now(),
          });
        } else if (data.errorCode === 'SDK_HANG') {
          toastError('SDK 응답 시간 초과');
          addMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: [{ type: 'text', text: data.message }],
            timestamp: Date.now(),
          });
        } else {
          toastError(data.message || 'Unknown error');
          addMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: [{ type: 'text', text: `오류: ${data.message}` }],
            timestamp: Date.now(),
          });
        }
        break;
      }
    }
  }, [addMessage, setStreaming, setSessionId, setClaudeSessionId, setSystemInfo, setCost, setTree, setDirectoryChildren, handleFileChange]);

  // Reconnect handler — send session context to backend for stream re-attachment
  const handleReconnect = useCallback(() => {
    const { sessionId: sid, claudeSessionId: csid } = useChatStore.getState();
    if (sid) {
      // Delay slightly to ensure 'connected' message is processed first
      setTimeout(() => {
        sendRef.current({
          type: 'reconnect',
          sessionId: sid,
          claudeSessionId: csid,
        });
      }, 50);
    }
  }, []);

  const { send, connected, safetyTimerFired } = useWebSocket(wsUrl, handleMessage, handleReconnect);
  sendRef.current = send;

  const sendMessage = useCallback(
    (message: string, cwd?: string) => {
      const messageId = crypto.randomUUID();
      // Add user message locally
      addMessage({
        id: messageId,
        role: 'user',
        content: [{ type: 'text', text: message }],
        timestamp: Date.now(),
      });

      setStreaming(true);
      currentAssistantMsg.current = null;

      send({
        type: 'chat',
        message,
        messageId,
        sessionId: useChatStore.getState().sessionId,
        claudeSessionId: useChatStore.getState().claudeSessionId,
        cwd,
        model: useModelStore.getState().selectedModel,
      });
    },
    [send, addMessage, setStreaming]
  );

  const abort = useCallback(() => {
    send({ type: 'abort', sessionId: useChatStore.getState().sessionId });
    setStreaming(false);
  }, [send, setStreaming]);

  const setActiveSession = useCallback(
    (sessionId: string, claudeSessionId?: string | null) => {
      send({ type: 'set_active_session', sessionId, claudeSessionId: claudeSessionId || undefined });
    },
    [send]
  );

  const requestFileTree = useCallback(
    (path?: string) => {
      send({ type: 'file_tree', path });
    },
    [send]
  );

  const requestFile = useCallback(
    (path: string) => {
      send({ type: 'file_read', path });
    },
    [send]
  );

  const saveFile = useCallback(
    (path: string, content: string) => {
      send({ type: 'file_write', path, content });
    },
    [send]
  );

  const answerQuestion = useCallback(
    (questionId: string, answer: string) => {
      const sessionId = useChatStore.getState().sessionId;
      send({ type: 'answer_question', sessionId, questionId, answer });
      useChatStore.getState().setPendingQuestion(null);
    },
    [send]
  );

  return {
    sendMessage,
    abort,
    setActiveSession,
    requestFileTree,
    requestFile,
    saveFile,
    answerQuestion,
    connected,
  };
}
