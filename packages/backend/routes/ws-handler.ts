import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import { getEngine, getTotalActiveCount, getAllRunningSessionIds } from '../engines/index.js';
import type { EngineCallbacks, TowerMessage } from '../engines/types.js';
// Legacy: still needed for handleSetActiveSession idle cleanup until full engine migration
import { getSession as getSDKSession, cleanupSession } from '../services/claude-sdk.js';
import { getFileTree, readFile, writeFile, setupFileWatcher, type FileChangeEvent } from '../services/file-system.js';
import { verifyWsToken, getUserAllowedPath } from '../services/auth.js';
import { isPathSafe } from '../services/file-system.js';
import { saveMessage, updateMessageContent, attachToolResultInDb, updateMessageMetrics, getMessages } from '../services/message-store.js';
import { getSession, updateSession } from '../services/session-manager.js';
import { generateSessionName } from '../services/auto-namer.js';
import { extractTextFromContent } from '../utils/text.js';
import { execute } from '../db/pg-repo.js';
import { config } from '../config.js';
import { findSessionClient, abortCleanup, addSessionClient, removeSessionClient } from './session-guards.js';
import { spawnTask, abortTask } from '../services/task-runner.js';
// damage-control moved to engines/claude-engine.ts
import { getTasks } from '../services/task-manager.js';
import { addRoomClient, removeRoomClient, removeClientFromAllRooms, getRoomClientIds } from '../services/room-guards.js';
import type { RoomClient } from '../services/room-guards.js';
import { isPgEnabled } from '../db/pg.js';
import { canAccessRoom, canAccessSession, isPathAccessible } from '../services/project-access.js';
import { initWsSync, publishWsSyncEvent, type WsSyncHandlers } from '../services/ws-sync.js';

interface WsClient {
  id: string;
  ws: WebSocket;
  sessionId?: string;       // our platform session ID
  claudeSessionId?: string; // Claude SDK session ID for resume
  userRole?: string;        // role from JWT (admin/user)
  userId?: number;          // user ID from JWT
  username?: string;        // username from JWT
  activeQueryEpoch: number; // incremented on each new query / session switch
  allowedPath?: string;     // per-user workspace path restriction
  joinedRooms: Set<string>;  // rooms this client is subscribed to (for room-guards)
}

interface PendingQuestion {
  questionId: string;
  sessionId: string;
  questions: any[];
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const SDK_HANG_TIMEOUT = 60 * 60 * 1000; // 60 minutes
const ASK_USER_TIMEOUT = 3 * 60 * 1000; // 3 minutes

const clients = new Map<string, WsClient>();
const sessionClients = new Map<string, Set<string>>(); // sessionId → Set<clientId> (1:many)
const pendingQuestions = new Map<string, PendingQuestion>(); // questionId → PendingQuestion
const roomClients = new Map<string, Set<string>>(); // roomId → Set<clientId>
const remoteStreamingSessions = new Set<string>();
const remotePendingQuestionsBySession = new Map<string, { questionId: string; questions: any[] }>();
const pendingSnapshotRequests = new Map<string, {
  resolve: (snapshot: { isStreaming: boolean; pendingQuestion: { questionId: string; questions: any[] } | null } | null) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
let wsSyncInitStarted = false;

function getLocalPendingQuestion(sessionId: string): { questionId: string; questions: any[] } | null {
  for (const pq of pendingQuestions.values()) {
    if (pq.sessionId === sessionId) {
      return { questionId: pq.questionId, questions: pq.questions };
    }
  }
  return null;
}

function sanitizeAskUserQuestions(questions: any[]): any[] {
  if (!Array.isArray(questions)) return [];
  return questions
    .filter((q) => q && typeof q.question === 'string' && q.question.trim().length > 0)
    .map((q) => ({
      ...q,
      question: q.question.trim(),
      options: Array.isArray(q.options)
        ? q.options.filter((opt: any) => opt && typeof opt.label === 'string' && opt.label.trim().length > 0)
        : [],
    }));
}

function cancelPendingQuestionsForSession(sessionId: string, reason: string): boolean {
  let cancelled = false;
  for (const [questionId, pq] of pendingQuestions.entries()) {
    if (pq.sessionId !== sessionId) continue;
    clearTimeout(pq.timer);
    pendingQuestions.delete(questionId);
    pq.reject(new Error(reason));
    cancelled = true;
  }
  return cancelled;
}

function getCachedRemoteSnapshot(sessionId: string): { isStreaming: boolean; pendingQuestion: { questionId: string; questions: any[] } | null } | null {
  const pendingQuestion = remotePendingQuestionsBySession.get(sessionId) || null;
  if (!remoteStreamingSessions.has(sessionId) && !pendingQuestion) return null;
  return {
    isStreaming: remoteStreamingSessions.has(sessionId),
    pendingQuestion,
  };
}

async function requestRemoteSessionSnapshot(sessionId: string): Promise<{ isStreaming: boolean; pendingQuestion: { questionId: string; questions: any[] } | null } | null> {
  if (!isPgEnabled()) return null;

  const requestId = uuidv4();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingSnapshotRequests.delete(requestId);
      resolve(getCachedRemoteSnapshot(sessionId));
    }, 250);

    pendingSnapshotRequests.set(requestId, {
      resolve: (snapshot) => {
        clearTimeout(timer);
        pendingSnapshotRequests.delete(requestId);
        resolve(snapshot);
      },
      timer,
    });

    publishWsSyncEvent(config.serverEpoch, {
      scope: 'session',
      sessionId,
      data: { type: 'session_snapshot_request', requestId },
    });
  });
}

async function getSessionRecoverySnapshot(sessionId: string): Promise<{ isStreaming: boolean; pendingQuestion: { questionId: string; questions: any[] } | null } | null> {
  const localPendingQuestion = getLocalPendingQuestion(sessionId);
  const localIsStreaming = !!getSDKSession(sessionId)?.isRunning;
  if (localIsStreaming || localPendingQuestion) {
    return {
      isStreaming: localIsStreaming,
      pendingQuestion: localPendingQuestion,
    };
  }

  const cachedRemote = getCachedRemoteSnapshot(sessionId);
  if (cachedRemote) return cachedRemote;

  return requestRemoteSessionSnapshot(sessionId);
}

function resolvePendingQuestionLocally(questionId: string | undefined, answer: string, sessionId?: string): boolean {
  if (questionId) {
    const exact = pendingQuestions.get(questionId);
    if (exact) {
      exact.resolve(answer);
      return true;
    }
  }

  if (sessionId) {
    for (const [, entry] of pendingQuestions) {
      if (entry.sessionId === sessionId) {
        entry.resolve(answer);
        return true;
      }
    }
  }

  return false;
}

async function abortSessionEverywhere(sessionId: string): Promise<void> {
  let dbSession: Awaited<ReturnType<typeof getSession>> | undefined;
  try { dbSession = await getSession(sessionId); } catch {}
  const engineName = (dbSession as any)?.engine || config.defaultEngine || 'claude';
  try {
    const engine = await getEngine(engineName);
    engine.abort(sessionId);
  } catch {}
}

