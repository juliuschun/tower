import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { executeQuery, abortSession, cleanupSession, getClaudeSessionId, getActiveSessionCount, getSession as getSDKSession } from '../services/claude-sdk.js';
import { getFileTree, readFile, writeFile, setupFileWatcher, type FileChangeEvent } from '../services/file-system.js';
import { verifyWsToken } from '../services/auth.js';
import { saveMessage, updateMessageContent, attachToolResultInDb } from '../services/message-store.js';
import { getSession, updateSession } from '../services/session-manager.js';
import { config, getPermissionMode } from '../config.js';
import { autoCommit } from '../services/git-manager.js';
import { isEpochStale, resolveSessionClient, switchSession, abortCleanup, type SessionClient } from './session-guards.js';

interface WsClient {
  id: string;
  ws: WebSocket;
  sessionId?: string;       // our platform session ID
  claudeSessionId?: string; // Claude SDK session ID for resume
  userRole?: string;        // role from JWT (admin/user)
  userId?: number;          // user ID from JWT
  username?: string;        // username from JWT
  activeQueryEpoch: number; // incremented on each new query / session switch
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
const sessionClients = new Map<string, string>(); // sessionId → clientId
const pendingQuestions = new Map<string, PendingQuestion>(); // questionId → PendingQuestion

function sendToSession(sessionId: string, data: any) {
  const c = resolveSessionClient(sessionClients, clients, sessionId);
  if (!c) return;
  if (c.ws.readyState === WebSocket.OPEN) {
    c.ws.send(JSON.stringify(data));
  }
}

/**
 * Send directly to the client that started the streaming.
 * Falls back to session routing only when the originating WS is dead (reconnection case).
 * This prevents other tabs from "stealing" streaming messages via the session map.
 */
function sendToClient(client: WsClient, sessionId: string, data: any) {
  const payload = JSON.stringify(data);
  if (client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(payload);
  } else {
    // Client disconnected — try reconnected client via session map
    const reconnected = resolveSessionClient(sessionClients, clients, sessionId);
    if (reconnected && reconnected.ws.readyState === WebSocket.OPEN) {
      reconnected.ws.send(payload);
    }
    // If no reconnected client, message is saved to DB anyway
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
          sendToSession(sessionId, { type: 'ask_user_timeout', sessionId, questionId });
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

      // Send question to frontend
      sendToSession(sessionId, {
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
      // Only remove from sessionClients if SDK is NOT running (allow reconnect to take over)
      if (client.sessionId) {
        const sdkSession = getSDKSession(client.sessionId);
        if (!sdkSession?.isRunning) {
          // SDK idle — clean up session mapping
          if (sessionClients.get(client.sessionId) === clientId) {
            sessionClients.delete(client.sessionId);
          }
        }
        // If SDK is running, keep sessionClients entry — reconnecting client will replace it
      }
    });

    ws.on('error', () => {
      if (client.sessionId && sessionClients.get(client.sessionId) === clientId) {
        const sdkSession = getSDKSession(client.sessionId);
        if (!sdkSession?.isRunning) {
          sessionClients.delete(client.sessionId);
        }
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

  // Register new client for this session
  sessionClients.set(sessionId, client.id);

  // Check if SDK is still running for this session
  const sdkSession = getSDKSession(sessionId);
  if (sdkSession?.isRunning) {
    send(client.ws, { type: 'reconnect_result', status: 'streaming', sessionId });

    // Re-send any pending questions for this session
    for (const pq of pendingQuestions.values()) {
      if (pq.sessionId === sessionId) {
        send(client.ws, {
          type: 'ask_user',
          sessionId,
          questionId: pq.questionId,
          questions: pq.questions,
        });
      }
    }
  } else {
    send(client.ws, { type: 'reconnect_result', status: 'idle', sessionId });
  }
}

function handleSetActiveSession(client: WsClient, data: { sessionId: string; claudeSessionId?: string }) {
  const oldSessionId = client.sessionId;
  const newSessionId = data.sessionId;

  if (oldSessionId && oldSessionId !== newSessionId) {
    // Don't abort running sessions here — another tab might own the streaming.
    // The streaming loop's epoch guard will abort when THIS client's epoch bumps.
    // Only cleanup finished (idle) sessions to free resources.
    const sdkSession = getSDKSession(oldSessionId);
    if (sdkSession && !sdkSession.isRunning) {
      cleanupSession(oldSessionId);
    }
  }

  // Pure: clean old mapping, bump epoch, set new session
  switchSession(client, sessionClients, oldSessionId, newSessionId);

  // Always sync claudeSessionId to the new session (clear if not provided)
  client.claudeSessionId = data.claudeSessionId || undefined;

  send(client.ws, { type: 'set_active_session_ack', sessionId: newSessionId });
}

async function handleChat(client: WsClient, data: { message: string; messageId?: string; sessionId?: string; claudeSessionId?: string; cwd?: string; model?: string }) {
  const sessionId = data.sessionId || client.sessionId || uuidv4();
  client.sessionId = sessionId;

  // Register this client as the active sender for this session
  sessionClients.set(sessionId, client.id);

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

  // Increment epoch — invalidates any prior running loop for this client
  const myEpoch = ++client.activeQueryEpoch;

  // Use claudeSessionId from the message only — never fall back to client-level state
  // to prevent session A's claudeSessionId leaking into session B
  const resumeSessionId = data.claudeSessionId || undefined;
  let currentAssistantId: string | null = null;
  let currentAssistantContent: any[] = [];
  const editedFiles = new Set<string>();

  // Hang detection timer
  let hangTimer: ReturnType<typeof setTimeout> | null = null;
  const resetHangTimer = () => {
    if (hangTimer) clearTimeout(hangTimer);
    hangTimer = setTimeout(() => {
      abortSession(sessionId);
      sendToClient(client, sessionId, {
        type: 'error',
        message: 'SDK 응답 시간 초과 (5분). 세션을 중단했습니다.',
        errorCode: 'SDK_HANG',
        sessionId,
      });
    }, SDK_HANG_TIMEOUT);
  };

  try {
    const permissionMode = getPermissionMode(client.userRole);
    resetHangTimer();

    // Create canUseTool to intercept AskUserQuestion
    const canUseTool = createCanUseTool(sessionId);

    for await (const message of executeQuery(sessionId, data.message, {
      cwd: data.cwd || config.defaultCwd,
      resumeSessionId,
      permissionMode,
      model: data.model,
      canUseTool,
    })) {
      // GUARD: Client switched session or started a new query — stop this stale loop
      if (isEpochStale(client, myEpoch)) {
        abortSession(sessionId);
        break;
      }

      // Reset hang timer on each message
      resetHangTimer();
      // Track Claude session ID for future resume
      if ('session_id' in message && message.session_id) {
        client.claudeSessionId = message.session_id;
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

      sendToClient(client, sessionId, {
        type: 'sdk_message',
        sessionId,
        data: message,
      });
    }

    // Client switched away during streaming — don't send sdk_done to wrong session
    if (isEpochStale(client, myEpoch)) return;

    // Get final Claude session ID
    const claudeId = getClaudeSessionId(sessionId);
    if (claudeId) {
      client.claudeSessionId = claudeId;
    }

    // Update turn_count and files_edited in DB
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
        });
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

    sendToClient(client, sessionId, {
      type: 'sdk_done',
      sessionId,
      claudeSessionId: client.claudeSessionId,
    });
  } catch (error: any) {
    sendToClient(client, sessionId, {
      type: 'error',
      message: error.message || 'Claude query failed',
      sessionId,
    });
  } finally {
    if (hangTimer) clearTimeout(hangTimer);
  }
}

function handleAnswerQuestion(_client: WsClient, data: { questionId: string; answer: string }) {
  const pq = pendingQuestions.get(data.questionId);
  if (pq) {
    pq.resolve(data.answer);
  }
}

function handleAbort(client: WsClient, data: { sessionId?: string }) {
  const sessionId = data.sessionId || client.sessionId;
  if (sessionId) {
    const aborted = abortSession(sessionId);
    // Pure: bump epoch + clean up session routing
    abortCleanup(client, sessionClients, sessionId);
    send(client.ws, { type: 'abort_result', aborted, sessionId });
  }
}

function handleFileRead(client: WsClient, data: { path: string }) {
  try {
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
    const entries = getFileTree(data.path || config.workspaceRoot);
    send(client.ws, {
      type: 'file_tree',
      path: data.path || config.workspaceRoot,
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
