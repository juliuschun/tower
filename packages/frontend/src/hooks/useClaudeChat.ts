import { useCallback, useRef } from 'react';
import { useWebSocket } from './useWebSocket';
import { useChatStore, type ChatMessage, type SlashCommandInfo } from '../stores/chat-store';
import { useFileStore } from '../stores/file-store';
import { useSessionStore } from '../stores/session-store';
import { useModelStore, getModelIdForBackend } from '../stores/model-store';
import { useGitStore } from '../stores/git-store';
import { parseSDKMessage } from '../utils/message-parser';
import { shouldDropSessionMessage, shouldResetAssistantRef, resolveAutoNameTarget, resolveSendSessionId, isServerRestarted } from '../utils/session-filters';
import { normalizePendingQuestion } from '../utils/pending-question';
import { generateUUID } from '../utils/uuid';
import { toastSuccess, toastError, toastWarning, toastInfo } from '../utils/toast';
import { notifyTaskComplete, requestNotificationPermission } from '../utils/notify';
import { useKanbanStore } from '../stores/kanban-store';
import { useRoomStore } from '../stores/room-store';

/** Debounce timer for auto-reload of externally changed files */
let fileChangeDebounce: ReturnType<typeof setTimeout> | null = null;

/** Get session owner username from session store */
function getSessionOwnerUsername(sessionId: string): string | undefined {
  const sessions = useSessionStore.getState().sessions;
  const session = sessions.find((s) => s.id === sessionId);
  return session?.ownerUsername || localStorage.getItem('username') || undefined;
}

/** Default page size for initial message load */
const MESSAGE_PAGE_SIZE = 500;

/** Map raw DB message to ChatMessage — no normalize here; ChatPanel normalizes lazily */
function mapStoredToChat(m: any, ownerUsername?: string): import('../stores/chat-store').ChatMessage {
  const storedUsername = typeof m.username === 'string' && m.username.trim()
    ? m.username.trim()
    : undefined;

  return {
    id: m.id,
    role: m.role,
    content: typeof m.content === 'string' ? JSON.parse(m.content) : m.content,
    timestamp: new Date(m.created_at).getTime(),
    username: m.role === 'user' ? (storedUsername || ownerUsername) : undefined,
    parentToolUseId: m.parent_tool_use_id,
    durationMs: m.duration_ms || undefined,
    inputTokens: m.input_tokens || undefined,
    outputTokens: m.output_tokens || undefined,
    stopReason: m.stop_reason || undefined,
  };
}

/** Recover messages from DB for the active session (paginated — most recent N) */
export async function __test_recoverMessagesFromDb(sessionId: string) {
  try {
    const tk = localStorage.getItem('token');
    const hdrs: Record<string, string> = {};
    if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
    const res = await fetch(`/api/sessions/${sessionId}/messages?limit=${MESSAGE_PAGE_SIZE}`, { headers: hdrs });
    if (res.ok) {
      const data = await res.json();
      const stored = data.messages ?? data; // backward compat: if backend returns flat array
      const hasMore = data.hasMore ?? false;
      const oldestId = data.oldestId ?? null;
      const store = useChatStore.getState();
      if (stored.length > 0) {
        const ownerUsername = getSessionOwnerUsername(sessionId);
        const msgs = stored.map((m: any) => mapStoredToChat(m, ownerUsername));
        store.setMessages(msgs);
      }
      store.setHasMoreMessages(hasMore);
      store.setOldestMessageId(oldestId);
    }
  } catch (err) {
    console.warn('[recoverMessagesFromDb] failed:', err);
  }
}