function localBroadcastToAll(data: any) {
  const payload = JSON.stringify(data);
  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function localBroadcastToSession(sessionId: string, data: any, excludeClientId?: string) {
  const clientIds = sessionClients.get(sessionId);
  if (!clientIds) return;
  const payload = JSON.stringify(data);
  for (const clientId of clientIds) {
    if (clientId === excludeClientId) continue;
    const client = clients.get(clientId);
    if (client?.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function localBroadcastToRoom(roomId: string, data: any, excludeClientId?: string) {
  const clientIds = getRoomClientIds(roomClients, roomId);
  const payload = JSON.stringify(data);
  for (const clientId of clientIds) {
    if (clientId === excludeClientId) continue;
    const client = clients.get(clientId);
    if (client?.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function localBroadcastToUser(userId: number, data: any) {
  const payload = JSON.stringify(data);
  for (const client of clients.values()) {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function handleRemoteAllEvent(data: any) {
  if (data?.type === 'session_status' && typeof data.sessionId === 'string') {
    if (data.status === 'streaming') {
      remoteStreamingSessions.add(data.sessionId);
    } else if (data.status === 'idle') {
      remoteStreamingSessions.delete(data.sessionId);
      remotePendingQuestionsBySession.delete(data.sessionId);
    }
  }

  localBroadcastToAll(data);
}

function handleRemoteSessionEvent(sessionId: string, data: any) {
  if (!data || typeof data !== 'object') return;

  switch (data.type) {
    case 'session_snapshot_request': {
      const localPendingQuestion = getLocalPendingQuestion(sessionId);
      const localIsStreaming = !!getSDKSession(sessionId)?.isRunning;
      if (!localIsStreaming && !localPendingQuestion) return;
      publishWsSyncEvent(config.serverEpoch, {
        scope: 'session',
        sessionId,
        data: {
          type: 'session_snapshot_response',
          requestId: data.requestId,
          isStreaming: localIsStreaming,
          pendingQuestion: localPendingQuestion,
        },
      });
      return;
    }
    case 'session_snapshot_response': {
      if (data.isStreaming) {
        remoteStreamingSessions.add(sessionId);
      }
      if (data.pendingQuestion) {
        remotePendingQuestionsBySession.set(sessionId, data.pendingQuestion);
      }
      const pending = pendingSnapshotRequests.get(data.requestId);
      if (!pending) return;
      pending.resolve({
        isStreaming: !!data.isStreaming,
        pendingQuestion: data.pendingQuestion || null,
      });
      return;
    }
    case 'answer_question_sync': {
      remotePendingQuestionsBySession.delete(sessionId);
      resolvePendingQuestionLocally(data.questionId, data.answer, sessionId);
      return;
    }
    case 'abort_session_sync': {
      remoteStreamingSessions.delete(sessionId);
      remotePendingQuestionsBySession.delete(sessionId);
      cancelPendingQuestionsForSession(sessionId, 'Session aborted');
      abortSessionEverywhere(sessionId).catch(() => {});
      return;
    }
    case 'ask_user':
      if (data.questionId && Array.isArray(data.questions)) {
        remotePendingQuestionsBySession.set(sessionId, { questionId: data.questionId, questions: data.questions });
      }
      break;
    case 'ask_user_timeout':
    case 'sdk_done':
      remotePendingQuestionsBySession.delete(sessionId);
      break;
    case 'error':
      if (data.sessionId === sessionId) {
        remotePendingQuestionsBySession.delete(sessionId);
      }
      break;
  }

  localBroadcastToSession(sessionId, data);
}

const wsSyncHandlers: WsSyncHandlers = {
  all(data) {
    handleRemoteAllEvent(data);
  },
  session(sessionId, data) {
    handleRemoteSessionEvent(sessionId, data);
  },
  room(roomId, data) {
    localBroadcastToRoom(roomId, data);
  },
  user(userId, data) {
    localBroadcastToUser(userId, data);
  },
};

/**
 * Claim a claudeSessionId for a Tower session.
 * If another session already holds it, clear theirs first (Tower = SSOT, latest wins).
 */
async function claimClaudeSessionId(towerSessionId: string, claudeSessionId: string) {
  await execute(
    `UPDATE sessions SET claude_session_id = NULL
     WHERE claude_session_id = $1 AND id != $2`,
    [claudeSessionId, towerSessionId]
  );
  await updateSession(towerSessionId, { claudeSessionId });
}

/**
 * Derived events the frontend still expects in legacy shapes.
 *
 * tower_message covers streaming content directly, but a few
 * terminal/error events historically arrived as top-level
 * `sdk_done`, `resume_failed`, or `error` frames. Frontend handlers
 * still key off those types, so translate only those here.
 *
 * NOTE: we do NOT emit legacy `sdk_message` frames anymore — they
 * were a pure duplicate of tower_message for assistant/turn_done/
 * compact and doubled our WS fan-out during streaming.
 */
function towerToLegacyTerminal(msg: TowerMessage, sessionId: string): any {
  switch (msg.type) {
    case 'compact':
      // Persist a marker in DB when compact finishes so it survives reload.
      // Frontend renders the divider from the tower_message `compact.done`
      // event directly — no additional legacy frame needed.
      if (msg.phase === 'done') {
        const markerId = `compact-${Date.now()}`;
        saveMessage(sessionId, {
          id: markerId,
          role: 'system',
          content: [{ type: 'text', text: '✂️ Context compacted' }],
        }).catch(() => {});
      }
      return null;
    case 'engine_done':
      return {
        type: 'sdk_done',
        sessionId,
        claudeSessionId: msg.engineSessionId,
      };
    case 'engine_error':
      if (msg.recoverable) {
        return {
          type: 'resume_failed',
          sessionId,
          message: msg.message,
        };
      }
      return {
        type: 'error',
        sessionId,
        message: msg.message,
        errorCode: /already processing/i.test(msg.message) ? 'SESSION_BUSY' : undefined,
      };
    default:
      return null;
  }
}

function broadcastTowerMessage(sessionId: string, towerMsg: TowerMessage) {
  localBroadcastToSession(sessionId, { type: 'tower_message', sessionId, message: towerMsg });
  if (!isPgEnabled()) return;
  publishWsSyncEvent(config.serverEpoch, {
    scope: 'session',
    sessionId,
    data: { type: 'tower_message', sessionId, message: towerMsg },
  });
}

/**
 * Broadcast a message to ALL connected clients (regardless of session).
 * Used for session status updates that affect the sidebar.
 */
export function broadcastToAll(data: any) {
  localBroadcastToAll(data);
  if (!isPgEnabled()) return;
  publishWsSyncEvent(config.serverEpoch, { scope: 'all', data });
}

/**
 * Broadcast a message to ALL clients viewing a session.
 * Used for streaming-related frames (sdk_done, ask_user, errors).
 * Streaming content now goes through broadcastTowerMessage directly.
 */
function broadcastToSession(sessionId: string, data: any, excludeClientId?: string) {
  localBroadcastToSession(sessionId, data, excludeClientId);
  if (!isPgEnabled()) return;
  publishWsSyncEvent(config.serverEpoch, { scope: 'session', sessionId, data });
}

/**
 * Broadcast a message to ALL clients subscribed to a room.
 * Used for chat room messages, typing indicators, and AI status updates.
 */
function broadcastToRoom(roomId: string, data: any, excludeClientId?: string) {
  localBroadcastToRoom(roomId, data, excludeClientId);
  if (!isPgEnabled()) return;
  publishWsSyncEvent(config.serverEpoch, { scope: 'room', roomId, data });
}

/**
 * Send directly to a specific client.
 * Falls back to any session viewer when the originating WS is dead (reconnection).
 * Used for client-specific messages (SESSION_BUSY, SESSION_LIMIT).
 */
function sendToClient(client: WsClient, sessionId: string, data: any) {
  const payload = JSON.stringify(data);
  if (client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(payload);
  } else {
    // Client disconnected — try any client still viewing this session
    const fallback = findSessionClient(sessionClients, clients, sessionId);
    if (fallback && fallback.ws.readyState === WebSocket.OPEN) {
      fallback.ws.send(payload);
    }
  }
}

// createCanUseTool → moved to engines/claude-engine.ts

export function broadcast(data: any) {
  localBroadcastToAll(data);
  if (!isPgEnabled()) return;
  publishWsSyncEvent(config.serverEpoch, { scope: 'all', data });
}

export function setupWebSocket(server: Server) {
  if (!wsSyncInitStarted) {
    wsSyncInitStarted = true;
    initWsSync(config.serverEpoch, wsSyncHandlers).catch((err) => {
      wsSyncInitStarted = false;
      console.error('[ws] initWsSync failed:', err?.message || err);
    });
  }

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info: { req: import('http').IncomingMessage }) => {
      if (!config.authEnabled) return true;
      const url = new URL(info.req.url || '', 'ws://localhost');
      const token = url.searchParams.get('token');
      return !!verifyWsToken(token);
    },
  });

  // Setup chokidar file watcher → broadcast changes
  setupFileWatcher(config.workspaceRoot, (event: FileChangeEvent, filePath: string) => {
    broadcast({ type: 'file_changed', event, path: filePath });
  });

  wss.on('connection', async (ws, req) => {
    const clientId = uuidv4();
    const client: WsClient = { id: clientId, ws, activeQueryEpoch: 0, joinedRooms: new Set() };

    // Extract user role from JWT token
    if (config.authEnabled) {
      const url = new URL(req.url || '', 'ws://localhost');
      const token = url.searchParams.get('token');
      const payload = verifyWsToken(token);
      if (payload && typeof payload === 'object' && 'role' in payload) {
        client.userRole = (payload as any).role;
        client.userId = (payload as any).userId;
        client.username = (payload as any).username;
        if (client.userId) {
          client.allowedPath = client.userRole === 'admin'
            ? os.homedir()
            : await getUserAllowedPath(client.userId);
        }
      }
    }

    clients.set(clientId, client);

    send(ws, {
      type: 'connected',
      clientId,
      serverEpoch: config.serverEpoch,
      streamingSessions: [...new Set([...getAllRunningSessionIds(), ...remoteStreamingSessions])],
    });

    // ── Protocol-level ping (binary frame) ──────────────────────────────
    // Cloudflare and mobile networks need WS protocol pings to keep alive.
    // App-level JSON ping alone isn't enough — Cloudflare may still timeout.
    let missedPongs = 0;
    ws.on('pong', () => { missedPongs = 0; });       // browser auto-replies pong
    const pingInterval = setInterval(() => {
      missedPongs++;
      if (missedPongs >= 3) { ws.terminate(); return; }  // 3 missed pongs → force close
      ws.ping();                                          // binary ping frame
    }, 30_000);                                           // 30s interval, tolerates ~90s outage
    ws.on('close', () => clearInterval(pingInterval));

    ws.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        await handleMessage(client, data);
      } catch (error: any) {
        send(ws, { type: 'error', message: error.message || 'Unknown error' });
      }
    });

    ws.on('close', () => {
      clients.delete(clientId);
      // Remove from session viewer set — other tabs keep their entries
      if (client.sessionId) {
        removeSessionClient(sessionClients, client.sessionId, clientId);
      }
      // Clean up room subscriptions
      removeClientFromAllRooms(roomClients, client as any);
    });

    ws.on('error', () => {
      if (client.sessionId) {
        removeSessionClient(sessionClients, client.sessionId, clientId);
      }
      // Clean up room subscriptions
      removeClientFromAllRooms(roomClients, client as any);
      clients.delete(clientId);
    });
  });

  return wss;
}

async function handleMessage(client: WsClient, data: any) {
  switch (data.type) {
    case 'chat':
      await handleChat(client, data);
      break;
    case 'abort':
      handleAbort(client, data);
      break;
    case 'file_read':
      handleFileRead(client, data);
      break;
    case 'file_write':
      handleFileWrite(client, data);
      break;
    case 'file_tree':
      handleFileTree(client, data);
      break;
    case 'reconnect':
      await handleReconnect(client, data);
      break;
    case 'set_active_session':
      handleSetActiveSession(client, data);
      break;
    case 'answer_question':
      handleAnswerQuestion(client, data);
      break;
    case 'ping':
      send(client.ws, { type: 'pong' });
      break;
    case 'task_spawn': {
      const { taskId } = data;
      try {
        await spawnTask(taskId, (type, payload) => {
          broadcastToAll({ type, ...payload });
          // In-app notification only — external messaging (Telegram, KakaoTalk) is in task-runner.ts
          if (type === 'task_update' && (payload.status === 'done' || payload.status === 'failed') && client.userId) {
            import('../services/notification-hub.js').then(({ notify }) => {
              const title = payload.status === 'done' ? 'Task completed' : 'Task failed';
              notify(
                client.userId!,
                null,
                payload.status === 'done' ? 'task_done' : 'task_failed',
                title,
                payload.title || taskId.slice(0, 8),
                { taskId },
              ).catch(() => {});
            }).catch((e: any) => {
              console.error(`[notification-hub] import error:`, e.message);
            });
          }
        }, client.userId, client.userRole, client.allowedPath);
      } catch (err: any) {
        send(client.ws, { type: 'error', message: err.message });
      }
      break;
    }
    case 'task_abort': {
      const { taskId } = data;
      const ok = abortTask(taskId);
      if (!ok) {
        send(client.ws, { type: 'error', message: 'Task not running' });
      }
      break;
    }
    case 'task_list': {
      const tasks = await getTasks(client.userId, client.userRole);
      send(client.ws, { type: 'task_list', tasks });
      break;
    }
    case 'room_join':
      handleRoomJoin(client, data);
      break;
    case 'room_leave':
      handleRoomLeave(client, data);
      break;
    case 'room_message':
      await handleRoomMessage(client, data);
      break;
    case 'room_typing':
      handleRoomTyping(client, data);
      break;
    case 'room_read':
      await handleRoomRead(client, data);
      break;
    case 'share_to_channel':
      await handleShareToChannel(client, data);
      break;
    case 'check_session_status': {
      // Stale queue guard: frontend asks if a session is actually still streaming
      const checkSid = data.sessionId;
      if (typeof checkSid === 'string') {
        const runningIds = new Set([...getAllRunningSessionIds(), ...remoteStreamingSessions]);
        const actualStatus = runningIds.has(checkSid) ? 'streaming' : 'idle';
        console.log(`[ws] check_session_status session=${checkSid.slice(0, 8)} status=${actualStatus}`);
        send(client.ws, { type: 'session_status_check', sessionId: checkSid, status: actualStatus });
      }
      break;
    }
    default:
      send(client.ws, { type: 'error', message: `Unknown message type: ${data.type}` });
  }
}

async function handleReconnect(client: WsClient, data: { sessionId?: string; claudeSessionId?: string }) {
  const sessionId = data.sessionId;
  if (!sessionId) {
    send(client.ws, { type: 'reconnect_result', status: 'idle' });
    return;
  }

  // Restore session context on the new client
  client.sessionId = sessionId;
  if (data.claudeSessionId) {
    client.claudeSessionId = data.claudeSessionId;
  }

  // Add to session's viewer set (1:many — doesn't evict other tabs)
  addSessionClient(sessionClients, sessionId, client.id);

  const snapshot = await getSessionRecoverySnapshot(sessionId);
  const snapshotActive = !!snapshot?.isStreaming || !!snapshot?.pendingQuestion;

  if (snapshotActive) {
    send(client.ws, {
      type: 'reconnect_result',
      status: 'streaming',
      sessionId,
      pendingQuestion: snapshot?.pendingQuestion || null,
    });
    return;
  }

  // Interrupted sessions are now resumed server-side (serverSideResumeInterrupted).
  // Never return 'interrupted' to the client — the server handles all resume logic.
  // If auto-resume is already running, the snapshot check above returns 'streaming'.
  // If not yet started, return 'idle' — server will start it shortly and broadcast status.
  send(client.ws, { type: 'reconnect_result', status: 'idle', sessionId });
}

async function handleSetActiveSession(client: WsClient, data: { sessionId: string; claudeSessionId?: string }) {
  const oldSessionId = client.sessionId;
  const newSessionId = data.sessionId;
  console.log(`[ws] setActiveSession old=${oldSessionId} new=${newSessionId} client=${client.id}`);

  // Access control: verify this client can access the target session
  if (client.userId) {
    const access = await canAccessSession(newSessionId, client.userId, client.userRole || 'user');
    if (!access.allowed) {
      console.warn(`[ws] setActiveSession DENIED client=${client.id.slice(0, 8)} session=${newSessionId.slice(0, 8)} reason=${access.message}`);
      send(client.ws, { type: 'error', message: access.message, errorCode: 'ACCESS_DENIED', sessionId: newSessionId });
      return;
    }
  }

  if (oldSessionId && oldSessionId !== newSessionId) {
    // Cleanup idle SDK sessions (only if no other viewers)
    const sdkSession = getSDKSession(oldSessionId);
    if (sdkSession && !sdkSession.isRunning) {
      const viewers = sessionClients.get(oldSessionId);
      const otherViewers = viewers ? [...viewers].filter((id) => id !== client.id) : [];
      if (otherViewers.length === 0) {
        cleanupSession(oldSessionId);
      }
    }
    // Remove from old session's viewer set
    removeSessionClient(sessionClients, oldSessionId, client.id);
  }

  // Update client to new session and add to viewer set.
  // DON'T bump epoch — let any running streaming loop continue in background.
  // The loop saves to DB and broadcasts to viewers. When user returns, messages load from DB.
  client.sessionId = newSessionId;
  addSessionClient(sessionClients, newSessionId, client.id);

  // Always sync claudeSessionId to the new session (clear if not provided)
  client.claudeSessionId = data.claudeSessionId || undefined;

  const snapshot = await getSessionRecoverySnapshot(newSessionId);

  send(client.ws, {
    type: 'set_active_session_ack',
    sessionId: newSessionId,
    isStreaming: !!snapshot?.isStreaming || !!snapshot?.pendingQuestion,
    pendingQuestion: snapshot?.pendingQuestion || null,
  });
}

async function handleChat(client: WsClient, data: { message: string; messageId?: string; sessionId?: string; claudeSessionId?: string; cwd?: string; model?: string; panelChat?: boolean }) {
  const sessionId = data.sessionId || client.sessionId;
  if (!sessionId) {
    console.error(`[ws] handleChat REJECTED: no sessionId from client=${client.id.slice(0, 8)} — frontend must create session first`);
    sendToClient(client, 'unknown', {
      type: 'error',
      message: 'No session ID provided. Please refresh the page and try again.',
      errorCode: 'NO_SESSION_ID',
      sessionId: '',
    });
    return;
  }

  // Panel chat: don't change client's main sessionId — panel sessions are side-channels
  if (!data.panelChat) {
    client.sessionId = sessionId;
  }

  // Add this client to the session's viewer set
  addSessionClient(sessionClients, sessionId, client.id);

  // Resolve engine for this session
  let dbSession: Awaited<ReturnType<typeof getSession>> | undefined;
  try { dbSession = await getSession(sessionId); } catch {}
  const engineName = (dbSession as any)?.engine || config.defaultEngine || 'claude';
  const engine = await getEngine(engineName);

  // Guard: drop model if it doesn't match the session's engine.
  // When we drop the frontend-sent model, fall back to the session's stored
  // model_used (if it matches the engine) before letting the engine use its
  // built-in fallback — otherwise the Pi engine picks codex-mini-latest and
  // every turn dies with stopReason='error'. (See incident 2026-04-11.)
  const localModelIds = new Set((config.localModels || []).map((model: any) => String(model.id).replace(/^local:/, '')));
  const matchesEngine = (m: string | undefined, eng: string): boolean => {
    if (!m) return false;
    if (eng === 'claude') return m.startsWith('claude-');
    if (eng === 'pi') return m.includes('/'); // provider/modelId format
    if (eng === 'local') return !m.startsWith('claude-') && !m.includes('/') && (localModelIds.size === 0 || localModelIds.has(m));
    return false;
  };

  const requestedModel: string | undefined = data.model;
  let resolvedModel: string | undefined;
  if (matchesEngine(requestedModel, engineName)) {
    resolvedModel = requestedModel;
  } else {
    const storedModel = (dbSession as any)?.modelUsed as string | undefined;
    if (matchesEngine(storedModel, engineName)) {
      resolvedModel = storedModel;
      if (requestedModel) {
        console.log(`[ws] model mismatch: dropping "${requestedModel}" for engine="${engineName}", using stored model "${storedModel}"`);
      }
    } else if (requestedModel) {
      console.log(`[ws] model mismatch: dropping "${requestedModel}" for engine="${engineName}" (no valid stored model)`);
    }
  }

  console.log(`[ws] handleChat START session=${sessionId.slice(0, 8)} client=${client.id.slice(0, 8)} engine=${engineName} model=${resolvedModel || 'default'} active=${getTotalActiveCount()}`);

  // Guard: reject if engine is already running for this session
  if (engine.isRunning(sessionId)) {
    sendToClient(client, sessionId, {
      type: 'error',
      message: 'A conversation is already in progress for this session. Please wait until it finishes.',
      errorCode: 'SESSION_BUSY',
      sessionId,
    });
    return;
  }

  // Check concurrent session limit (across all engines)
  if (getTotalActiveCount() >= config.maxConcurrentSessions) {
    sendToClient(client, sessionId, {
      type: 'error',
      message: `Concurrent session limit exceeded (max ${config.maxConcurrentSessions})`,
      errorCode: 'SESSION_LIMIT',
      sessionId,
    });
    return;
  }

  // Save user message to DB
  const userMsgId = data.messageId || uuidv4();
  try {
    await saveMessage(sessionId, {
      id: userMsgId,
      role: 'user',
      content: [{ type: 'text', text: data.message }],
      username: client.username || null,
    });
  } catch (err) { console.error('[ws] saveMessage (user) failed:', err); }

  // Broadcast user message to other clients viewing this session (cross-device sync)
  broadcastToSession(sessionId, {
    type: 'user_message',
    sessionId,
    message: {
      id: userMsgId,
      role: 'user',
      content: [{ type: 'text', text: data.message }],
      username: client.username || null,
      createdAt: new Date().toISOString(),
    },
  }, client.id);

  // Resume session ID (engine-specific, stored in DB)
  const engineSessionId = data.claudeSessionId || dbSession?.claudeSessionId || undefined;

  // Engine callbacks — ws-handler owns WS routing and DB access
  const callbacks: EngineCallbacks = {
    askUser: (questionId: string, questions: any[]) => {
      const sanitizedQuestions = sanitizeAskUserQuestions(questions);
      if (sanitizedQuestions.length === 0) {
        console.warn(`[ws] ask_user dropped empty payload for session=${sessionId.slice(0, 8)}`);
        return Promise.resolve('No user question payload was provided. Continue without waiting for user input.');
      }

      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          const pq = pendingQuestions.get(questionId);
          if (pq) {
            pendingQuestions.delete(questionId);
            broadcastToSession(sessionId, { type: 'ask_user_timeout', sessionId, questionId });
            // Tell AI the user didn't respond — ask again via regular chat message instead
            const questionSummary = sanitizedQuestions.map((q: any) => q.question).join(', ');
            resolve(
              `[System] The user did not respond to the interactive prompt within 3 minutes. They may have switched to another session or missed it. ` +
              `Your question was: "${questionSummary}". ` +
              `Do NOT proceed silently. Instead, ask the same question again as a regular chat message so the user can see it when they return. ` +
              `Keep your message concise and clear.`
            );
          }
        }, ASK_USER_TIMEOUT);

        pendingQuestions.set(questionId, {
          questionId,
          sessionId,
          questions: sanitizedQuestions,
          resolve: (answer: string) => {
            clearTimeout(timer);
            pendingQuestions.delete(questionId);
            resolve(answer);
          },
          reject: (error: Error) => {
            clearTimeout(timer);
            pendingQuestions.delete(questionId);
            reject(error);
          },
          timer,
        });

        // Broadcast question to ALL tabs viewing this session
        broadcastToSession(sessionId, {
          type: 'ask_user',
          sessionId,
          questionId,
          questions: sanitizedQuestions,
        });
      });
    },
    claimSessionId: async (esid: string) => {
      try { await claimClaudeSessionId(sessionId, esid); } catch {}
    },
    saveMessage: async (msg) => {
      try { await saveMessage(sessionId, msg); } catch {}
    },
    updateMessageContent: async (msgId, content) => {
      try { await updateMessageContent(msgId, content); } catch {}
    },
    attachToolResult: async (toolUseId, result) => {
      try { await attachToolResultInDb(sessionId, toolUseId, result); } catch {}
      // Notify frontend so AgentCard/ToolChip can update status (Running → Done)
      broadcastToSession(sessionId, {
        type: 'tool_result_attached',
        sessionId,
        toolUseId,
        result: typeof result === 'string' ? result.slice(0, 500) : String(result).slice(0, 500),
      });
    },
    updateMessageMetrics: async (msgId, metrics) => {
      try {
        await updateMessageMetrics(msgId, {
          duration_ms: metrics.durationMs,
          input_tokens: metrics.inputTokens,
          output_tokens: metrics.outputTokens,
        });
      } catch {}
    },
  };

  // Hang detection timer
  let hangTimer: ReturnType<typeof setTimeout> | null = null;
  const resetHangTimer = () => {
    if (hangTimer) clearTimeout(hangTimer);
    hangTimer = setTimeout(() => {
      engine.abort(sessionId);
      broadcastToSession(sessionId, {
        type: 'error',
        message: 'SDK response timed out. Session has been aborted.',
        errorCode: 'SDK_HANG',
        sessionId,
      });
    }, SDK_HANG_TIMEOUT);
  };

  // ── Personal skill interception (Claude engine only) ──
  // Pi handles all skills natively via additionalSkillPaths.
  // Claude SDK can't load per-user skills (shared OS user), so we prepend content.
  let finalMessage = data.message;
  if (engineName === 'claude' && data.message.startsWith('/')) {
    try {
      const { getPersonalSkill } = await import('../services/skill-registry.js');
      const skillName = data.message.split(' ')[0].slice(1);
      if (client.userId) {
        const personalSkill = await getPersonalSkill(client.userId, skillName);
        if (personalSkill) {
          const args = data.message.slice(skillName.length + 2);
          finalMessage = `${personalSkill.content}\n\n${args}`.trim();
        }
      }
    } catch {}
  }

  // ── Context injection for AI Panel sessions (first message only) ──
  const roomId = (dbSession as any)?.roomId;
  const parentSessionId = (dbSession as any)?.parentSessionId;
  const isFirstTurn = (dbSession?.turnCount ?? 0) === 0;

  // Channel context injection (room panel threads)
  if (roomId && isFirstTurn && isPgEnabled()) {
    try {
      const { getRoom, getMessages: getRoomMessages } = await import('../services/room-manager.js');
      const room = await getRoom(roomId);
      const recentMsgs = await getRoomMessages(roomId, { limit: 30 });
      if (room && recentMsgs.length > 0) {
        const contextLines = recentMsgs.map((m) => {
          const sender = m.senderName || (m.msgType === 'ai_reply' ? 'AI' : 'System');
          return `[${sender}]: ${m.content}`;
        }).join('\n');
        finalMessage = `[Channel Context: #${room.name}]\nRecent messages from the team channel (for reference):\n${contextLines}\n\nYou are assisting a team member privately in a side panel.\nFocus on answering their question below. Use the channel context only when relevant.\nThe conversation will continue in this thread — no need to re-read the channel on follow-up messages.\n\n---\n${finalMessage}`;
      }
    } catch (err: any) {
      console.warn('[ws] Channel context injection failed:', err.message);
    }
  }

  // Session context injection (session panel threads)
  if (parentSessionId && isFirstTurn && isPgEnabled()) {
    try {
      const { getMessages: getSessionMessages } = await import('../services/message-store.js');
      const parentSession = await getSession(parentSessionId);
      const allParentMsgs = await getSessionMessages(parentSessionId);
      const parentMsgs = allParentMsgs.slice(-50);
      if (parentMsgs.length > 0) {
        const contextLines = parentMsgs.map((m: any) => {
          const role = m.role === 'user' ? 'User' : 'Assistant';
          const content = typeof m.content === 'string' ? m.content : JSON.parse(m.content)
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text || '')
            .join('\n');
          return `[${role}]: ${content}`;
        }).filter((line: string) => line.trim().length > 7).join('\n');
        const sessionName = parentSession?.name || 'Session';
        finalMessage = `[Session Context: "${sessionName}"]\nHere is the conversation history from the parent session (for reference):\n${contextLines}\n\nYou are assisting the user in a side panel about this conversation.\nAnswer questions about the conversation, summarize, find details, or help analyze what was discussed.\nThe conversation will continue in this thread — no need to re-read the session on follow-up messages.\n\n---\n${finalMessage}`;
      }
    } catch (err: any) {
      console.warn('[ws] Session context injection failed:', err.message);
    }
  }

  // Notify all clients that this session started streaming
  broadcastToAll({ type: 'session_status', sessionId, status: 'streaming' });

  try {
    resetHangTimer();

    // Compute project-based accessible paths (cached, ~0ms on hit)
    let accessiblePaths: string[] | null | undefined;
    if (client.userId) {
      const { getUserAccessiblePaths } = await import('../services/project-access.js');
      accessiblePaths = await getUserAccessiblePaths(client.userId, client.userRole || 'member');
    }

    for await (const towerMsg of engine.run(sessionId, finalMessage, {
      cwd: data.cwd || dbSession?.cwd || client.allowedPath || config.defaultCwd,
      model: resolvedModel,
      userId: client.userId,
      username: client.username,
      userRole: client.userRole,
      allowedPath: client.allowedPath,
      accessiblePaths,
      engineSessionId,
      projectId: (dbSession as any)?.projectId || undefined,
    }, callbacks)) {
      resetHangTimer();

      // Primary path: frontend consumes TowerMessage directly for
      // assistant / turn_done / compact content.
      broadcastTowerMessage(sessionId, towerMsg);

      // Terminal legacy frames (sdk_done / error / resume_failed) still
      // flow as before — the frontend has richer handlers for those
      // (auto-name on sdk_done, error-code routing on error).
      const terminalMsg = towerToLegacyTerminal(towerMsg, sessionId);
      if (terminalMsg) {
        broadcastToSession(sessionId, terminalMsg);
      }

      // Update session metadata on engine_done
      if (towerMsg.type === 'engine_done') {
        const esid = towerMsg.engineSessionId;
        if (client.sessionId === sessionId && esid) {
          client.claudeSessionId = esid;
          // Persist to DB so Pi sessions survive server restart
          try { await claimClaudeSessionId(sessionId, esid); } catch {}
        }
        // Update turn_count, files_edited in DB + server-side auto-name
        try {
          const currentSession = await getSession(sessionId);
          if (currentSession) {
            const newTurnCount = (currentSession.turnCount ?? 0) + 1;
            const existingFiles: string[] = currentSession.filesEdited || [];
            const newFiles = towerMsg.editedFiles || [];
            const mergedFiles = [...new Set([...existingFiles, ...newFiles])];
            await updateSession(sessionId, {
              turnCount: newTurnCount,
              filesEdited: mergedFiles,
              modelUsed: towerMsg.model || data.model,
            });

            // Server-side auto-name: runs regardless of frontend WS subscription.
            // Only name sessions with default "Session ..." names (first turn only).
            if (currentSession.name?.startsWith('Session ') && currentSession.autoNamed !== 0) {
              try {
                const msgs = await getMessages(sessionId);
                const userMsg = msgs.find((m: any) => m.role === 'user');
                const assistantMsg = msgs.find((m: any) => m.role === 'assistant');
                if (userMsg && assistantMsg) {
                  const userText = extractTextFromContent(userMsg.content);
                  const assistantText = extractTextFromContent(assistantMsg.content);
                  const name = await generateSessionName(userText, assistantText);
                  await updateSession(sessionId, { name, autoNamed: 1 } as any);
                  // Notify all clients so sidebar updates immediately
                  broadcastToAll({ type: 'session_meta_update', sessionId, updates: { name } });
                  console.log(`[auto-name] server-side named session=${sessionId.slice(0, 8)} → "${name}"`);
                }
              } catch (err: any) {
                console.warn(`[auto-name] server-side failed for session=${sessionId.slice(0, 8)}:`, err.message);
              }
            }
          }
        } catch {}
      }
    }
  } catch (error: any) {
    console.error(`[ws] handleChat ERROR session=${sessionId}:`, error.message || error);
    broadcastToSession(sessionId, {
      type: 'error',
      message: error.message || 'Engine query failed',
      sessionId,
    });
  } finally {
    console.log(`[ws] handleChat END session=${sessionId.slice(0, 8)} engine=${engineName}`);
    if (hangTimer) clearTimeout(hangTimer);
    broadcastToAll({ type: 'session_status', sessionId, status: 'idle' });
  }
}

