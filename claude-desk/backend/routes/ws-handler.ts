import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { executeQuery, abortSession, getClaudeSessionId } from '../services/claude-sdk.js';
import { getFileTree, readFile, writeFile } from '../services/file-system.js';
import { verifyWsToken } from '../services/auth.js';
import { config } from '../config.js';

interface WsClient {
  id: string;
  ws: WebSocket;
  sessionId?: string;       // our platform session ID
  claudeSessionId?: string; // Claude SDK session ID for resume
}

const clients = new Map<string, WsClient>();

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info) => {
      if (!config.authEnabled) return true;
      const url = new URL(info.req.url || '', 'ws://localhost');
      const token = url.searchParams.get('token');
      return !!verifyWsToken(token);
    },
  });

  wss.on('connection', (ws, req) => {
    const clientId = uuidv4();
    const client: WsClient = { id: clientId, ws };
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

async function handleChat(client: WsClient, data: { message: string; sessionId?: string; cwd?: string }) {
  const sessionId = data.sessionId || client.sessionId || uuidv4();
  client.sessionId = sessionId;

  // Determine resume session ID: if we have a Claude session ID for this session, use it
  const resumeSessionId = client.claudeSessionId;

  try {
    for await (const message of executeQuery(sessionId, data.message, {
      cwd: data.cwd || config.defaultCwd,
      resumeSessionId,
    })) {
      // Track Claude session ID for future resume
      if ('session_id' in message && message.session_id) {
        client.claudeSessionId = message.session_id;
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