/** Load older messages (prepend to existing) */
async function loadMoreMessages(sessionId: string): Promise<void> {
  const store = useChatStore.getState();
  if (store.loadingMoreMessages || !store.hasMoreMessages || !store.oldestMessageId) return;

  store.setLoadingMoreMessages(true);
  try {
    const tk = localStorage.getItem('token');
    const hdrs: Record<string, string> = {};
    if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
    const res = await fetch(
      `/api/sessions/${sessionId}/messages?limit=${MESSAGE_PAGE_SIZE}&before=${store.oldestMessageId}`,
      { headers: hdrs }
    );
    if (res.ok) {
      const data = await res.json();
      const stored = data.messages ?? [];
      if (stored.length > 0) {
        const ownerUsername = getSessionOwnerUsername(sessionId);
        const older = stored.map((m: any) => mapStoredToChat(m, ownerUsername));
        store.prependMessages(older);
        store.setOldestMessageId(data.oldestId ?? null);
      }
      store.setHasMoreMessages(data.hasMore ?? false);
    }
  } catch (err) {
    console.warn('[loadMoreMessages] failed:', err);
  } finally {
    useChatStore.getState().setLoadingMoreMessages(false);
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

    const ownerUsername = getSessionOwnerUsername(sessionId);
    const dbMsgs: ChatMessage[] = stored.map((m: any) => mapStoredToChat(m, ownerUsername));

    const currentMsgs = useChatStore.getState().messages;
    const currentIds = new Set(currentMsgs.map((m) => m.id));

    // 스트리밍 중인 메시지 ID를 보호 목록에 추가 (DB는 UI보다 뒤처질 수 있음)
    const isStreaming = useChatStore.getState().isStreaming;
    const lastAssistantId = isStreaming
      ? currentMsgs.findLast((m) => m.role === 'assistant')?.id
      : undefined;

    // Build merged list: start with DB messages (authoritative order),
    // update content for existing ones, add missing ones
    const merged: ChatMessage[] = dbMsgs.map((dbMsg: ChatMessage) => {
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
  const lastConnectTs = useRef<number>(0);

  const {
    addMessage, setStreaming, setSessionId, setClaudeSessionId,
    setSystemInfo, setCost, setSessionStartTime,
    setTurnStartTime,
  } = useChatStore();

  const { setTree, setDirectoryChildren, handleFileChange } = useFileStore();

  const handleMessage = useCallback((data: any) => {
    switch (data.type) {
      case 'connected': {
        // Request browser notification permission on first connect
        requestNotificationPermission();
        const newEpoch = data.serverEpoch;
        if (isServerRestarted(serverEpochRef.current, newEpoch)) {
          // Server restarted — epoch changed
          toastWarning('Server restarted');
          useChatStore.getState().setStreaming(false);
          useChatStore.getState().setTurnStartTime(null);
          useChatStore.getState().markPendingFailed();
          useChatStore.getState().setPendingQuestion(null);
          currentAssistantMsg.current = null;
          // Clean up orphaned @ai streaming placeholders from all rooms
          const roomStore = useRoomStore.getState();
          for (const [roomId, msgs] of Object.entries(roomStore.messagesByRoom)) {
            for (const msg of msgs) {
              if (msg.id.startsWith('ai-reply-') && (msg.metadata as any)?.streaming) {
                roomStore.removeMessage(roomId, msg.id);
              }
            }
          }
        }
        serverEpochRef.current = newEpoch || null;

        // Debounce reconnect data fetches — skip if reconnected within 10s
        // (prevents flicker from rapid WS reconnects on mobile)
        const now = Date.now();
        const timeSinceLastConnect = now - lastConnectTs.current;
        const shouldRefreshData = lastConnectTs.current === 0 || timeSinceLastConnect > 10_000;
        lastConnectTs.current = now;

        if (shouldRefreshData) {
          // Request file tree on (re)connect so sidebar doesn't stay empty
          // (send() silently drops messages before WS is OPEN)
          setTimeout(() => sendRef.current({ type: 'file_tree', showHidden: useFileStore.getState().showHidden }), 100);

          // Refresh kanban tasks on (re)connect — task_update messages may have
          // been missed during a brief disconnection (mobile bg, Cloudflare, etc.)
          setTimeout(() => sendRef.current({ type: 'task_list' }), 150);

          // Fetch rooms on connect
          setTimeout(() => {
            const tk = localStorage.getItem('token');
            const hdrs: Record<string, string> = {};
            if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
            fetch('/api/rooms', { headers: hdrs })
              .then(r => r.ok ? r.json() : { rooms: [], pgEnabled: false })
              .then(roomData => {
                useRoomStore.getState().setRooms(roomData.rooms || []);
                useRoomStore.getState().setPgEnabled(roomData.pgEnabled ?? false);
              })
              .catch(() => {});
          }, 200);
        }

        // Restore streaming indicators for all running sessions
        const runningSessions: string[] = data.streamingSessions || [];
        const runningSetForSync = new Set(runningSessions);
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

        // Sync: clear streaming for sessions the frontend thinks are active but the server says aren't.
        // This prevents stuck queues when a turn finishes while the client was disconnected.
        const frontendStreamingSessions = useSessionStore.getState().streamingSessions;
        for (const sid of frontendStreamingSessions) {
          if (!runningSetForSync.has(sid)) {
            console.log(`[chat] reconnect sync: clearing stale streaming for session ${sid.slice(0, 8)}`);
            useSessionStore.getState().setSessionStreaming(sid, false);
            // If this is the active session, also clear chat-store streaming
            const currentSid = useChatStore.getState().sessionId;
            if (sid === currentSid) {
              useChatStore.getState().setStreaming(false);
              useChatStore.getState().setTurnStartTime(null);
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
              const messageId = generateUUID();
              sendRef.current({
                type: 'chat',
                message: msg,
                messageId,
                sessionId: sid,
                claudeSessionId: session.claudeSessionId,
                cwd: session.cwd,
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
          const restoredPendingQuestion = normalizePendingQuestion({
            questionId: data.pendingQuestion?.questionId,
            sessionId: data.sessionId,
            questions: data.pendingQuestion?.questions,
          });
          useChatStore.getState().setPendingQuestion(restoredPendingQuestion);
          // Stream silently re-attached — no toast distraction
        } else if (data.status === 'interrupted') {
          // Server restarted while this session was streaming — auto-resume
          useChatStore.getState().setStreaming(false);
          useChatStore.getState().setTurnStartTime(null);
          safetyTimerFired.current = false;
          currentAssistantMsg.current = null;

          if (data.sessionId) {
            // Recover partial messages from DB first
            __test_recoverMessagesFromDb(data.sessionId);

            // Update claudeSessionId for resume
            if (data.claudeSessionId) {
              useChatStore.getState().setClaudeSessionId(data.claudeSessionId);
              // Also update session store so resume works
              useSessionStore.getState().updateSessionMeta(data.sessionId, {
                claudeSessionId: data.claudeSessionId,
              });
            }

            toastWarning('Server restarted — resuming conversation...');

            // Auto-resume: send a continue message with resume context
            // Loop prevention is handled server-side (uptime < 30s → no interrupted file written)
            const session = useSessionStore.getState().sessions.find(s => s.id === data.sessionId);
            setTimeout(() => {
              const messageId = generateUUID();
              sendRef.current({
                type: 'chat',
                message: 'The server was just restarted. Your previous task was interrupted mid-stream. If you were running a server restart, deployment, or build command — it already completed successfully, do NOT re-run it. Review where you left off and continue with the next step.',
                messageId,
                sessionId: data.sessionId,
                claudeSessionId: data.claudeSessionId || session?.claudeSessionId,
                cwd: session?.cwd,
                model: useModelStore.getState().selectedModel,
              });
              useChatStore.getState().setStreaming(true);
              useChatStore.getState().setTurnStartTime(Date.now());
              useSessionStore.getState().setSessionStreaming(data.sessionId, true);
            }, 500);
          }
        } else {
          // status === 'idle'
          // Check wasStreaming OR safetyTimerFired (timer may have cleared isStreaming before reconnect)
          const wasStreaming = useChatStore.getState().isStreaming || safetyTimerFired.current;
          useChatStore.getState().setStreaming(false);
          useChatStore.getState().setTurnStartTime(null);
          useChatStore.getState().setPendingQuestion(null);
          safetyTimerFired.current = false;
          currentAssistantMsg.current = null;
          if (wasStreaming && data.sessionId) {
            // Was streaming but SDK finished while disconnected — recover from DB
            __test_recoverMessagesFromDb(data.sessionId);
            console.log('Response recovered');
          }

          // Auto-name retry: if session still has default name after reconnect,
          // the original sdk_done auto-name may have been missed due to disconnect.
          if (data.sessionId) {
            const msgs = useChatStore.getState().messages;
            const session = useSessionStore.getState().sessions.find((s) => s.id === data.sessionId);
            const autoNameTarget = resolveAutoNameTarget({
              doneSessionId: data.sessionId,
              activeSessionId: useSessionStore.getState().activeSessionId,
              sessionName: session?.name,
              hasUserMsg: msgs.some((m) => m.role === 'user'),
              hasAssistantMsg: msgs.some((m) => m.role === 'assistant'),
            });
            if (autoNameTarget) {
              const tk = localStorage.getItem('token');
              const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
              if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
              fetch(`/api/sessions/${autoNameTarget}/auto-name`, {
                method: 'POST',
                headers: hdrs,
              })
                .then((r) => r.ok ? r.json() : null)
                .then((result) => {
                  if (result?.name) {
                    useSessionStore.getState().updateSessionMeta(autoNameTarget, { name: result.name });
                  }
                })
                .catch((err) => { console.warn('[chat] auto-name retry on reconnect failed:', err); });
            }
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
        const restoredPendingQuestion = normalizePendingQuestion({
          questionId: data.pendingQuestion?.questionId,
          sessionId: data.sessionId,
          questions: data.pendingQuestion?.questions,
        });
        useChatStore.getState().setPendingQuestion(restoredPendingQuestion);
        break;
      }

      case 'session_status': {
        // Update sidebar streaming indicators
        if (data.sessionId) {
          const isStreamingNow = data.status === 'streaming';
          useSessionStore.getState().setSessionStreaming(data.sessionId, isStreamingNow);
          // Bump updatedAt so sidebar re-sorts (covers background sessions too)
          useSessionStore.getState().updateSessionMeta(data.sessionId, { updatedAt: new Date().toISOString() });

          // Keep the active chat panel in sync with the authoritative per-session status.
          // Without this, the sidebar can say "idle" while tool chips still think they're running
          // because chat-store.isStreaming is a global flag that may lag after session switches.
          const currentSid = useChatStore.getState().sessionId;
          if (data.sessionId === currentSid) {
            useChatStore.getState().setStreaming(isStreamingNow);
            if (isStreamingNow) {
              if (!useChatStore.getState().turnStartTime) {
                useChatStore.getState().setTurnStartTime(Date.now());
              }
            } else {
              useChatStore.getState().setTurnStartTime(null);
              const pendingQuestion = useChatStore.getState().pendingQuestion;
              if (pendingQuestion?.sessionId === data.sessionId) {
                useChatStore.getState().setPendingQuestion(null);
              }
            }
          }

          // Auto-send queued messages for BACKGROUND sessions that finish streaming.
          // Active session queue is handled by InputBox's useEffect.
          if (!isStreamingNow && data.sessionId !== currentSid) {
            const queue = useChatStore.getState().messageQueue[data.sessionId];
            if (queue && queue.length > 0) {
              const msg = useChatStore.getState().dequeueMessage(data.sessionId);
              if (msg) {
                const session = useSessionStore.getState().sessions.find((s) => s.id === data.sessionId);
                const messageId = generateUUID();
                sendRef.current({
                  type: 'chat',
                  message: msg,
                  messageId,
                  sessionId: data.sessionId,
                  claudeSessionId: session?.claudeSessionId,
                  cwd: session?.cwd,
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

      case 'session_status_check': {
        // Response to stale queue guard check — server confirms actual session status
        if (data.sessionId && data.status === 'idle') {
          console.log(`[chat] stale queue guard: server confirmed session ${data.sessionId.slice(0, 8)} is idle, clearing streaming`);
          useSessionStore.getState().setSessionStreaming(data.sessionId, false);
          const currentSid = useChatStore.getState().sessionId;
          if (data.sessionId === currentSid) {
            useChatStore.getState().setStreaming(false);
            useChatStore.getState().setTurnStartTime(null);
          }
          // Queue drain will be triggered by InputBox's useEffect reacting to isStreaming → false
        }
        break;
      }

      case 'config_update': {
        // Admin changed model config — update stores
        if (data.models) useModelStore.getState().setAvailableModels(data.models);
        if (data.piModels) useModelStore.getState().setPiModels(data.piModels);
        if (data.defaults) useModelStore.getState().setDefaults(data.defaults);
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
          const wasCompacting = useChatStore.getState().compactingSessionId !== null;
          useChatStore.getState().setCompacting(sdkMsg.status === 'compacting' ? sid : null);
          // Insert compact divider when autocompact finishes (use backend markerId for dedup)
          if (wasCompacting && sdkMsg.status !== 'compacting') {
            const markerId = sdkMsg.compactMarkerId || `compact-${Date.now()}`;
            useChatStore.getState().addMessage({
              id: markerId,
              role: 'system',
              content: [{ type: 'text', text: '✂️ Context compacted' }],
              timestamp: Date.now(),
            });
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

        // Safety net: clear compacting banner when assistant message arrives
        // (SDK may not send explicit status:null after compaction)
        if (sdkMsg.type === 'assistant' && useChatStore.getState().compactingSessionId !== null) {
          useChatStore.getState().setCompacting(null);
          // The status handler (or DB marker on next merge) handles the divider.
          // Only add a fallback marker if the last message isn't already a compact marker.
          const msgs = useChatStore.getState().messages;
          const lastMsg = msgs[msgs.length - 1];
          if (!lastMsg || !lastMsg.id.startsWith('compact-')) {
            useChatStore.getState().addMessage({
              id: `compact-${Date.now()}`,
              role: 'system',
              content: [{ type: 'text', text: '✂️ Context compacted' }],
              timestamp: Date.now(),
            });
          }
        }

        // Assistant message — each new UUID gets its own message bubble
        if (sdkMsg.type === 'assistant') {
          const parsed = parseSDKMessage(sdkMsg);
          const msgId = sdkMsg.uuid || generateUUID();

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

        // Result — usage = cumulative, context = last iteration (real context window usage)
        if (sdkMsg.type === 'result') {
          const ctx = sdkMsg.context;
          const windowSize = ctx?.window_size || 0;
          const numIter = ctx?.num_iterations || 1;
          let ctxInput = ctx?.input_tokens ?? 0;
          let ctxOutput = ctx?.output_tokens ?? 0;

          // When SDK doesn't provide per-iteration data, estimate from cumulative.
          // cumulative / numIterations ≈ last iteration's input (rough but much better than raw cumulative).
          if (ctxInput === 0 && sdkMsg.usage?.input_tokens) {
            ctxInput = Math.round((sdkMsg.usage.input_tokens + (sdkMsg.usage.cache_read_input_tokens || 0) + (sdkMsg.usage.cache_creation_input_tokens || 0)) / numIter);
            ctxOutput = Math.round((sdkMsg.usage.output_tokens || 0) / numIter);
          }
          // Safety cap: context can't exceed window size
          if (windowSize > 0 && ctxInput > windowSize) {
            ctxInput = windowSize;
          }
          setCost({
            totalCost: sdkMsg.total_cost_usd,
            inputTokens: sdkMsg.usage?.input_tokens || 0,
            outputTokens: sdkMsg.usage?.output_tokens || 0,
            cacheCreationTokens: sdkMsg.usage?.cache_creation_input_tokens,
            cacheReadTokens: sdkMsg.usage?.cache_read_input_tokens,
            duration: sdkMsg.duration_ms,
            contextInputTokens: ctxInput,
            contextOutputTokens: ctxOutput,
            contextWindowSize: windowSize,
          });
          const turnMetrics = {
            inputTokens: ctxInput,
            outputTokens: ctxOutput,
            durationMs: sdkMsg.duration_ms || 0,
            stopReason: sdkMsg.stop_reason,
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

      case 'tool_result_attached': {
        // Backend attached a tool result (e.g. Agent/subagent done) — update in-memory state
        if (data.toolUseId) {
          useChatStore.getState().attachToolResult(data.toolUseId, data.result || '');
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

        // Auto-name: trigger BEFORE the session drop check.
        // User may have switched away during streaming — sdk_done arrives for
        // a background session. We still want to name it.
        {
          const activeId = useSessionStore.getState().activeSessionId;
          const targetSessionId = data.sessionId || activeId;
          const session = targetSessionId
            ? useSessionStore.getState().sessions.find((s) => s.id === targetSessionId)
            : undefined;
          // For auto-name we don't need current messages — just check session name
          const autoNameTarget = resolveAutoNameTarget({
            doneSessionId: data.sessionId,
            activeSessionId: activeId,
            sessionName: session?.name,
            hasUserMsg: true,   // sdk_done means at least one exchange happened
            hasAssistantMsg: true,
          });
          if (autoNameTarget) {
            const tk = localStorage.getItem('token');
            const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
            if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
            fetch(`/api/sessions/${autoNameTarget}/auto-name`, {
              method: 'POST',
              headers: hdrs,
            })
              .then((r) => r.ok ? r.json() : null)
              .then((result) => {
                if (result?.name) {
                  useSessionStore.getState().updateSessionMeta(autoNameTarget, { name: result.name });
                }
              })
              .catch((err) => { console.warn('[chat] auto-name failed:', err); });
          }
        }

        // Ignore done signals for sessions we're not currently viewing
        const _doneSid = useChatStore.getState().sessionId;
        if (shouldDropSessionMessage(_doneSid, data.sessionId)) return;

        setStreaming(false);
        setTurnStartTime(null);
        useChatStore.getState().setCompacting(null);
        useChatStore.getState().setPendingQuestion(null);
        currentAssistantMsg.current = null;
        if (data.claudeSessionId) {
          setClaudeSessionId(data.claudeSessionId);
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
            const { expandedPaths: ep, showHidden: sh } = useFileStore.getState();
            for (const child of data.entries as any[]) {
              if (child.isDirectory && ep.has(child.path)) {
                send({ type: 'file_tree', path: child.path, showHidden: sh });
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
        const { expandedPaths, showHidden: sh2 } = useFileStore.getState();
        const expandedInThisLevel = (data.entries as any[])
          .filter((e: any) => e.isDirectory && expandedPaths.has(e.path))
          .map((e: any) => e.path);
        for (const dirPath of expandedInThisLevel) {
          send({ type: 'file_tree', path: dirPath, showHidden: sh2 });
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
        if (data.event === 'add' || data.event === 'addDir' || data.event === 'unlink' || data.event === 'unlinkDir') {
          // Bump refreshTrigger so ProjectFileSection components auto-refresh
          useFileStore.getState().bumpRefreshTrigger();

          const parentDir = data.path.substring(0, data.path.lastIndexOf('/'));
          if (parentDir) {
            const { tree, treeRoot, showHidden } = useFileStore.getState();
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
              sendRef.current({ type: 'file_tree', path: parentDir, showHidden });
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
        const normalizedPendingQuestion = normalizePendingQuestion({
          questionId: data.questionId,
          sessionId: data.sessionId,
          questions: data.questions,
        });
        useChatStore.getState().setPendingQuestion(normalizedPendingQuestion);
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
          if (data.sessionId) {
            useSessionStore.getState().setSessionStreaming(data.sessionId, true);
            const activeSessionId = useChatStore.getState().sessionId;
            if (activeSessionId === data.sessionId) {
              useChatStore.getState().setStreaming(true);
              if (!useChatStore.getState().turnStartTime) {
                useChatStore.getState().setTurnStartTime(Date.now());
              }
            }
          }
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
            id: generateUUID(),
            role: 'system',
            content: [{ type: 'text', text: `Session limit exceeded: ${data.message}. Please wait for another session to finish.` }],
            timestamp: Date.now(),
          });
        } else if (data.errorCode === 'SDK_HANG') {
          toastError('SDK response timed out');
          addMessage({
            id: generateUUID(),
            role: 'system',
            content: [{ type: 'text', text: data.message }],
            timestamp: Date.now(),
          });
        } else {
          toastError(data.message || 'Unknown error');
          addMessage({
            id: generateUUID(),
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
            id: generateUUID(),
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

      case 'session_created': {
        if (data.session) {
          const store = useSessionStore.getState();
          const existing = store.sessions.find(s => s.id === data.session.id);
          if (!existing && !data.session.roomId && !data.session.parentSessionId) {
            store.addSession(data.session);
          }
        }
        break;
      }

      case 'session_moved': {
        // Update session's projectId in the store when moved via API (e.g., by a task agent)
        if (data.sessionId) {
          useSessionStore.getState().updateSessionMeta(data.sessionId, { projectId: data.projectId ?? null });
        }
        break;
      }

      case 'task_created': {
        if (data.task) {
          const existing = useKanbanStore.getState().tasks.find(t => t.id === data.task.id);
          if (!existing) {
            useKanbanStore.getState().addTask(data.task);
          }
        }
        break;
      }

      case 'task_update': {
        const { taskId, status, sessionId: taskSessionId, progressSummary, session: taskSession, claudeSessionId: taskClaudeSessionId, scheduledAt, scheduleCron, scheduleEnabled, workflow, worktreePath } = data;
        useKanbanStore.getState().updateTask(taskId, {
          ...(status && { status }),
          ...(taskSessionId !== undefined && { sessionId: taskSessionId }),
          ...(progressSummary && { progressSummary }),
          ...(scheduledAt !== undefined && { scheduledAt }),
          ...(scheduleCron !== undefined && { scheduleCron }),
          ...(scheduleEnabled !== undefined && { scheduleEnabled }),
          ...(workflow !== undefined && { workflow }),
          ...(worktreePath !== undefined && { worktreePath }),
        });
        // Notify on task completion or failure
        if (status === 'done' || status === 'failed') {
          const task = useKanbanStore.getState().tasks.find(t => t.id === taskId);
          notifyTaskComplete(task?.title || 'Unknown task', status);
        }
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
          const store = useSessionStore.getState();
          const existing = store.sessions.find(s => s.id === metaSid);
          if (existing) {
            // Session exists locally — update it
            store.updateSessionMeta(metaSid, metaUpdates);
          } else if (metaUpdates.visibility === 'project') {
            // Session became shared — refetch session list to pick it up
            const tk = localStorage.getItem('token');
            const hdrs: Record<string, string> = {};
            if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
            fetch('/api/sessions', { headers: hdrs })
              .then(r => r.ok ? r.json() : [])
              .then(sessions => store.setSessions(sessions.filter((s: any) => !s.roomId)))
              .catch(() => {});
          }
        }
        break;
      }

      case 'task_list': {
        useKanbanStore.getState().setTasks(data.tasks || []);
        break;
      }

      // ── Room events ──────────────────────────────────────────
      case 'room_message': {
        const { roomId, message: roomMsg } = data;
        // If the server echoed a clientMsgId, confirm the pending optimistic message
        if (roomMsg.clientMsgId) {
          const msgs = useRoomStore.getState().messagesByRoom[roomId] ?? [];
          const pending = msgs.find((m: any) => m.clientMsgId === roomMsg.clientMsgId && m.pending);
          if (pending) {
            useRoomStore.getState().confirmPendingMessage(roomId, roomMsg.clientMsgId, roomMsg);
            break;
          }
        }
        useRoomStore.getState().addMessage(roomId, roomMsg);
        if (useRoomStore.getState().activeRoomId !== roomId) {
          useRoomStore.getState().incrementUnread(roomId);
        }
        break;
      }

      case 'room_ai_stream': {
        // @ai streaming chunk — update message content in real time
        const { roomId, messageId: streamMsgId, content: streamContent } = data;
        useRoomStore.getState().updateMessage(roomId, streamMsgId, { content: streamContent });
        break;
      }

      case 'room_ai_stream_done': {
        // @ai streaming complete — replace placeholder with final DB message
        const { roomId, messageId: placeholderId, finalMessageId, content: finalContent } = data;
        if (data.remove) {
          // Error case: remove the streaming placeholder entirely
          useRoomStore.getState().removeMessage(roomId, placeholderId);
        } else {
          useRoomStore.getState().updateMessage(roomId, placeholderId, {
            id: finalMessageId,
            content: finalContent,
            metadata: { streaming: false },
          });
        }
        break;
      }

      case 'room_typing': {
        const { roomId, userId, username } = data;
        useRoomStore.getState().setTyping(roomId, { userId, username, timestamp: Date.now() });
        break;
      }

      case 'room_joined': {
        // Confirmation that we joined a room
        break;
      }

      case 'room_left': {
        break;
      }

      case 'room_member_joined':
      case 'room_member_added': {
        const { roomId, member } = data;
        useRoomStore.getState().addMember(roomId, member);
        break;
      }

      case 'room_member_left':
      case 'room_member_removed': {
        const { roomId, userId } = data;
        useRoomStore.getState().removeMember(roomId, userId);
        break;
      }

      case 'room_added': {
        // A room was added to our list (e.g. we were invited)
        const { room } = data;
        if (room) {
          useRoomStore.getState().addRoom(room);
        }
        break;
      }

      case 'room_removed': {
        // We were removed from a room
        const { roomId } = data;
        useRoomStore.getState().removeRoom(roomId);
        break;
      }

      // ── Notifications ─────────────────────────────────────────
      case 'notification': {
        const { notification: notif } = data;
        if (notif) {
          useRoomStore.getState().addNotification(notif);
          // Show toast for important notification types
          if (notif.type === 'task_done') {
            notifyTaskComplete(notif.body || notif.title, 'done');
          } else if (notif.type === 'task_failed') {
            notifyTaskComplete(notif.body || notif.title, 'failed');
          } else if (notif.type === 'heartbeat') {
            toastInfo(`💓 ${notif.title}`);
          } else if (notif.type === 'mention') {
            toastInfo(`@${notif.title}`);
          }
        }
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
    // Also refresh kanban tasks — task_update messages may have been lost
    // during disconnection (e.g. task completed while WS was down)
    setTimeout(() => sendRef.current({ type: 'task_list' }), 100);
  }, []);

  const { send, connected, ws: wsRef2, safetyTimerFired } = useWebSocket(wsUrl, handleMessage, handleReconnect);
  sendRef.current = send;

  // Expose WS reference globally for KanbanBoard to send task_spawn/abort messages
  if (wsRef2.current) {
    (window as any).__claudeWs = wsRef2.current;
  }

  const sendMessage = useCallback(
    (message: string, cwd?: string) => {
      // Resolve sessionId: chatStore is primary, sessionStore is fallback (handles desync)
      const resolved = resolveSendSessionId(
        useChatStore.getState().sessionId,
        useSessionStore.getState().activeSessionId,
      );
      if (!resolved) {
        console.error('[chat] sendMessage: no sessionId in either store — cannot send');
        toastError('No active session. Please select or create a session.');
        return;
      }
      const activeSid = resolved.sessionId;
      if (resolved.source === 'sessionStore') {
        console.warn(`[chat] sessionId desync detected — recovering from sessionStore: ${activeSid.slice(0, 8)}`);
        useChatStore.getState().setSessionId(activeSid);
      }

      const messageId = generateUUID();
      // Add user message locally with pending status (AFTER sessionId check)
      addMessage({
        id: messageId,
        role: 'user',
        content: [{ type: 'text', text: message }],
        timestamp: Date.now(),
        username: localStorage.getItem('username') || undefined,
        sendStatus: 'pending',
      });

      setStreaming(true);
      setTurnStartTime(Date.now());
      useChatStore.getState().setLastTurnMetrics(null);
      currentAssistantMsg.current = null;
      // Optimistically mark the active session as streaming so sidebar, tool chips,
      // stop button, and queue behavior all agree immediately before session_status arrives.
      useSessionStore.getState().setSessionStreaming(activeSid, true);

      // Bump updatedAt so the session moves to top of sidebar immediately
      useSessionStore.getState().updateSessionMeta(activeSid, { updatedAt: new Date().toISOString() });

      send({
        type: 'chat',
        message,
        messageId,
        sessionId: activeSid,
        claudeSessionId: useChatStore.getState().claudeSessionId,
        cwd,
        model: getModelIdForBackend(useModelStore.getState().selectedModel),
      });
    },
    [send, addMessage, setStreaming, setTurnStartTime]
  );

  const abort = useCallback(() => {
    const sessionId = useChatStore.getState().sessionId;
    send({ type: 'abort', sessionId });
    // Immediately clear streaming state so the UI returns to idle mode.
    // This lets the user send a new message right after Stop without waiting
    // for the server to confirm idle via session_status.
    // If the engine is still aborting (Pi race), the backend's SESSION_BUSY
    // guard will re-queue the message automatically.
    setStreaming(false);
    setTurnStartTime(null);
    if (sessionId) {
      useSessionStore.getState().setSessionStreaming(sessionId, false);
    }
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
      send({ type: 'file_tree', path, showHidden: useFileStore.getState().showHidden });
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
    loadMoreMessages,
  };
}
