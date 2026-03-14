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
import { saveMessage, updateMessageContent, attachToolResultInDb, updateMessageMetrics } from '../services/message-store.js';
import { getSession, updateSession } from '../services/session-manager.js';
import { getDb } from '../db/schema.js';
import { config } from '../config.js';
import { findSessionClient, abortCleanup, addSessionClient, removeSessionClient } from './session-guards.js';
import { spawnTask, abortTask } from '../services/task-runner.js';
// damage-control moved to engines/claude-engine.ts
import { getTasks } from '../services/task-manager.js';
import { addRoomClient, removeRoomClient, removeClientFromAllRooms, getRoomClientIds } from '../services/room-guards.js';
import type { RoomClient } from '../services/room-guards.js';
import { isPgEnabled } from '../db/pg.js';

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
  timer: ReturnType<typeof setTimeout>;
}

const SDK_HANG_TIMEOUT = 60 * 60 * 1000; // 60 minutes
const ASK_USER_TIMEOUT = 60 * 60 * 1000; // 60 minutes

const clients = new Map<string, WsClient>();
const sessionClients = new Map<string, Set<string>>(); // sessionId → Set<clientId> (1:many)
const pendingQuestions = new Map<string, PendingQuestion>(); // questionId → PendingQuestion
const roomClients = new Map<string, Set<string>>(); // roomId → Set<clientId>

/**
 * Claim a claudeSessionId for a Tower session.
 * If another session already holds it, clear theirs first (Tower = SSOT, latest wins).
 */
function claimClaudeSessionId(towerSessionId: string, claudeSessionId: string) {
  const db = getDb();
  db.prepare(
    `UPDATE sessions SET claude_session_id = NULL
     WHERE claude_session_id = ? AND id != ?`
  ).run(claudeSessionId, towerSessionId);
  updateSession(towerSessionId, { claudeSessionId });
}

/**
 * Legacy bridge: convert TowerMessage → old frontend WS format.
 * Temporary — removed in Phase 3 when frontend handles TowerMessage directly.
 */
function towerToLegacy(msg: TowerMessage, sessionId: string): any {
  switch (msg.type) {
    case 'assistant':
      // Convert TowerContentBlock[] back to SDK content format
      return {
        type: 'sdk_message',
        sessionId,
        data: {
          type: 'assistant',
          uuid: msg.msgId,
          message: {
            content: msg.content.map(b => {
              if (b.type === 'text') return { type: 'text', text: b.text };
              if (b.type === 'thinking') return { type: 'thinking', thinking: b.text };
              if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
              return b;
            }),
          },
          parent_tool_use_id: msg.parentToolUseId,
          session_id: sessionId,
        },
      };
    case 'turn_done':
      return {
        type: 'sdk_message',
        sessionId,
        data: {
          type: 'result',
          duration_ms: msg.usage.durationMs,
          usage: {
            input_tokens: msg.usage.inputTokens,
            output_tokens: msg.usage.outputTokens,
          },
        },
      };
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
      };
    default:
      return null;
  }
}

/**
 * Broadcast a message to ALL connected clients (regardless of session).
 * Used for session status updates that affect the sidebar.
 */
