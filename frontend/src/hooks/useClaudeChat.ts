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
import { useKanbanStore } from '../stores/kanban-store';

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
          durationMs: m.duration_ms || undefined,
          inputTokens: m.input_tokens || undefined,
          outputTokens: m.output_tokens || undefined,
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
      durationMs: m.duration_ms || undefined,
      inputTokens: m.input_tokens || undefined,
      outputTokens: m.output_tokens || undefined,
    }));

    const currentMsgs = useChatStore.getState().messages;
    const currentIds = new Set(currentMsgs.map((m) => m.id));

    // 스트리밍 중인 메시지 ID를 보호 목록에 추가 (DB는 UI보다 뒤처질 수 있음)
    const isStreaming = useChatStore.getState().isStreaming;
    const lastAssistantId = isStreaming
      ? currentMsgs.findLast((m) => m.role === 'assistant')?.id
      : undefined;

    // Build merged list: start with DB messages (authoritative order),
    // update content for existing ones, add missing ones
    const merged = dbMsgs.map((dbMsg) => {
      if (currentIds.has(dbMsg.id)) {
        const uiMsg = currentMsgs.find((m) => m.id === dbMsg.id)!;
        // 현재 스트리밍 중인 마지막 assistant 메시지는 UI 버전 유지 (DB가 뒤처질 수 있음)
        if (isStreaming && dbMsg.id === lastAssistantId) {
          return uiMsg;
        }
        // Keep UI version but update content from DB (DB may be more complete)
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
    setSystemInfo, setCost, sessionId, claudeSessionId, setSessionStartTime,
    setTurnStartTime,
  } = useChatStore();

  const { setTree, setDirectoryChildren, handleFileChange } = useFileStore();

  const handleMessage = useCallback((data: any) => {
    switch (data.type) {
      case 'connected': {
        const newEpoch = data.serverEpoch;
        if (serverEpochRef.current && newEpoch && serverEpochRef.current !== newEpoch) {
          // Server restarted — epoch changed
          toastWarning('Server restarted');
          useChatStore.getState().setStreaming(false);
          useChatStore.getState().setTurnStartTime(null);
          useChatStore.getState().markPendingFailed();
          useChatStore.getState().setPendingQuestion(null);
          currentAssistantMsg.current = null;
        }
        serverEpochRef.current = newEpoch || null;

        // Request file tree on (re)connect so sidebar doesn't stay empty
        // (send() silently drops messages before WS is OPEN)
        setTimeout(() => sendRef.current({ type: 'file_tree' }), 100);

        // Restore streaming indicators for all running sessions
        const runningSessions: string[] = data.streamingSessions || [];
        if (runningSessions.length > 0) {
          for (const sid of runningSessions) {
            useSessionStore.getState().setSessionStreaming(sid, true);
          }
          // If the active session is streaming, restore chat panel state
          const activeSid = useChatStore.getState().sessionId;
          if (activeSid && runningSessions.includes(activeSid)) {
            useChatStore.getState().setStreaming(true);
            if (!useChatStore.getState().turnStartTime) {
              useChatStore.getState().setTurnStartTime(Date.now());
            }
          }
        }

        // Drain orphaned queues: messages queued for sessions that are no longer streaming.
        // Delayed to ensure sessions are loaded from API and WS is fully ready.
        const runningSet = new Set(runningSessions);
        setTimeout(() => {
          const allQueues = useChatStore.getState().messageQueue;
          const activeSid2 = useChatStore.getState().sessionId;
          for (const [sid, queue] of Object.entries(allQueues)) {
            if (queue.length === 0) continue;
            // Active session queue is handled by InputBox's useEffect — skip here
            if (sid === activeSid2) continue;
            // If session is still streaming, session_status handler will drain when it finishes
            if (runningSet.has(sid)) continue;
            // Orphaned queue: session not streaming, not active → send first message
            const msg = useChatStore.getState().dequeueMessage(sid);
            if (msg) {
              const session = useSessionStore.getState().sessions.find((s) => s.id === sid);
              if (!session) {
                // Session was deleted — just clear the orphaned queue
                useChatStore.getState().clearSessionQueue(sid);
                continue;
              }
              const messageId = crypto.randomUUID();
              sendRef.current({
                type: 'chat',
                message: msg,
                messageId,
                sessionId: sid,
                claudeSessionId: session.claudeSessionId,
                model: useModelStore.getState().selectedModel,
              });
              useSessionStore.getState().setSessionStreaming(sid, true);
            }
          }
        }, 3000);
        break;
      }

      case 'reconnect_result': {
        if (data.status === 'streaming') {
          useChatStore.getState().setStreaming(true);
          // Restore live timer — use server timestamp if available, else now
          if (!useChatStore.getState().turnStartTime) {
            useChatStore.getState().setTurnStartTime(Date.now());
          }
          safetyTimerFired.current = false;
          // Merge DB messages to fill any gap from disconnection
          if (data.sessionId) {
            mergeMessagesFromDb(data.sessionId);
          }
          // Restore pending question if backend has one
          if (data.pendingQuestion) {
            useChatStore.getState().setPendingQuestion({
              questionId: data.pendingQuestion.questionId,
              sessionId: data.sessionId,
              questions: data.pendingQuestion.questions,
            });
          }
          toastSuccess('Stream reconnected');
        } else {
          // status === 'idle'
          // Check wasStreaming OR safetyTimerFired (timer may have cleared isStreaming before reconnect)
          const wasStreaming = useChatStore.getState().isStreaming || safetyTimerFired.current;
          useChatStore.getState().setStreaming(false);
          useChatStore.getState().setTurnStartTime(null);
          safetyTimerFired.current = false;
          currentAssistantMsg.current = null;
          if (wasStreaming && data.sessionId) {
            // Was streaming but SDK finished while disconnected — recover from DB
            recoverMessagesFromDb(data.sessionId);
            toastSuccess('Response recovered');
          }
        }
        break;
      }

      case 'set_active_session_ack': {
        // When switching TO a session that has active streaming, restore streaming state
        if (data.isStreaming) {
          useChatStore.getState().setStreaming(true);
          if (!useChatStore.getState().turnStartTime) {
            useChatStore.getState().setTurnStartTime(Date.now());
          }
          currentAssistantMsg.current = null;
          if (data.sessionId) {
            mergeMessagesFromDb(data.sessionId);
          }
        } else {
          // Switching to a non-streaming session — reset streaming state
          // so InputBox doesn't show queue mode / stop button for this session.
          // Guard: only reset if we haven't already started streaming from a queue drain.
          // The ack reflects server state at request time which may be stale — our local
          // state (from messages sent after the request) takes precedence.
          if (!useChatStore.getState().isStreaming) {
            useChatStore.getState().setTurnStartTime(null);
          }
        }
        // Restore pending question if backend has one
        if (data.pendingQuestion) {
          useChatStore.getState().setPendingQuestion({
            questionId: data.pendingQuestion.questionId,
            sessionId: data.sessionId,
            questions: data.pendingQuestion.questions,
          });
        }
        break;
      }

      case 'session_status': {
        // Update sidebar streaming indicators
        if (data.sessionId) {
          useSessionStore.getState().setSessionStreaming(data.sessionId, data.status === 'streaming');
          // Bump updatedAt so sidebar re-sorts (covers background sessions too)
          useSessionStore.getState().updateSessionMeta(data.sessionId, {});

          // Auto-send queued messages for BACKGROUND sessions that finish streaming.
          // Active session queue is handled by InputBox's useEffect.
          const currentSid = useChatStore.getState().sessionId;
          if (data.status !== 'streaming' && data.sessionId !== currentSid) {
            const queue = useChatStore.getState().messageQueue[data.sessionId];
            if (queue && queue.length > 0) {
              const msg = useChatStore.getState().dequeueMessage(data.sessionId);
              if (msg) {
                const session = useSessionStore.getState().sessions.find((s) => s.id === data.sessionId);
                const messageId = crypto.randomUUID();
                sendRef.current({
                  type: 'chat',
                  message: msg,
                  messageId,
                  sessionId: data.sessionId,
                  claudeSessionId: session?.claudeSessionId,
                  model: useModelStore.getState().selectedModel,
                });
                // Re-mark as streaming since we just sent a new message
                useSessionStore.getState().setSessionStreaming(data.sessionId, true);
              }
            }
          }
        }
        break;
      }

      case 'sdk_message': {
        // Ignore messages for sessions we're not currently viewing
        const _currentSid = useChatStore.getState().sessionId;
        if (shouldDropSessionMessage(_currentSid, data.sessionId)) return;

        // First sdk_message confirms the backend received our chat — mark pending messages as delivered
        useChatStore.getState().markPendingDelivered();

        const sdkMsg = data.data;

        // System init — may repeat each turn, only update info without resetting
        if (sdkMsg.type === 'system' && sdkMsg.subtype === 'init') {
          // Only update session IDs if we're still on the same session (or first init)
          const curSid = useChatStore.getState().sessionId;
          if (!shouldDropSessionMessage(curSid, data.sessionId)) {
            setSessionId(data.sessionId);
            setClaudeSessionId(sdkMsg.session_id);
            // Start session timer if not already set
            if (!useChatStore.getState().sessionStartTime) {
              setSessionStartTime(Date.now());
            }
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

        // Autocompact: compact_boundary fires right before compaction starts
        if (sdkMsg.type === 'system' && sdkMsg.subtype === 'compact_boundary') {
          useChatStore.getState().setCompacting(useChatStore.getState().sessionId);
          return;
        }

        // Autocompact: status message — 'compacting' | null
        if (sdkMsg.type === 'system' && sdkMsg.subtype === 'status') {
          const sid = useChatStore.getState().sessionId;
          useChatStore.getState().setCompacting(sdkMsg.status === 'compacting' ? sid : null);
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
            // Check if this message already exists (e.g., loaded from DB after page reload)
            const existingMsg = useChatStore.getState().messages.find((m) => m.id === msgId);
            if (existingMsg) {
              // Resume updating the existing message — don't create a duplicate
              currentAssistantMsg.current = { ...existingMsg, content: parsed };
              useChatStore.getState().updateAssistantById(msgId, parsed);
            } else {
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
            }
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
          const turnMetrics = {
            inputTokens: sdkMsg.usage?.input_tokens || 0,
            outputTokens: sdkMsg.usage?.output_tokens || 0,
            durationMs: sdkMsg.duration_ms || 0,
          };
          useChatStore.getState().setLastTurnMetrics(turnMetrics);
          // Persist metrics onto the current assistant message for per-message display
          if (currentAssistantMsg.current) {
            useChatStore.getState().updateMessageMetrics(currentAssistantMsg.current.id, turnMetrics);
          }
          return;
        }
        break;
      }

      case 'sdk_done': {
        // Always sync claudeSessionId to session store — even for background sessions.
        // Without this, switching away during streaming → sdk_done is dropped →
        // session store keeps stale claudeSessionId → resume fails on return.
        if (data.claudeSessionId && data.sessionId) {
          useSessionStore.getState().updateSessionMeta(data.sessionId, { claudeSessionId: data.claudeSessionId });
        }

        // Ignore done signals for sessions we're not currently viewing
        const _doneSid = useChatStore.getState().sessionId;
        if (shouldDropSessionMessage(_doneSid, data.sessionId)) return;

        setStreaming(false);
        setTurnStartTime(null);
        useChatStore.getState().setCompacting(null);
        useChatStore.getState().setPendingQuestion(null);
        currentAssistantMsg.current = null;
        const activeId = useSessionStore.getState().activeSessionId;
        if (data.claudeSessionId) {
          setClaudeSessionId(data.claudeSessionId);
        }

        // Auto-name: trigger if session name looks like default (date format)
        if (activeId) {
          const session = useSessionStore.getState().sessions.find((s) => s.id === activeId);
          const isDefaultName = session?.name?.startsWith('Session ');
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
            // Recursively re-expand children that were previously expanded
            const { expandedPaths: ep } = useFileStore.getState();
            for (const child of data.entries as any[]) {
              if (child.isDirectory && ep.has(child.path)) {
                send({ type: 'file_tree', path: child.path });
              }
            }
            break;
          }
        }
        setTree(data.entries);
        if (data.path) {
          useFileStore.getState().setTreeRoot(data.path);
        }
        // Auto-expand previously expanded directories:
        // setTree restores isExpanded flags; now fetch children for those
        const { expandedPaths } = useFileStore.getState();
        const expandedInThisLevel = (data.entries as any[])
          .filter((e: any) => e.isDirectory && expandedPaths.has(e.path))
          .map((e: any) => e.path);
        for (const dirPath of expandedInThisLevel) {
          send({ type: 'file_tree', path: dirPath });
        }
        break;
      }

      case 'file_content':
        useFileStore.getState().setOpenFile({
          path: data.path,
          content: data.content,
          language: data.language,
          modified: false,
          ...(data.encoding && { encoding: data.encoding }),
        });
        if (useSessionStore.getState().isMobile) {
          useSessionStore.getState().openMobileContext();
        }
        break;

      case 'file_saved': {
        toastSuccess(`${data.path.split('/').pop()} saved`);
        const fs = useFileStore.getState();
        if (fs.openFile && fs.openFile.path === data.path) {
          fs.markSaved();
        }
        break;
      }

      case 'file_changed': {
        handleFileChange(data.event, data.path);
        // Refresh parent directory tree for add/addDir so new files appear,
        // but ONLY if the parent directory is currently visible in the user's file tree.
        // Skipping invisible dirs prevents the sidebar from navigating away
        // (e.g. resetting to workspace root and showing .gitignore) when Claude
        // creates files outside the user's current view.
        if (data.event === 'add' || data.event === 'addDir') {
          const parentDir = data.path.substring(0, data.path.lastIndexOf('/'));
          if (parentDir) {
            const { tree, treeRoot } = useFileStore.getState();
            const findInTree = (entries: typeof tree, p: string): boolean => {
              for (const e of entries) {
                if (e.path === p && e.isDirectory) return true;
                if (e.children && findInTree(e.children, p)) return true;
              }
              return false;
            };
            // Send refresh only when the parent dir is currently shown in the sidebar
            const isVisible = parentDir === treeRoot || (tree.length > 0 && findInTree(tree, parentDir));
            if (isVisible) {
              sendRef.current({ type: 'file_tree', path: parentDir });
            }
          }
        }
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
          // Silently add the commit to the version-history panel.
          // We intentionally do NOT show a toast here: auto-snapshots are
          // background bookkeeping and the notification was distracting users
          // by drawing attention (and keyboard focus) to the git panel.
          useGitStore.getState().addCommit(data.commit);
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
          toastWarning('Response timed out — default option was auto-selected');
        }
        break;
      }

      case 'error': {
        // Ignore session-specific errors for sessions we're not viewing
        const _errSid = useChatStore.getState().sessionId;
        if (shouldDropSessionMessage(_errSid, data.sessionId)) return;

        // SESSION_BUSY = backend still running → keep isStreaming true, notify user
        if (data.errorCode === 'SESSION_BUSY') {
          console.warn('[chat] SESSION_BUSY — message will be auto-sent when current turn finishes');
          toastWarning('Message queued — waiting for current response');
          // Re-queue: broadcast a custom event so InputBox can re-queue the message
          window.dispatchEvent(new CustomEvent('session-busy-requeue'));
          break;
        }

        setStreaming(false);
        useChatStore.getState().setCompacting(null);
        currentAssistantMsg.current = null;
        if (data.errorCode === 'SESSION_LIMIT') {
          toastError('Concurrent session limit exceeded');
          addMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: [{ type: 'text', text: `Session limit exceeded: ${data.message}. Please wait for another session to finish.` }],
            timestamp: Date.now(),
          });
        } else if (data.errorCode === 'SDK_HANG') {
          toastError('SDK response timed out');
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
            content: [{ type: 'text', text: `Error: ${data.message}` }],
            timestamp: Date.now(),
          });
        }
        break;
      }

      case 'resume_failed': {
        // SDK resume failed — show a warning so user knows context was lost
        const _rfSid = useChatStore.getState().sessionId;
        if (!shouldDropSessionMessage(_rfSid, data.sessionId)) {
          toastWarning(data.message || 'Previous conversation context could not be restored.');
          addMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: [{ type: 'text', text: `⚠️ ${data.message || 'Previous conversation context could not be restored. Starting fresh.'}` }],
            timestamp: Date.now(),
          });
        }
        break;
      }

      case 'task_sdk_message': {
        // Route kanban task SDK messages to the chat panel if viewing that session
        const currentSid = useChatStore.getState().sessionId;
        if (data.sessionId && currentSid === data.sessionId && data.sdkMessage) {
          // Re-dispatch as a regular sdk_message so existing rendering pipeline handles it
          handleMessage({ type: 'sdk_message', sessionId: data.sessionId, data: data.sdkMessage });
        }
        break;
      }

      case 'task_update': {
        const { taskId, status, sessionId: taskSessionId, progressSummary, session: taskSession, claudeSessionId: taskClaudeSessionId } = data;
        useKanbanStore.getState().updateTask(taskId, {
          ...(status && { status }),
          ...(taskSessionId && { sessionId: taskSessionId }),
          ...(progressSummary && { progressSummary }),
        });
        // Add task's session to session store so card click → chat navigation works
        if (taskSession && taskSessionId) {
          const existing = useSessionStore.getState().sessions.find((s) => s.id === taskSessionId);
          if (!existing) {
            useSessionStore.getState().addSession(taskSession);
          }
        }
        // Sync claudeSessionId to session store so resume works when clicking the session
        if (taskClaudeSessionId && taskSessionId) {
          useSessionStore.getState().updateSessionMeta(taskSessionId, { claudeSessionId: taskClaudeSessionId });
        }
        break;
      }

      // Backend broadcasts session metadata changes (e.g., claudeSessionId from task runner)
      case 'session_meta_update': {
        const { sessionId: metaSid, updates: metaUpdates } = data;
        if (metaSid && metaUpdates) {
          useSessionStore.getState().updateSessionMeta(metaSid, metaUpdates);
        }
        break;
      }

      case 'task_list': {
        useKanbanStore.getState().setTasks(data.tasks || []);
        break;
      }
    }
  }, [addMessage, setStreaming, setSessionId, setClaudeSessionId, setSystemInfo, setCost, setSessionStartTime, setTurnStartTime, setTree, setDirectoryChildren, handleFileChange]);

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

  const { send, connected, ws: wsRef2, safetyTimerFired } = useWebSocket(wsUrl, handleMessage, handleReconnect);
  sendRef.current = send;

  // Expose WS reference globally for KanbanBoard to send task_spawn/abort messages
  if (wsRef2.current) {
    (window as any).__claudeWs = wsRef2.current;
  }

  const sendMessage = useCallback(
    (message: string, cwd?: string) => {
      const messageId = crypto.randomUUID();
      // Add user message locally with pending status
      addMessage({
        id: messageId,
        role: 'user',
        content: [{ type: 'text', text: message }],
        timestamp: Date.now(),
        sendStatus: 'pending',
      });

      setStreaming(true);
      setTurnStartTime(Date.now());
      useChatStore.getState().setLastTurnMetrics(null);
      currentAssistantMsg.current = null;

      // Bump updatedAt so the session moves to top of sidebar immediately
      const activeSid = useChatStore.getState().sessionId;
      if (activeSid) {
        useSessionStore.getState().updateSessionMeta(activeSid, {});
      }

      send({
        type: 'chat',
        message,
        messageId,
        sessionId: activeSid,
        claudeSessionId: useChatStore.getState().claudeSessionId,
        cwd,
        model: useModelStore.getState().selectedModel,
      });
    },
    [send, addMessage, setStreaming, setTurnStartTime]
  );

  const abort = useCallback(() => {
    send({ type: 'abort', sessionId: useChatStore.getState().sessionId });
    setStreaming(false);
    setTurnStartTime(null);
    useChatStore.getState().setCompacting(null);
    useChatStore.getState().setPendingQuestion(null);
  }, [send, setStreaming, setTurnStartTime]);

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