function handleAnswerQuestion(client: WsClient, data: { questionId: string; answer: string; sessionId?: string }) {
  const sessionId = data.sessionId || client.sessionId;
  if (resolvePendingQuestionLocally(data.questionId, data.answer, sessionId)) {
    if (sessionId) {
      remotePendingQuestionsBySession.delete(sessionId);
    }
    return;
  }

  if (!sessionId || !isPgEnabled()) return;

  remotePendingQuestionsBySession.delete(sessionId);
  publishWsSyncEvent(config.serverEpoch, {
    scope: 'session',
    sessionId,
    data: {
      type: 'answer_question_sync',
      questionId: data.questionId,
      answer: data.answer,
    },
  });
}

async function handleAbort(client: WsClient, data: { sessionId?: string }) {
  const sessionId = data.sessionId || client.sessionId;
  if (sessionId) {
    console.log(`[ws] handleAbort session=${sessionId} client=${client.id}`);
    cancelPendingQuestionsForSession(sessionId, 'Session aborted');
    // Resolve engine and abort
    await abortSessionEverywhere(sessionId);
    if (isPgEnabled()) {
      publishWsSyncEvent(config.serverEpoch, {
        scope: 'session',
        sessionId,
        data: { type: 'abort_session_sync' },
      });
    }
    remoteStreamingSessions.delete(sessionId);
    remotePendingQuestionsBySession.delete(sessionId);
    // Pure: bump epoch + remove this client from session routing
    abortCleanup(client, sessionClients, sessionId);
    send(client.ws, { type: 'abort_result', aborted: true, sessionId });
  }
}

