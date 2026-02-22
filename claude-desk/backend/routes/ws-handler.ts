import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { executeQuery, abortSession, getClaudeSessionId, getActiveSessionCount } from '../services/claude-sdk.js';
import { getFileTree, readFile, writeFile, setupFileWatcher, type FileChangeEvent } from '../services/file-system.js';
import { verifyWsToken } from '../services/auth.js';
import { saveMessage, updateMessageContent, attachToolResultInDb } from '../services/message-store.js';
import { getSession, updateSession } from '../services/session-manager.js';
import { config, getPermissionMode } from '../config.js';

interface WsClient {
  id: string;
  ws: WebSocket;
  sessionId?: string;       // our platform session ID
  claudeSessionId?: string; // Claude SDK session ID for resume
  userRole?: string;        // role from JWT (admin/user)
}

const SDK_HANG_TIMEOUT = 5 * 60 * 1000; // 5 minutes

const clients = new Map<string, WsClient>();

function broadcast(data: any) {
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
    const client: WsClient = { id: clientId, ws };

    // Extract user role from JWT token
    if (config.authEnabled) {
      const url = new URL(req.url || '', 'ws://localhost');
      const token = url.searchParams.get('token');
      const payload = verifyWsToken(token);
      if (payload && typeof payload === 'object' && 'role' in payload) {
        client.userRole = (payload as any).role;
      }
    }

    clients.set(clientId, client);

    send(ws, { type: 'connected', clientId });

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
    });

    ws.on('error', () => {
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
    case 'ping':
      send(client.ws, { type: 'pong' });
      break;
    default:
      send(client.ws, { type: 'error', message: `Unknown message type: ${data.type}` });
  }
}

async function handleChat(client: WsClient, data: { message: string; messageId?: string; sessionId?: string; claudeSessionId?: string; cwd?: string; model?: string }) {
  const sessionId = data.sessionId || client.sessionId || uuidv4();
  client.sessionId = sessionId;

  // Check concurrent session limit
  if (getActiveSessionCount() >= config.maxConcurrentSessions) {
    send(client.ws, {
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
  } catch {}

  // Use claudeSessionId from the message (per-session) over client-level (per-connection)
  const resumeSessionId = data.claudeSessionId || client.claudeSessionId;
  let currentAssistantId: string | null = null;
  let currentAssistantContent: any[] = [];
  const editedFiles = new Set<string>();

  // Hang detection timer
  let hangTimer: ReturnType<typeof setTimeout> | null = null;
  const resetHangTimer = () => {
    if (hangTimer) clearTimeout(hangTimer);
    hangTimer = setTimeout(() => {
      abortSession(sessionId);
      send(client.ws, {
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

    for await (const message of executeQuery(sessionId, data.message, {
      cwd: data.cwd || config.defaultCwd,
      resumeSessionId,
      permissionMode,
      model: data.model,
    })) {
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
              try { attachToolResultInDb(sessionId, block.tool_use_id, finalResult); } catch {}
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
          } catch {}
        } else {
          // Streaming update
          currentAssistantContent = content;
          try {
            updateMessageContent(msgId, content);
          } catch {}
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

      send(client.ws, {
        type: 'sdk_message',
        sessionId,
        data: message,
      });
    }

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
    } catch {}

    send(client.ws, {
      type: 'sdk_done',
      sessionId,
      claudeSessionId: client.claudeSessionId,
    });
  } catch (error: any) {
    send(client.ws, {
      type: 'error',
      message: error.message || 'Claude query failed',
      sessionId,
    });
  } finally {
    if (hangTimer) clearTimeout(hangTimer);
  }
}

function handleAbort(client: WsClient, data: { sessionId?: string }) {
  const sessionId = data.sessionId || client.sessionId;
  if (sessionId) {
    const aborted = abortSession(sessionId);
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