export function broadcastToAll(data: any) {
  const payload = JSON.stringify(data);
  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

/**
 * Broadcast a message to ALL clients viewing a session.
 * Used for streaming messages (sdk_message, sdk_done, ask_user, errors).
 */
function broadcastToSession(sessionId: string, data: any) {
  const clientIds = sessionClients.get(sessionId);
  if (!clientIds) return;
  const payload = JSON.stringify(data);
  for (const clientId of clientIds) {
    const client = clients.get(clientId);
    if (client?.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

/**
 * Broadcast a message to ALL clients subscribed to a room.
 * Used for chat room messages, typing indicators, and AI status updates.
 */
function broadcastToRoom(roomId: string, data: any, excludeClientId?: string) {
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
  const payload = JSON.stringify(data);
  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

export function setupWebSocket(server: Server) {
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

  wss.on('connection', (ws, req) => {
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
            : getUserAllowedPath(client.userId);
        }
      }
    }

    clients.set(clientId, client);

    send(ws, { type: 'connected', clientId, serverEpoch: config.serverEpoch, streamingSessions: getAllRunningSessionIds() });

    // ── Protocol-level ping (binary frame) ──────────────────────────────
    // Cloudflare and mobile networks need WS protocol pings to keep alive.
    // App-level JSON ping alone isn't enough — Cloudflare may still timeout.
    let isAlive = true;
    ws.on('pong', () => { isAlive = true; });       // browser auto-replies pong
    const pingInterval = setInterval(() => {
      if (!isAlive) { ws.terminate(); return; }      // dead connection → force close
      isAlive = false;
      ws.ping();                                      // binary ping frame
    }, 25_000);                                       // 25s < Cloudflare's ~100s timeout
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
        await spawnTask(taskId, (type, payload) => broadcastToAll({ type, ...payload }), client.userId, client.userRole, client.allowedPath);
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
      const tasks = getTasks(client.userId, client.userRole);
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

  // Check if SDK is still running for this session
  const sdkSession = getSDKSession(sessionId);

  // Find pending question for this session
  let pendingQ: { questionId: string; questions: any[] } | undefined;
  for (const pq of pendingQuestions.values()) {
    if (pq.sessionId === sessionId) {
      pendingQ = { questionId: pq.questionId, questions: pq.questions };
      break;
    }
  }

  if (sdkSession?.isRunning) {
    send(client.ws, {
      type: 'reconnect_result',
      status: 'streaming',
      sessionId,
      pendingQuestion: pendingQ || null,
    });
  } else {
    send(client.ws, { type: 'reconnect_result', status: 'idle', sessionId });
  }
}

function handleSetActiveSession(client: WsClient, data: { sessionId: string; claudeSessionId?: string }) {
  const oldSessionId = client.sessionId;
  const newSessionId = data.sessionId;
  console.log(`[ws] setActiveSession old=${oldSessionId} new=${newSessionId} client=${client.id}`);

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

  // Include streaming status + any pending questions in the ack
  const targetSdkSession = getSDKSession(newSessionId);

  // Find pending question for this session
  let pendingQ: { questionId: string; questions: any[] } | undefined;
  for (const pq of pendingQuestions.values()) {
    if (pq.sessionId === newSessionId) {
      pendingQ = { questionId: pq.questionId, questions: pq.questions };
      break;
    }
  }

  send(client.ws, {
    type: 'set_active_session_ack',
    sessionId: newSessionId,
    isStreaming: !!targetSdkSession?.isRunning,
    pendingQuestion: pendingQ || null,
  });
}

async function handleChat(client: WsClient, data: { message: string; messageId?: string; sessionId?: string; claudeSessionId?: string; cwd?: string; model?: string }) {
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
  client.sessionId = sessionId;

  // Add this client to the session's viewer set
  addSessionClient(sessionClients, sessionId, client.id);

  // Resolve engine for this session
  let dbSession: ReturnType<typeof getSession> | undefined;
  try { dbSession = getSession(sessionId); } catch {}
  const engineName = (dbSession as any)?.engine || config.defaultEngine || 'claude';
  const engine = await getEngine(engineName);

  console.log(`[ws] handleChat START session=${sessionId.slice(0, 8)} client=${client.id.slice(0, 8)} engine=${engineName} active=${getTotalActiveCount()}`);

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
    saveMessage(sessionId, {
      id: userMsgId,
      role: 'user',
      content: [{ type: 'text', text: data.message }],
    });
  } catch (err) { console.error('[ws] saveMessage (user) failed:', err); }

  // Resume session ID (engine-specific, stored in DB)
  const engineSessionId = data.claudeSessionId || dbSession?.claudeSessionId || undefined;

  // Engine callbacks — ws-handler owns WS routing and DB access
  const callbacks: EngineCallbacks = {
    askUser: (questionId: string, questions: any[]) => {
      return new Promise<string>((resolve) => {
        const timer = setTimeout(() => {
          const pq = pendingQuestions.get(questionId);
          if (pq) {
            pendingQuestions.delete(questionId);
            broadcastToSession(sessionId, { type: 'ask_user_timeout', sessionId, questionId });
            // Auto-select first option
            const defaultAnswers = questions.map((q: any) =>
              `${q.question}: ${q.options?.[0]?.label || 'No response'}`
            ).join('\n');
            resolve(defaultAnswers);
          }
        }, ASK_USER_TIMEOUT);

        pendingQuestions.set(questionId, {
          questionId,
          sessionId,
          questions,
          resolve: (answer: string) => {
            clearTimeout(timer);
            pendingQuestions.delete(questionId);
            resolve(answer);
          },
          timer,
        });

        // Broadcast question to ALL tabs viewing this session
        broadcastToSession(sessionId, {
          type: 'ask_user',
          sessionId,
          questionId,
          questions,
        });
      });
    },
    claimSessionId: (esid: string) => {
      try { claimClaudeSessionId(sessionId, esid); } catch {}
    },
    saveMessage: (msg) => {
      try { saveMessage(sessionId, msg); } catch {}
    },
    updateMessageContent: (msgId, content) => {
      try { updateMessageContent(msgId, content); } catch {}
    },
    attachToolResult: (toolUseId, result) => {
      try { attachToolResultInDb(sessionId, toolUseId, result); } catch {}
    },
    updateMessageMetrics: (msgId, metrics) => {
      try {
        updateMessageMetrics(msgId, {
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

  // Notify all clients that this session started streaming
  broadcastToAll({ type: 'session_status', sessionId, status: 'streaming' });

  try {
    resetHangTimer();

    for await (const towerMsg of engine.run(sessionId, data.message, {
      cwd: data.cwd || dbSession?.cwd || client.allowedPath || config.defaultCwd,
      model: data.model,
      userId: client.userId,
      username: client.username,
      userRole: client.userRole,
      allowedPath: client.allowedPath,
      engineSessionId,
    }, callbacks)) {
      resetHangTimer();

      // ── Legacy bridge: convert TowerMessage → old frontend format ──
      // This will be removed in Phase 3 when frontend handles TowerMessage directly.
      const legacyMsg = towerToLegacy(towerMsg, sessionId);
      if (legacyMsg) {
        broadcastToSession(sessionId, legacyMsg);
      }

      // Update session metadata on engine_done
      if (towerMsg.type === 'engine_done') {
        const esid = towerMsg.engineSessionId;
        if (client.sessionId === sessionId && esid) {
          client.claudeSessionId = esid;
        }
        // Update turn_count, files_edited in DB
        try {
          const currentSession = getSession(sessionId);
          if (currentSession) {
            const newTurnCount = (currentSession.turnCount ?? 0) + 1;
            const existingFiles: string[] = currentSession.filesEdited || [];
            const newFiles = towerMsg.editedFiles || [];
            const mergedFiles = [...new Set([...existingFiles, ...newFiles])];
            updateSession(sessionId, {
              turnCount: newTurnCount,
              filesEdited: mergedFiles,
              modelUsed: towerMsg.model || data.model,
            });
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
  // Try exact match first
  const pq = pendingQuestions.get(data.questionId);
  if (pq) {
    pq.resolve(data.answer);
    return;
  }

  // Fallback: find any pending question for this session (orphaned question recovery)
  const sessionId = data.sessionId || client.sessionId;
  if (sessionId) {
    for (const [, entry] of pendingQuestions) {
      if (entry.sessionId === sessionId) {
        entry.resolve(data.answer);
        return;
      }
    }
  }
}

async function handleAbort(client: WsClient, data: { sessionId?: string }) {
  const sessionId = data.sessionId || client.sessionId;
  if (sessionId) {
    console.log(`[ws] handleAbort session=${sessionId} client=${client.id}`);
    // Resolve engine and abort
    let dbSession: ReturnType<typeof getSession> | undefined;
    try { dbSession = getSession(sessionId); } catch {}
    const engineName = (dbSession as any)?.engine || config.defaultEngine || 'claude';
    try {
      const engine = await getEngine(engineName);
      engine.abort(sessionId);
    } catch {}
    // Pure: bump epoch + remove this client from session routing
    abortCleanup(client, sessionClients, sessionId);
    send(client.ws, { type: 'abort_result', aborted: true, sessionId });
  }
}

function handleFileRead(client: WsClient, data: { path: string }) {
  try {
    if (client.allowedPath && !isPathSafe(data.path, client.allowedPath)) {
      send(client.ws, { type: 'error', message: 'Access denied: outside allowed path' });
      return;
    }
    // Binary files (PDF, images): send metadata only — frontend fetches via HTTP API
    const ext = data.path.split('.').pop()?.toLowerCase() || '';
    const binaryExts = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'mp4', 'webm']);
    if (binaryExts.has(ext)) {
      const langMap: Record<string, string> = { pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', ico: 'image', mp4: 'video', webm: 'video' };
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

function handleFileWrite(client: WsClient, data: { path: string; content: string }) {
  try {
    if (client.allowedPath && !isPathSafe(data.path, client.allowedPath)) {
      send(client.ws, { type: 'error', message: 'Access denied: outside allowed path' });
      return;
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

function handleFileTree(client: WsClient, data: { path?: string }) {
  try {
    const securityRoot = client.allowedPath || config.workspaceRoot;
    // Admin's allowedPath is homedir (broad access), but default tree should show workspace
    const defaultRoot = client.userRole === 'admin' ? config.workspaceRoot : securityRoot;
    const targetPath = data.path || defaultRoot;
    if (!isPathSafe(targetPath, securityRoot)) {
      send(client.ws, { type: 'error', message: 'Access denied: outside allowed path' });
      return;
    }
    const entries = getFileTree(targetPath);
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

function handleRoomJoin(client: WsClient, data: { roomId: string }) {
  if (!isPgEnabled()) {
    send(client.ws, { type: 'error', message: 'Chat rooms require PostgreSQL (DATABASE_URL not set)' });
    return;
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

async function handleRoomMessage(client: WsClient, data: { roomId: string; content: string; mentions?: string[]; replyTo?: string }) {
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

    // Check for @ai mention
    if (data.mentions?.includes('ai') || data.content.match(/(^|[\s])@ai\b/i)) {
      const { parseAiMention, checkRateLimit, checkConcurrentLimit, checkAiCallPermission, recordAiCall } = await import('../services/ai-dispatch.js');
      const mention = parseAiMention(data.content);

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

        // Rate limit check
        const rateResult = checkRateLimit(client.userId, data.roomId);
        if (!rateResult.allowed) {
          send(client.ws, { type: 'error', message: `Rate limit exceeded (${rateResult.reason}). Retry after ${Math.ceil((rateResult.retryAfterMs || 0) / 1000)}s` });
          return;
        }

        // Concurrent limit check
        const concResult = checkConcurrentLimit(data.roomId);
        if (!concResult.allowed) {
          send(client.ws, { type: 'error', message: `Room has ${concResult.runningCount}/${concResult.limit} AI tasks running. Please wait.` });
          return;
        }

        // Record the call for rate limiting
        recordAiCall(client.userId, data.roomId);

        // Create task via task-manager
        const { createTask } = await import('../services/task-manager.js');
        const taskTitle = mention.prompt.slice(0, 80) || '@ai task';

        // Determine CWD from room's project (if any)
        const { getRoom: fetchRoom } = await import('../services/room-manager.js');
        const room = await fetchRoom(data.roomId);
        const taskCwd = room?.projectId ? config.defaultCwd : config.defaultCwd; // TODO: resolve project root_path

        const task = createTask(
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
        const taskRefId = taskRefMsg.id;

        broadcastToRoom(data.roomId, {
          type: 'room_message',
          roomId: data.roomId,
          message: {
            id: taskRefId,
            roomId: data.roomId,
            senderId: null,
            msgType: 'ai_task_ref',
            content: `Task "${taskTitle}" registered`,
            metadata: { task_id: task.id, status: 'todo' },
            createdAt: new Date().toISOString(),
          },
        });

        // Spawn task (fire-and-forget) — room tasks use acceptEdits (capped in task-runner)
        // Spawn with room-aware broadcast
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
  const payload = JSON.stringify(data);
  for (const client of clients.values()) {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

export { broadcastToRoom };

function send(ws: WebSocket, data: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