async function handleFileRead(client: WsClient, data: { path: string }) {
  try {
    if (client.allowedPath && !isPathSafe(data.path, client.allowedPath)) {
      send(client.ws, { type: 'error', message: 'Access denied: outside allowed path' });
      return;
    }
    // Project-level path check (same as HTTP /files/read)
    if (client.userId) {
      const pathOk = await isPathAccessible(data.path, client.userId, client.userRole || 'member');
      if (!pathOk) {
        send(client.ws, { type: 'error', message: 'Access denied: project path' });
        return;
      }
    }
    // Binary files (PDF, images): send metadata only — frontend fetches via HTTP API
    const ext = data.path.split('.').pop()?.toLowerCase() || '';
    const binaryExts = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'mp4', 'webm', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt']);
    if (binaryExts.has(ext)) {
      const langMap: Record<string, string> = { pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', ico: 'image', mp4: 'video', webm: 'video', docx: 'docx', doc: 'docx', xlsx: 'xlsx', xls: 'xlsx', pptx: 'pptx', ppt: 'pptx' };
      console.log(`[ws] binary file detected: ${data.path} (${ext})`);
      send(client.ws, {
        type: 'file_content',
        path: data.path,
        content: '',
        language: langMap[ext] || 'binary',
        encoding: 'binary',
      });
      return;
    }
    const result = readFile(data.path);
    send(client.ws, {
      type: 'file_content',
      path: data.path,
      content: result.content,
      language: result.language,
    });
  } catch (error: any) {
    send(client.ws, { type: 'error', message: error.message });
  }
}

async function handleFileWrite(client: WsClient, data: { path: string; content: string }) {
  try {
    if (client.allowedPath && !isPathSafe(data.path, client.allowedPath)) {
      send(client.ws, { type: 'error', message: 'Access denied: outside allowed path' });
      return;
    }
    // Project-level path check (same as HTTP /files/write)
    if (client.userId) {
      const pathOk = await isPathAccessible(data.path, client.userId, client.userRole || 'member');
      if (!pathOk) {
        send(client.ws, { type: 'error', message: 'Access denied: project path' });
        return;
      }
    }
    writeFile(data.path, data.content);
    send(client.ws, {
      type: 'file_saved',
      path: data.path,
    });
  } catch (error: any) {
    send(client.ws, { type: 'error', message: error.message });
  }
}

function handleFileTree(client: WsClient, data: { path?: string; showHidden?: boolean }) {
  try {
    const securityRoot = client.allowedPath || config.workspaceRoot;
    // Admin's allowedPath is homedir (broad access), but default tree should show workspace
    const defaultRoot = client.userRole === 'admin' ? config.workspaceRoot : securityRoot;
    const targetPath = data.path || defaultRoot;
    if (!isPathSafe(targetPath, securityRoot)) {
      send(client.ws, { type: 'error', message: 'Access denied: outside allowed path' });
      return;
    }
    const entries = getFileTree(targetPath, 2, { showHidden: !!data.showHidden });
    send(client.ws, {
      type: 'file_tree',
      path: targetPath,
      entries,
    });
  } catch (error: any) {
    send(client.ws, { type: 'error', message: error.message });
  }
}

// ── Chat Room Handlers ──────────────────────────────────────────────────

async function handleRoomJoin(client: WsClient, data: { roomId: string }) {
  if (!isPgEnabled()) {
    send(client.ws, { type: 'error', message: 'Chat rooms require PostgreSQL (DATABASE_URL not set)' });
    return;
  }
  // Verify membership before allowing WS subscription
  if (client.userId) {
    const access = await canAccessRoom(data.roomId, client.userId, client.userRole || 'member');
    if (!access.allowed) {
      send(client.ws, { type: 'error', message: 'Access denied: not a room member' });
      return;
    }
  }
  const roomClient: RoomClient = { id: client.id, joinedRooms: client.joinedRooms };
  addRoomClient(roomClients, roomClient, data.roomId);
  send(client.ws, { type: 'room_joined', roomId: data.roomId });
}

function handleRoomLeave(client: WsClient, data: { roomId: string }) {
  const roomClient: RoomClient = { id: client.id, joinedRooms: client.joinedRooms };
  removeRoomClient(roomClients, roomClient, data.roomId);
  send(client.ws, { type: 'room_left', roomId: data.roomId });
}

async function handleRoomMessage(client: WsClient, data: { roomId: string; content: string; mentions?: string[]; replyTo?: string; clientMsgId?: string }) {
  if (!isPgEnabled()) {
    send(client.ws, { type: 'error', message: 'Chat rooms require PostgreSQL' });
    return;
  }
  if (!client.userId) {
    send(client.ws, { type: 'error', message: 'Authentication required' });
    return;
  }
  if (!data.content?.trim()) {
    send(client.ws, { type: 'error', message: 'Empty message' });
    return;
  }

  try {
    // Dynamic import to avoid loading PG modules when not needed
    const { getMemberRole } = await import('../services/room-manager.js');

    // Check membership
    const memberRole = await getMemberRole(data.roomId, client.userId);
    if (!memberRole) {
      send(client.ws, { type: 'error', message: 'Not a member of this room' });
      return;
    }
    if (memberRole === 'readonly') {
      send(client.ws, { type: 'error', message: 'Read-only members cannot send messages' });
      return;
    }

    // Insert message via room-manager (with sender_id for proper attribution)
    const { sendMessage } = await import('../services/room-manager.js');
    const savedMsg = await sendMessage(
      data.roomId,
      client.userId,
      data.content,
      'human',
      {
        mentions: data.mentions || [],
        ...(data.replyTo ? { reply_to: data.replyTo } : {}),
      },
    );
    const messageId = savedMsg.id;

    // Broadcast to all room subscribers (clients that have room_join'd)
    const roomMessage = {
      type: 'room_message',
      roomId: data.roomId,
      message: {
        id: messageId,
        roomId: data.roomId,
        senderId: client.userId,
        senderName: client.username,
        msgType: 'human',
        content: data.content,
        metadata: { mentions: data.mentions || [] },
        replyTo: data.replyTo || null,
        createdAt: new Date().toISOString(),
        ...(data.clientMsgId ? { clientMsgId: data.clientMsgId } : {}),
      },
    };
    broadcastToRoom(data.roomId, roomMessage);

    // Also notify room members who are NOT currently viewing this room
    // so their unread counts update in real time on the main screen
    const { getMembers } = await import('../services/room-manager.js');
    const members = await getMembers(data.roomId);
    const joinedClientIds = getRoomClientIds(roomClients, data.roomId);
    for (const member of members) {
      if (member.userId === client.userId) continue; // skip sender
      // Check if this member already received the message via broadcastToRoom
      let alreadyReceived = false;
      for (const cid of joinedClientIds) {
        const c = clients.get(cid);
        if (c && c.userId === member.userId) { alreadyReceived = true; break; }
      }
      if (!alreadyReceived) {
        broadcastToUser(member.userId, roomMessage);
      }
    }

    // ─── @user mentions → notifications ───
    const userMentionRegex = /@(\w+)/g;
    let userMentionMatch: RegExpExecArray | null;
    const mentionedUsernames = new Set<string>();
    while ((userMentionMatch = userMentionRegex.exec(data.content)) !== null) {
      const uname = userMentionMatch[1].toLowerCase();
      if (uname !== 'ai' && uname !== 'task') {
        mentionedUsernames.add(uname);
      }
    }
    if (mentionedUsernames.size > 0) {
      try {
        const { notifyMany } = await import('../services/notification-hub.js');
        const { getRoom: getRoomForMention } = await import('../services/room-manager.js');
        const mentionRoom = await getRoomForMention(data.roomId);
        const roomName = mentionRoom?.name || 'a room';

        // Collect all mentioned user IDs (skip self) then notify in a single batch.
        // Previously this was a sequential `await notify()` loop — at 50 members
        // with heavy mentions that stalled the PG pool for hundreds of ms.
        const mentionedUserIds = members
          .filter(m => m.userId !== client.userId && mentionedUsernames.has(m.username.toLowerCase()))
          .map(m => m.userId);

        if (mentionedUserIds.length > 0) {
          await notifyMany(
            mentionedUserIds,
            data.roomId,
            'mention',
            `${client.username || 'Someone'} mentioned you in #${roomName}`,
            data.content.length > 100 ? data.content.slice(0, 100) + '...' : data.content,
            { senderId: client.userId, senderName: client.username, messageId },
          );
        }
      } catch (mentionErr: any) {
        console.error('[ws] mention notification error:', mentionErr.message);
      }
    }

    // Check for @ai or @task mention
    const mentionRegex = /(^|[\s])@(ai|task)\b/i;
    if (data.mentions?.includes('ai') || data.mentions?.includes('task') || mentionRegex.test(data.content)) {
      const { parseAiMention, checkRateLimit, checkConcurrentLimit, checkAiCallPermission, recordAiCall } = await import('../services/ai-dispatch.js');

      const mention = parseAiMention(data.content);

      if (mention.found && !mention.prompt) {
        // @ai or @task with no prompt — send hint
        broadcastToRoom(data.roomId, {
          type: 'room_message',
          roomId: data.roomId,
          message: {
            id: `sys-${Date.now()}`,
            roomId: data.roomId,
            senderId: null,
            msgType: 'system',
            content: mention.mentionType === 'ai'
              ? '@ai 뒤에 질문을 입력하세요. 예: @ai 이 프로젝트 구조 설명해줘'
              : '@task 뒤에 할 일을 입력하세요. 예: @task 로그 수집 스크립트 만들어줘',
            metadata: {},
            createdAt: new Date().toISOString(),
          },
        });
        return;
      }

      if (mention.found && mention.prompt) {
        // Permission check
        const permCheck = checkAiCallPermission(
          (client.userRole || 'member') as any,
          memberRole as any,
        );
        if (!permCheck.allowed) {
          broadcastToRoom(data.roomId, {
            type: 'room_message',
            roomId: data.roomId,
            message: {
              id: `sys-${Date.now()}`,
              roomId: data.roomId,
              senderId: null,
              msgType: 'system',
              content: permCheck.reason || 'Permission denied',
              metadata: {},
              createdAt: new Date().toISOString(),
            },
          });
          return;
        }

        // Rate limit check (shared between @ai and @task)
        const rateResult = checkRateLimit(client.userId, data.roomId);
        if (!rateResult.allowed) {
          const waitSec = Math.ceil((rateResult.retryAfterMs || 0) / 1000);
          send(client.ws, { type: 'error', errorCode: 'RATE_LIMIT', message: `요청이 너무 빠릅니다. ${waitSec}초 후에 다시 시도해주세요.` });
          return;
        }

        recordAiCall(client.userId, data.roomId);

        if (mention.mentionType === 'ai') {
          // ─── @ai /reset: Clear persistent AI session ───
          if (mention.prompt.trim().toLowerCase() === '/reset') {
            const { handleAiReset } = await import('../services/ai-quick-reply.js');
            handleAiReset(data.roomId, broadcastToRoom).catch(err => {
              console.error('[ws] AI reset failed:', err.message);
            });
            return;
          }

          // ─── @ai: Persistent channel reply ───
          const { getRoom: fetchRoom } = await import('../services/room-manager.js');
          const room = await fetchRoom(data.roomId);
          const { handleAiQuickReply } = await import('../services/ai-quick-reply.js');
          handleAiQuickReply({
            roomId: data.roomId,
            roomName: room?.name || data.roomId,
            prompt: mention.prompt,
            userId: client.userId,
            username: client.username || 'unknown',
            messageId,
            replyTo: data.replyTo,
            broadcastToRoom,
          }).catch(err => {
            console.error('[ws] AI quick reply failed:', err.message);
          });
        } else {
          // ─── @task: Full task execution ───
          const concResult = checkConcurrentLimit(data.roomId);
          if (!concResult.allowed) {
            send(client.ws, { type: 'error', message: `Room has ${concResult.runningCount}/${concResult.limit} AI tasks running. Please wait.` });
            return;
          }

          const { createTask } = await import('../services/task-manager.js');
          const taskTitle = mention.prompt.slice(0, 80) || '@task';

          const { getRoom: fetchRoom } = await import('../services/room-manager.js');
          const room = await fetchRoom(data.roomId);
          const taskCwd = room?.projectId ? config.defaultCwd : config.defaultCwd; // TODO: resolve project root_path

          const task = await createTask(
            taskTitle,
            mention.prompt,
            taskCwd,
            client.userId,
            undefined, undefined, undefined, undefined, undefined,
            { roomId: data.roomId, triggeredBy: client.userId, roomMessageId: messageId },
          );

          // Post task_ref message to room
          const taskRefMsg = await sendMessage(
            data.roomId,
            null,
            `Task "${taskTitle}" registered`,
            'ai_task_ref',
            { task_id: task.id, status: 'todo' },
            task.id,
          );

          broadcastToRoom(data.roomId, {
            type: 'room_message',
            roomId: data.roomId,
            message: {
              id: taskRefMsg.id,
              roomId: data.roomId,
              senderId: null,
              msgType: 'ai_task_ref',
              content: `Task "${taskTitle}" registered`,
              metadata: { task_id: task.id, status: 'todo' },
              createdAt: new Date().toISOString(),
            },
          });

          // Spawn task (fire-and-forget) — room tasks use acceptEdits
          spawnTask(task.id, (type, payload) => {
            broadcastToAll({ type, ...payload });
            // Also notify room when task completes
            if (type === 'task_update' && (payload.status === 'done' || payload.status === 'failed')) {
              broadcastToRoom(data.roomId, {
                type: 'room_ai_status',
                roomId: data.roomId,
                taskId: task.id,
                status: payload.status,
              });
            }
          }, client.userId, client.userRole, client.allowedPath).catch(err => {
            console.error(`[ws] Room task spawn failed:`, err.message);
            broadcastToRoom(data.roomId, {
              type: 'room_message',
              roomId: data.roomId,
              message: {
                id: `err-${Date.now()}`,
                roomId: data.roomId,
                senderId: null,
                msgType: 'ai_error',
                content: `Task failed to start: ${err.message}`,
                metadata: { task_id: task.id, error: err.message },
                createdAt: new Date().toISOString(),
              },
            });
          });
        }
      }
    }
  } catch (err: any) {
    console.error('[ws] handleRoomMessage error:', err.message);
    send(client.ws, { type: 'error', message: err.message || 'Failed to send message' });
  }
}

function handleRoomTyping(client: WsClient, data: { roomId: string }) {
  if (!client.userId || !client.joinedRooms.has(data.roomId)) return;
  broadcastToRoom(data.roomId, {
    type: 'room_typing',
    roomId: data.roomId,
    userId: client.userId,
    username: client.username,
  }, client.id); // exclude sender
}

async function handleRoomRead(client: WsClient, data: { roomId: string }) {
  if (!client.userId || !isPgEnabled()) return;
  try {
    const { updateLastRead } = await import('../services/room-manager.js');
    await updateLastRead(data.roomId, client.userId);
  } catch (err: any) {
    console.error('[ws] handleRoomRead error:', err.message);
  }
}

/**
 * Broadcast a message to ALL clients of a specific user (by userId).
 * Used for member-added notifications so the invited user sees the room immediately.
 */
export function broadcastToUser(userId: number, data: any) {
  localBroadcastToUser(userId, data);
  if (!isPgEnabled()) return;
  publishWsSyncEvent(config.serverEpoch, { scope: 'user', userId, data });
}

async function handleShareToChannel(client: WsClient, data: { roomId: string; sessionId: string; messageId: string; content: string }) {
  if (!isPgEnabled() || !client.userId) {
    send(client.ws, { type: 'error', message: 'Cannot share: PG not enabled or not authenticated' });
    return;
  }
  try {
    const { getMemberRole, sendMessage } = await import('../services/room-manager.js');
    const memberRole = await getMemberRole(data.roomId, client.userId);
    if (!memberRole || memberRole === 'readonly') {
      send(client.ws, { type: 'error', message: 'Not authorized to share to this channel' });
      return;
    }

    const savedMsg = await sendMessage(
      data.roomId,
      client.userId,
      data.content,
      'ai_summary',
      { shared_from_panel: true, thread_id: data.sessionId, source_message_id: data.messageId },
    );

    broadcastToRoom(data.roomId, {
      type: 'room_message',
      roomId: data.roomId,
      message: {
        id: savedMsg.id,
        roomId: data.roomId,
        senderId: client.userId,
        senderName: client.username,
        msgType: 'ai_summary',
        content: data.content,
        metadata: { shared_from_panel: true, thread_id: data.sessionId },
        createdAt: new Date().toISOString(),
      },
    });

    send(client.ws, { type: 'share_to_channel_ok', messageId: data.messageId });
  } catch (err: any) {
    send(client.ws, { type: 'error', message: err.message || 'Failed to share to channel' });
  }
}

export { broadcastToRoom, broadcastToSession };

/**
 * Server-side auto-resume for interrupted sessions.
 * Called once at startup — resumes sessions that were streaming when the server shut down,
 * WITHOUT waiting for a client WebSocket reconnect.
 *
 * This fixes the gap where background-only sessions (or sessions with no active browser tab)
 * would be permanently lost because no client ever sent a `reconnect` message for them.
 */
export async function serverSideResumeInterrupted() {
  const details: Array<{ id: string; claudeSessionId?: string }> | undefined =
    (globalThis as any).__interruptedSessionDetails;
  if (!details || details.length === 0) return;

  // Clear so this only runs once
  delete (globalThis as any).__interruptedSessionDetails;

  const RESUME_PROMPT =
    'The server was just restarted. Your previous task was interrupted mid-stream. ' +
    'If you were running a server restart, deployment, or build command — it already completed successfully, do NOT re-run it. ' +
    'Review where you left off and continue with the next step.';

  for (const { id: sessionId, claudeSessionId: savedClaudeSessionId } of details) {
    // Don't block startup — fire and forget each resume
    (async () => {
      try {
        const dbSession = await getSession(sessionId);
        if (!dbSession) {
          console.log(`[auto-resume] session=${sessionId.slice(0, 8)} not found in DB — skipping`);
          return;
        }

        // Consume from the client-side set so handleReconnect stops returning 'interrupted'
        const interruptedSet: Set<string> | undefined = (globalThis as any).__interruptedSessions;
        interruptedSet?.delete(sessionId);

        const engineName = (dbSession as any)?.engine || config.defaultEngine || 'claude';
        const engine = await getEngine(engineName);

        // Skip if engine is already running for this session (shouldn't happen, but guard)
        if (engine.isRunning(sessionId)) {
          console.log(`[auto-resume] session=${sessionId.slice(0, 8)} already running — skipping`);
          return;
        }

        // Check concurrent limit
        if (getTotalActiveCount() >= config.maxConcurrentSessions) {
          console.warn(`[auto-resume] session=${sessionId.slice(0, 8)} skipped — concurrent limit reached`);
          return;
        }

        const engineSessionId = savedClaudeSessionId || dbSession.claudeSessionId || undefined;
        if (!engineSessionId) {
          console.log(`[auto-resume] session=${sessionId.slice(0, 8)} has no claudeSessionId — skipping`);
          return;
        }

        console.log(`[auto-resume] resuming session=${sessionId.slice(0, 8)} engine=${engineName} claudeSid=${engineSessionId?.slice(0, 11)}`);

        // Save user message to DB
        const userMsgId = uuidv4();
        try {
          await saveMessage(sessionId, {
            id: userMsgId,
            role: 'user',
            content: [{ type: 'text', text: RESUME_PROMPT }],
            username: '[server]',
          });
        } catch (err) { console.error('[auto-resume] saveMessage (user) failed:', err); }

        // Broadcast streaming status
        broadcastToAll({ type: 'session_status', sessionId, status: 'streaming' });

        // Engine callbacks — same as handleChat but without a specific client
        const callbacks: EngineCallbacks = {
          askUser: (_questionId: string, questions: any[]) => {
            // No client to ask — auto-respond
            const questionSummary = questions.map((q: any) => q.question || q).join(', ');
            return Promise.resolve(
              `[System] The server auto-resumed this session after a restart. There is no active user to answer interactive prompts. ` +
              `Your question was: "${questionSummary}". ` +
              `Please proceed with a reasonable default, or ask the question as a regular chat message for when the user returns.`
            );
          },
          claimSessionId: async (esid: string) => {
            try { await claimClaudeSessionId(sessionId, esid); } catch {}
          },
          saveMessage: async (msg) => {
            try { await saveMessage(sessionId, msg); } catch {}
          },
          updateMessageContent: async (msgId, content) => {
            try { await updateMessageContent(msgId, content); } catch {}
          },
          attachToolResult: async (toolUseId, result) => {
            try { await attachToolResultInDb(sessionId, toolUseId, result); } catch {}
            broadcastToSession(sessionId, {
              type: 'tool_result_attached',
              sessionId,
              toolUseId,
              result: typeof result === 'string' ? result.slice(0, 500) : String(result).slice(0, 500),
            });
          },
          updateMessageMetrics: async (msgId, metrics) => {
            try {
              await updateMessageMetrics(msgId, {
                duration_ms: metrics.durationMs,
                input_tokens: metrics.inputTokens,
                output_tokens: metrics.outputTokens,
              });
            } catch {}
          },
        };

        // Hang detection
        let hangTimer: ReturnType<typeof setTimeout> | null = null;
        const resetHangTimer = () => {
          if (hangTimer) clearTimeout(hangTimer);
          hangTimer = setTimeout(() => {
            engine.abort(sessionId);
            broadcastToSession(sessionId, {
              type: 'error',
              message: 'SDK response timed out during auto-resume.',
              errorCode: 'SDK_HANG',
              sessionId,
            });
          }, SDK_HANG_TIMEOUT);
        };

        try {
          resetHangTimer();

          for await (const towerMsg of engine.run(sessionId, RESUME_PROMPT, {
            cwd: dbSession.cwd || config.defaultCwd,
            engineSessionId,
            projectId: (dbSession as any)?.projectId || undefined,
          }, callbacks)) {
            resetHangTimer();

            broadcastTowerMessage(sessionId, towerMsg);
            const terminalMsg = towerToLegacyTerminal(towerMsg, sessionId);
            if (terminalMsg) {
              broadcastToSession(sessionId, terminalMsg);
            }

            // Update session metadata on engine_done
            if (towerMsg.type === 'engine_done') {
              const esid = towerMsg.engineSessionId;
              if (esid) {
                try { await claimClaudeSessionId(sessionId, esid); } catch {}
              }
              try {
                const currentSession = await getSession(sessionId);
                if (currentSession) {
                  const newTurnCount = (currentSession.turnCount ?? 0) + 1;
                  const existingFiles: string[] = currentSession.filesEdited || [];
                  const newFiles = towerMsg.editedFiles || [];
                  const mergedFiles = [...new Set([...existingFiles, ...newFiles])];
                  await updateSession(sessionId, {
                    turnCount: newTurnCount,
                    filesEdited: mergedFiles,
                    modelUsed: towerMsg.model,
                  });
                }
              } catch {}
            }
          }
        } catch (error: any) {
          console.error(`[auto-resume] ERROR session=${sessionId.slice(0, 8)}:`, error.message || error);
          broadcastToSession(sessionId, {
            type: 'error',
            message: error.message || 'Auto-resume failed',
            sessionId,
          });
        } finally {
          if (hangTimer) clearTimeout(hangTimer);
          broadcastToAll({ type: 'session_status', sessionId, status: 'idle' });
          console.log(`[auto-resume] END session=${sessionId.slice(0, 8)}`);
        }
      } catch (err: any) {
        console.error(`[auto-resume] FATAL session=${sessionId.slice(0, 8)}:`, err.message || err);
      }
    })();

    // Stagger resumes by 2s to avoid overwhelming concurrent session limit
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

function send(ws: WebSocket, data: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
