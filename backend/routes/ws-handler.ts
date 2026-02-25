import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import { executeQuery, abortSession, cleanupSession, getClaudeSessionId, getActiveSessionCount, getSession as getSDKSession } from '../services/claude-sdk.js';
import { getFileTree, readFile, writeFile, setupFileWatcher, type FileChangeEvent } from '../services/file-system.js';
import { verifyWsToken, getUserAllowedPath } from '../services/auth.js';
import { isPathSafe } from '../services/file-system.js';
import { saveMessage, updateMessageContent, attachToolResultInDb } from '../services/message-store.js';
import { getSession, updateSession } from '../services/session-manager.js';
import { config, getPermissionMode } from '../config.js';
import { autoCommit } from '../services/git-manager.js';
import { findSessionClient, abortCleanup, addSessionClient, removeSessionClient, type SessionClient } from './session-guards.js';

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
}

interface PendingQuestion {
  questionId: string;
  sessionId: string;
  questions: any[];
  resolve: (answer: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

const SDK_HANG_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const ASK_USER_TIMEOUT = 5 * 60 * 1000; // 5 minutes

const clients = new Map<string, WsClient>();
const sessionClients = new Map<string, Set<string>>(); // sessionId → Set<clientId> (1:many)
const pendingQuestions = new Map<string, PendingQuestion>(); // questionId → PendingQuestion

/**
 * Broadcast a message to ALL connected clients (regardless of session).
 * Used for session status updates that affect the sidebar.
 */
function broadcastToAll(data: any) {
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

function createCanUseTool(sessionId: string) {
  return async (toolName: string, input: Record<string, unknown>, options: { signal: AbortSignal }) => {
    // Allow all tools except AskUserQuestion
    if (toolName !== 'AskUserQuestion') {
      return { behavior: 'allow' as const, updatedInput: input };
    }

    // Intercept AskUserQuestion — send to frontend and wait for user response
    const questionId = `q-${uuidv4()}`;
    const questions = (input as any).questions || [];

    return new Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string; interrupt?: boolean }>((resolve) => {
      // Auto-select first option on timeout
      const timer = setTimeout(() => {
        const pq = pendingQuestions.get(questionId);
        if (pq) {
          pendingQuestions.delete(questionId);
          const defaultAnswer = questions.map((q: any) => {
            const firstOpt = q.options?.[0]?.label || 'No response';
            return `${q.question}: ${firstOpt}`;
          }).join('\n');
          broadcastToSession(sessionId, { type: 'ask_user_timeout', sessionId, questionId });
          resolve({ behavior: 'deny', message: `User did not respond in time. Auto-selected: ${defaultAnswer}` });
        }
      }, ASK_USER_TIMEOUT);

      pendingQuestions.set(questionId, {
        questionId,
        sessionId,
        questions,
        resolve: (answer: string) => {
          clearTimeout(timer);
          pendingQuestions.delete(questionId);
          resolve({ behavior: 'deny', message: `User responded: ${answer}` });
        },
        timer,
      });

      // Clean up on abort
      options.signal.addEventListener('abort', () => {
        const pq = pendingQuestions.get(questionId);
        if (pq) {
          clearTimeout(pq.timer);
          pendingQuestions.delete(questionId);
          resolve({ behavior: 'deny', message: 'Session aborted', interrupt: true });
        }
      }, { once: true });

      // Broadcast question to ALL tabs viewing this session — first answer wins
      broadcastToSession(sessionId, {
        type: 'ask_user',
        sessionId,
        questionId,
        questions,
      });
    });
  };
}

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
    const client: WsClient = { id: clientId, ws, activeQueryEpoch: 0 };

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

    send(ws, { type: 'connected', clientId, serverEpoch: config.serverEpoch });

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
    });

    ws.on('error', () => {
      if (client.sessionId) {
        removeSessionClient(sessionClients, client.sessionId, clientId);
      }
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
  const sessionId = data.sessionId || client.sessionId || uuidv4();
  client.sessionId = sessionId;
  console.log(`[ws] handleChat START session=${sessionId.slice(0, 8)} client=${client.id.slice(0, 8)} resume=${data.claudeSessionId?.slice(0, 12) || 'none'} activeSDK=${getActiveSessionCount()}`);

  // Add this client to the session's viewer set
  addSessionClient(sessionClients, sessionId, client.id);

  // Guard: reject if SDK is already running for this session
  const sdkSession = getSDKSession(sessionId);
  if (sdkSession?.isRunning) {
    sendToClient(client, sessionId, {
      type: 'error',
      message: '이 세션에서 이미 대화가 진행 중입니다. 완료될 때까지 기다려주세요.',
      errorCode: 'SESSION_BUSY',
      sessionId,
    });
    return;
  }

  // Check concurrent session limit
  if (getActiveSessionCount() >= config.maxConcurrentSessions) {
    sendToClient(client, sessionId, {
      type: 'error',
      message: `동시 세션 한도 초과 (최대 ${config.maxConcurrentSessions}개)`,
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

  // Use claudeSessionId from the message only — never fall back to client-level state
  // to prevent session A's claudeSessionId leaking into session B
  const resumeSessionId = data.claudeSessionId || undefined;
  let loopClaudeSessionId: string | undefined; // track locally — client may switch sessions mid-stream
  let currentAssistantId: string | null = null;
  let currentAssistantContent: any[] = [];
  const editedFiles = new Set<string>();

  // Hang detection timer
  let hangTimer: ReturnType<typeof setTimeout> | null = null;
  const resetHangTimer = () => {
    if (hangTimer) clearTimeout(hangTimer);
    hangTimer = setTimeout(() => {
      abortSession(sessionId);
      broadcastToSession(sessionId, {
        type: 'error',
        message: 'SDK 응답 시간 초과 (5분). 세션을 중단했습니다.',
        errorCode: 'SDK_HANG',
        sessionId,
      });
    }, SDK_HANG_TIMEOUT);
  };

  // Notify all clients that this session started streaming (for sidebar indicators)
  broadcastToAll({ type: 'session_status', sessionId, status: 'streaming' });

  try {
    const permissionMode = getPermissionMode(client.userRole);
    resetHangTimer();

    // Create canUseTool to intercept AskUserQuestion
    const canUseTool = createCanUseTool(sessionId);

    for await (const message of executeQuery(sessionId, data.message, {
      cwd: data.cwd || client.allowedPath || config.defaultCwd,
      resumeSessionId,
      permissionMode,
      model: data.model,
      canUseTool,
    })) {
      // Reset hang timer on each message
      resetHangTimer();
      // Track Claude session ID locally (NOT on client — client may have switched sessions)
      if ('session_id' in message && message.session_id) {
        loopClaudeSessionId = message.session_id;
      }

      // Save tool results to DB (from SDK user messages)
      if ((message as any).type === 'user') {
        const userContent = (message as any).message?.content;
        if (Array.isArray(userContent)) {
          for (const block of userContent) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              const resultText = typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.map((c: any) => c.text || '').join('\n')
                  : JSON.stringify(block.content);
              const structured = (message as any).tool_use_result;
              const finalResult = structured?.stdout || structured?.stderr
                ? [structured.stdout, structured.stderr].filter(Boolean).join('\n')
                : resultText;
              try { attachToolResultInDb(sessionId, block.tool_use_id, finalResult); } catch (err) { console.error('[ws] attachToolResultInDb failed:', err); }
            }
          }
        }
      }

      // Save assistant messages to DB
      if ((message as any).type === 'assistant') {
        const msgId = (message as any).uuid || uuidv4();
        const content = (message as any).message?.content || [];
        if (msgId !== currentAssistantId) {
          // New assistant message
          currentAssistantId = msgId;
          currentAssistantContent = content;
          try {
            saveMessage(sessionId, {
              id: msgId,
              role: 'assistant',
              content,
              parentToolUseId: (message as any).parent_tool_use_id,
            });
          } catch (err) { console.error('[ws] saveMessage (assistant) failed:', err); }
        } else {
          // Streaming update
          currentAssistantContent = content;
          try {
            updateMessageContent(msgId, content);
          } catch (err) { console.error('[ws] updateMessageContent failed:', err); }
        }
      }

      // Track edited files from tool_use blocks
      if ((message as any).type === 'assistant') {
        const content = (message as any).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use') {
              const toolName = block.name?.toLowerCase() || '';
              if ((toolName === 'write' || toolName === 'edit') && block.input?.file_path) {
                editedFiles.add(block.input.file_path);
              }
            }
          }
        }
      }

      // Broadcast to ALL tabs viewing this session
      broadcastToSession(sessionId, {
        type: 'sdk_message',
        sessionId,
        data: message,
      });
    }

    // Get final Claude session ID (prefer SDK's value, fall back to loop-tracked value)
    const finalClaudeSessionId = getClaudeSessionId(sessionId) || loopClaudeSessionId;
    // Only update client if still on the same session (avoid cross-contamination)
    if (client.sessionId === sessionId && finalClaudeSessionId) {
      client.claudeSessionId = finalClaudeSessionId;
    }

    // Update turn_count, files_edited, and claudeSessionId in DB
    try {
      const currentSession = getSession(sessionId);
      if (currentSession) {
        const newTurnCount = (currentSession.turnCount ?? 0) + 1;
        const existingFiles: string[] = currentSession.filesEdited || [];
        const mergedFiles = [...new Set([...existingFiles, ...editedFiles])];
        updateSession(sessionId, {
          turnCount: newTurnCount,
          filesEdited: mergedFiles,
          modelUsed: data.model,
          ...(finalClaudeSessionId ? { claudeSessionId: finalClaudeSessionId } : {}),
        });
        if (finalClaudeSessionId) {
          console.log(`[ws] persisted claudeSessionId=${finalClaudeSessionId.slice(0, 12)}… for session=${sessionId.slice(0, 8)}`);
        }
      }
    } catch (err) { console.error('[ws] updateSession failed:', err); }

    // Auto-commit edited files
    if (config.gitAutoCommit && editedFiles.size > 0) {
      try {
        const commitResult = await autoCommit(
          config.workspaceRoot,
          client.username || 'anonymous',
          sessionId,
          [...editedFiles]
        );
        if (commitResult) {
          broadcast({ type: 'git_commit', commit: commitResult });
        }
      } catch (err) {
        console.error('[Git] Auto-commit failed:', err);
      }
    }

    // Broadcast done to ALL tabs viewing this session
    broadcastToSession(sessionId, {
      type: 'sdk_done',
      sessionId,
      claudeSessionId: finalClaudeSessionId,
    });
  } catch (error: any) {
    console.error(`[ws] handleChat ERROR session=${sessionId}:`, error.message || error);
    broadcastToSession(sessionId, {
      type: 'error',
      message: error.message || 'Claude query failed',
      sessionId,
    });
  } finally {
    console.log(`[ws] handleChat END session=${sessionId.slice(0, 8)} claudeSid=${finalClaudeSessionId?.slice(0, 12) || 'none'}`);
    if (hangTimer) clearTimeout(hangTimer);
    // Notify all clients that this session stopped streaming
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

function handleAbort(client: WsClient, data: { sessionId?: string }) {
  const sessionId = data.sessionId || client.sessionId;
  if (sessionId) {
    console.log(`[ws] handleAbort session=${sessionId} client=${client.id}`);
    const aborted = abortSession(sessionId);
    // Pure: bump epoch + remove this client from session routing
    abortCleanup(client, sessionClients, sessionId);
    send(client.ws, { type: 'abort_result', aborted, sessionId });
  }
}

function handleFileRead(client: WsClient, data: { path: string }) {
  try {
    if (client.allowedPath && !isPathSafe(data.path, client.allowedPath)) {
      send(client.ws, { type: 'error', message: 'Access denied: outside allowed path' });
      return;
    }
    const result = readFile(data.path);
    // For binary files (PDF, images), send minimal metadata — frontend fetches via HTTP
    if (result.encoding === 'base64') {
      send(client.ws, {
        type: 'file_content',
        path: data.path,
        content: '',
        language: result.language,
        encoding: 'binary',
      });
    } else {
      send(client.ws, {
        type: 'file_content',
        path: data.path,
        content: result.content,
        language: result.language,
      });
    }
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
    const root = client.allowedPath || config.workspaceRoot;
    const targetPath = data.path || root;
    if (!isPathSafe(targetPath, root)) {
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

function send(ws: WebSocket, data: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
