import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server } from 'http';
import { WebSocket } from 'ws';

// ── Mocks (must be before dynamic import) ──────────────────────────

const mockExecuteQuery = vi.fn();
const mockAbortSession = vi.fn(() => true);
const mockCleanupSession = vi.fn();
const mockGetClaudeSessionId = vi.fn();
const mockGetActiveSessionCount = vi.fn(() => 0);
const mockGetSDKSession = vi.fn((): { isRunning: boolean } | undefined => undefined);
const mockPublishWsSyncEvent = vi.fn();
const mockInitWsSync = vi.fn(async (_origin: string, handlers: any) => {
  capturedWsSyncHandlers = handlers;
});
let capturedWsSyncHandlers: any = null;

vi.mock('../services/claude-sdk.js', () => ({
  executeQuery: mockExecuteQuery,
  abortSession: mockAbortSession,
  cleanupSession: mockCleanupSession,
  getClaudeSessionId: mockGetClaudeSessionId,
  getActiveSessionCount: mockGetActiveSessionCount,
  getSession: mockGetSDKSession,
  getRunningSessionIds: vi.fn(() => []),
  backupSessionFile: vi.fn(),
}));

const mockSaveMessage = vi.fn();
vi.mock('../services/message-store.js', () => ({
  saveMessage: mockSaveMessage,
  updateMessageContent: vi.fn(),
  attachToolResultInDb: vi.fn(),
  updateMessageMetrics: vi.fn(),
}));

vi.mock('../services/session-manager.js', () => ({
  getSession: vi.fn(() => null),
  updateSession: vi.fn(),
}));

vi.mock('../services/file-system.js', () => ({
  getFileTree: vi.fn(() => []),
  readFile: vi.fn(() => ({ content: '', language: 'text' })),
  writeFile: vi.fn(),
  setupFileWatcher: vi.fn(),
}));

vi.mock('../services/git-manager.js', () => ({
  autoCommit: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../services/auth.js', () => ({
  verifyWsToken: vi.fn(() => null),
  getUserAllowedPath: vi.fn(() => null),
}));

vi.mock('../db/pg-repo.js', () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => undefined),
  execute: vi.fn(async () => ({ changes: 0 })),
}));

vi.mock('../services/task-runner.js', () => ({
  spawnTask: vi.fn(),
  abortTask: vi.fn(),
}));

vi.mock('../services/damage-control.js', () => ({
  buildDamageControl: vi.fn(() => () => true),
  buildPathEnforcement: vi.fn(() => null),
}));

vi.mock('../services/system-prompt.js', () => ({
  buildSystemPrompt: vi.fn(() => 'test system prompt'),
}));

vi.mock('../services/task-manager.js', () => ({
  getTasks: vi.fn(() => []),
}));

vi.mock('../config.js', () => ({
  config: {
    authEnabled: false,
    workspaceRoot: '/tmp/test',
    defaultCwd: '/tmp/test',
    maxConcurrentSessions: 5,
    serverEpoch: 'test-epoch',
    gitAutoCommit: false,
  },
  getPermissionMode: vi.fn(() => 'default'),
}));

vi.mock('../db/pg.js', () => ({
  isPgEnabled: vi.fn(() => true),
}));

vi.mock('../services/ws-sync.js', () => ({
  initWsSync: mockInitWsSync,
  publishWsSyncEvent: mockPublishWsSyncEvent,
}));

// ── Helpers ─────────────────────────────────────────────────────────

let server: Server;
let serverPort: number;
let setupWebSocket: (s: Server) => any;

function createWsClient(): Promise<{ ws: WebSocket; messages: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);
    const messages: any[] = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

function waitForMessage(
  messages: any[],
  type: string,
  timeout = 2000,
): Promise<any> {
  const found = messages.find((m) => m.type === type);
  if (found) return Promise.resolve(found);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${type}"`)), timeout);
    const interval = setInterval(() => {
      const msg = messages.find((m) => m.type === type);
      if (msg) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve(msg);
      }
    }, 20);
  });
}

function waitForMessages(
  messages: any[],
  type: string,
  count: number,
  timeout = 2000,
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${count}x "${type}"`)), timeout);
    const interval = setInterval(() => {
      const found = messages.filter((m) => m.type === type);
      if (found.length >= count) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve(found);
      }
    }, 20);
  });
}

function sendJson(ws: WebSocket, data: any) {
  ws.send(JSON.stringify(data));
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Setup ───────────────────────────────────────────────────────────

beforeAll(async () => {
  const mod = await import('./ws-handler.js');
  setupWebSocket = mod.setupWebSocket;

  server = createServer();
  setupWebSocket(server);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      serverPort = (server.address() as any).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('ws-handler integration', () => {
  describe('connection', () => {
    it('sends connected message with clientId on connection', async () => {
      const { ws, messages } = await createWsClient();
      const msg = await waitForMessage(messages, 'connected');

      expect(msg.type).toBe('connected');
      expect(msg.clientId).toBeTruthy();
      expect(msg.serverEpoch).toBe('test-epoch');

      ws.close();
    });
  });

  describe('set_active_session', () => {
    it('sends ack and cleans up idle session on switch (no abort of running sessions)', async () => {
      const { ws, messages } = await createWsClient();
      await waitForMessage(messages, 'connected');

      // Set first session
      sendJson(ws, { type: 'set_active_session', sessionId: 's1' });
      await waitForMessage(messages, 'set_active_session_ack');

      // Switch to second session → old idle session should be cleaned up but NOT aborted
      mockGetSDKSession.mockReturnValueOnce({ isRunning: false });
      sendJson(ws, { type: 'set_active_session', sessionId: 's2' });
      const ack = await waitForMessages(messages, 'set_active_session_ack', 2);

      expect(ack[1].sessionId).toBe('s2');
      expect(mockAbortSession).not.toHaveBeenCalled();

      ws.close();
    });

    it('does not abort when re-setting the same session', async () => {
      const { ws, messages } = await createWsClient();
      await waitForMessage(messages, 'connected');

      sendJson(ws, { type: 'set_active_session', sessionId: 's1' });
      await waitForMessage(messages, 'set_active_session_ack');

      mockAbortSession.mockClear();

      sendJson(ws, { type: 'set_active_session', sessionId: 's1' });
      await waitForMessages(messages, 'set_active_session_ack', 2);

      expect(mockAbortSession).not.toHaveBeenCalled();

      ws.close();
    });
  });

  describe('chat + routing', () => {
    it('does NOT route sdk_message to clients on a different session', async () => {
      // Client A on session s1
      const clientA = await createWsClient();
      await waitForMessage(clientA.messages, 'connected');
      sendJson(clientA.ws, { type: 'set_active_session', sessionId: 's1' });
      await waitForMessage(clientA.messages, 'set_active_session_ack');

      // Client B on session s2
      const clientB = await createWsClient();
      await waitForMessage(clientB.messages, 'connected');
      sendJson(clientB.ws, { type: 'set_active_session', sessionId: 's2' });
      await waitForMessage(clientB.messages, 'set_active_session_ack');

      // Mock executeQuery to yield one message for s1
      mockExecuteQuery.mockImplementationOnce(async function* () {
        yield { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'hi' }] } };
      });

      sendJson(clientA.ws, { type: 'chat', message: 'hello', sessionId: 's1' });

      // Client A should get sdk_message
      await waitForMessage(clientA.messages, 'sdk_message');

      // Wait a bit then check client B did NOT get sdk_message (different session)
      await delay(200);
      const bSdkMsgs = clientB.messages.filter((m) => m.type === 'sdk_message');
      expect(bSdkMsgs.length).toBe(0);

      clientA.ws.close();
      clientB.ws.close();
    });

    it('broadcasts sdk_message to ALL clients viewing the same session', async () => {
      // Client A on session s1
      const clientA = await createWsClient();
      await waitForMessage(clientA.messages, 'connected');
      sendJson(clientA.ws, { type: 'set_active_session', sessionId: 's1' });
      await waitForMessage(clientA.messages, 'set_active_session_ack');

      // Client B also on session s1 (second tab)
      const clientB = await createWsClient();
      await waitForMessage(clientB.messages, 'connected');
      sendJson(clientB.ws, { type: 'set_active_session', sessionId: 's1' });
      await waitForMessage(clientB.messages, 'set_active_session_ack');

      // Mock executeQuery to yield one message
      mockExecuteQuery.mockImplementationOnce(async function* () {
        yield { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'hi' }] } };
      });

      sendJson(clientA.ws, { type: 'chat', message: 'hello', sessionId: 's1' });

      // BOTH clients should get sdk_message
      await waitForMessage(clientA.messages, 'sdk_message');
      await waitForMessage(clientB.messages, 'sdk_message');

      // Both should also get sdk_done
      await waitForMessage(clientA.messages, 'sdk_done');
      await waitForMessage(clientB.messages, 'sdk_done');

      clientA.ws.close();
      clientB.ws.close();
    });
  });

  describe('session switch mid-stream', () => {
    it('streaming continues in background when client switches sessions', async () => {
      // Client A starts chat on s1, then switches to s2
      const clientA = await createWsClient();
      await waitForMessage(clientA.messages, 'connected');
      sendJson(clientA.ws, { type: 'set_active_session', sessionId: 's1' });
      await waitForMessage(clientA.messages, 'set_active_session_ack');

      // Client B stays on s1 to verify messages keep arriving
      const clientB = await createWsClient();
      await waitForMessage(clientB.messages, 'connected');
      sendJson(clientB.ws, { type: 'set_active_session', sessionId: 's1' });
      await waitForMessage(clientB.messages, 'set_active_session_ack');

      // Mock a slow generator that yields multiple messages
      let yielded = 0;
      mockExecuteQuery.mockImplementationOnce(async function* () {
        yield { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'first' }] } };
        yielded++;
        await new Promise((r) => setTimeout(r, 100));
        yield { type: 'assistant', uuid: 'a2', message: { content: [{ type: 'text', text: 'second' }] } };
        yielded++;
        await new Promise((r) => setTimeout(r, 100));
        yield { type: 'assistant', uuid: 'a3', message: { content: [{ type: 'text', text: 'third' }] } };
        yielded++;
      });

      sendJson(clientA.ws, { type: 'chat', message: 'start long query', sessionId: 's1' });

      // Wait for first sdk_message on client A
      await waitForMessage(clientA.messages, 'sdk_message');

      // Client A switches session mid-stream — streaming should NOT be aborted
      mockGetSDKSession.mockReturnValueOnce({ isRunning: false });
      sendJson(clientA.ws, { type: 'set_active_session', sessionId: 's2' });
      await waitForMessage(clientA.messages, 'set_active_session_ack');

      // Client B (still on s1) should receive all 3 messages + sdk_done
      await waitForMessages(clientB.messages, 'sdk_message', 3, 3000);
      await waitForMessage(clientB.messages, 'sdk_done');

      // Generator should have completed all yields
      expect(yielded).toBe(3);

      // abortSession should NOT have been called
      expect(mockAbortSession).not.toHaveBeenCalled();

      clientA.ws.close();
      clientB.ws.close();
    });

    it('set_active_session_ack includes isStreaming flag', async () => {
      const { ws, messages } = await createWsClient();
      await waitForMessage(messages, 'connected');

      // Switch to a session with active SDK
      mockGetSDKSession.mockReturnValueOnce({ isRunning: true });
      sendJson(ws, { type: 'set_active_session', sessionId: 's-streaming' });
      const ack = await waitForMessage(messages, 'set_active_session_ack');

      expect(ack.sessionId).toBe('s-streaming');
      expect(ack.isStreaming).toBe(true);

      ws.close();
    });

    it('set_active_session_ack includes remote pending question from snapshot', async () => {
      const { ws, messages } = await createWsClient();
      await waitForMessage(messages, 'connected');

      mockPublishWsSyncEvent.mockImplementation((_origin: string, envelope: any) => {
        if (envelope.scope === 'session' && envelope.sessionId === 'remote-active' && envelope.data?.type === 'session_snapshot_request') {
          queueMicrotask(() => {
            capturedWsSyncHandlers?.session('remote-active', {
              type: 'session_snapshot_response',
              requestId: envelope.data.requestId,
              isStreaming: true,
              pendingQuestion: {
                questionId: 'remote-q1',
                questions: [{ question: 'Continue?', options: [{ label: 'Yes' }] }],
              },
            });
          });
        }
      });

      sendJson(ws, { type: 'set_active_session', sessionId: 'remote-active' });
      const ack = await waitForMessage(messages, 'set_active_session_ack');

      expect(ack.sessionId).toBe('remote-active');
      expect(ack.isStreaming).toBe(true);
      expect(ack.pendingQuestion?.questionId).toBe('remote-q1');

      ws.close();
    });
  });

  describe('reconnect', () => {
    it('new client receives messages after reconnect', async () => {
      // Client A sets session s1
      const clientA = await createWsClient();
      await waitForMessage(clientA.messages, 'connected');
      sendJson(clientA.ws, { type: 'set_active_session', sessionId: 's1' });
      await waitForMessage(clientA.messages, 'set_active_session_ack');

      // Client A disconnects
      clientA.ws.close();
      await delay(100);

      // Client B reconnects to s1
      const clientB = await createWsClient();
      await waitForMessage(clientB.messages, 'connected');

      mockGetSDKSession.mockReturnValueOnce({ isRunning: false });
      sendJson(clientB.ws, { type: 'reconnect', sessionId: 's1' });
      const reconnectResult = await waitForMessage(clientB.messages, 'reconnect_result');
      expect(reconnectResult.sessionId).toBe('s1');

      // Now send chat on s1 — client B should receive it
      mockExecuteQuery.mockImplementationOnce(async function* () {
        yield { type: 'assistant', uuid: 'r1', message: { content: [{ type: 'text', text: 'reconnected' }] } };
      });

      sendJson(clientB.ws, { type: 'chat', message: 'after reconnect', sessionId: 's1' });
      await waitForMessage(clientB.messages, 'sdk_message');

      const sdkMsg = clientB.messages.find((m) => m.type === 'sdk_message');
      expect(sdkMsg.sessionId).toBe('s1');

      clientB.ws.close();
    });

    it('uses remote snapshot to restore streaming status on reconnect', async () => {
      const client = await createWsClient();
      await waitForMessage(client.messages, 'connected');

      mockPublishWsSyncEvent.mockImplementation((_origin: string, envelope: any) => {
        if (envelope.scope === 'session' && envelope.sessionId === 'remote-s1' && envelope.data?.type === 'session_snapshot_request') {
          queueMicrotask(() => {
            capturedWsSyncHandlers?.session('remote-s1', {
              type: 'session_snapshot_response',
              requestId: envelope.data.requestId,
              isStreaming: true,
              pendingQuestion: {
                questionId: 'q-remote',
                questions: [{ question: 'Pick one', options: [{ label: 'A' }] }],
              },
            });
          });
        }
      });

      sendJson(client.ws, { type: 'reconnect', sessionId: 'remote-s1' });
      const reconnectResult = await waitForMessage(client.messages, 'reconnect_result');

      expect(reconnectResult).toMatchObject({
        type: 'reconnect_result',
        sessionId: 'remote-s1',
        status: 'streaming',
      });
      expect(reconnectResult.pendingQuestion?.questionId).toBe('q-remote');
      expect(mockPublishWsSyncEvent).toHaveBeenCalled();

      client.ws.close();
    });
  });

  describe('abort', () => {
    it('returns abort_result and bumps epoch', async () => {
      const { ws, messages } = await createWsClient();
      await waitForMessage(messages, 'connected');

      sendJson(ws, { type: 'set_active_session', sessionId: 's1' });
      await waitForMessage(messages, 'set_active_session_ack');

      mockAbortSession.mockReturnValueOnce(true);
      sendJson(ws, { type: 'abort', sessionId: 's1' });

      const result = await waitForMessage(messages, 'abort_result');
      expect(result.aborted).toBe(true);
      expect(result.sessionId).toBe('s1');
      expect(mockAbortSession).toHaveBeenCalledWith('s1');

      ws.close();
    });

    it('publishes abort sync so remote owner can stop the session', async () => {
      const { ws, messages } = await createWsClient();
      await waitForMessage(messages, 'connected');

      sendJson(ws, { type: 'set_active_session', sessionId: 'remote-abort-s1' });
      await waitForMessage(messages, 'set_active_session_ack');

      sendJson(ws, { type: 'abort', sessionId: 'remote-abort-s1' });
      await waitForMessage(messages, 'abort_result');

      expect(mockPublishWsSyncEvent).toHaveBeenCalledWith('test-epoch', expect.objectContaining({
        scope: 'session',
        sessionId: 'remote-abort-s1',
        data: expect.objectContaining({ type: 'abort_session_sync' }),
      }));

      ws.close();
    });
  });

  describe('answer_question sync', () => {
    it('publishes answer sync when pending question lives on another instance', async () => {
      const { ws, messages } = await createWsClient();
      await waitForMessage(messages, 'connected');

      sendJson(ws, { type: 'set_active_session', sessionId: 'remote-question-s1' });
      await waitForMessage(messages, 'set_active_session_ack');

      sendJson(ws, {
        type: 'answer_question',
        sessionId: 'remote-question-s1',
        questionId: 'remote-q1',
        answer: 'Yes',
      });

      await delay(50);

      expect(mockPublishWsSyncEvent).toHaveBeenCalledWith('test-epoch', expect.objectContaining({
        scope: 'session',
        sessionId: 'remote-question-s1',
        data: expect.objectContaining({
          type: 'answer_question_sync',
          questionId: 'remote-q1',
          answer: 'Yes',
        }),
      }));

      ws.close();
    });
  });

  describe('ws close', () => {
    it('cleans up and allows new client to take over session', async () => {
      const { ws, messages } = await createWsClient();
      await waitForMessage(messages, 'connected');

      sendJson(ws, { type: 'set_active_session', sessionId: 's1' });
      await waitForMessage(messages, 'set_active_session_ack');

      // SDK is idle
      mockGetSDKSession.mockReturnValueOnce({ isRunning: false });

      ws.close();
      await delay(100);

      // Verify: a new client sending to s1 should work
      const clientB = await createWsClient();
      await waitForMessage(clientB.messages, 'connected');

      sendJson(clientB.ws, { type: 'set_active_session', sessionId: 's1' });
      await waitForMessage(clientB.messages, 'set_active_session_ack');

      mockExecuteQuery.mockImplementationOnce(async function* () {
        yield { type: 'assistant', uuid: 'b1', message: { content: [{ type: 'text', text: 'hi' }] } };
      });

      sendJson(clientB.ws, { type: 'chat', message: 'test', sessionId: 's1' });
      const msg = await waitForMessage(clientB.messages, 'sdk_message');
      expect(msg.sessionId).toBe('s1');

      clientB.ws.close();
    });
  });

  // ── Message routing correctness ────────────────────────────────
  // Regression tests: messages must be saved under the correct sessionId.
  // Past bug: frontend sent sessionId A, but messages were stored under B
  // due to session creation race conditions.

  describe('message routing — sessionId consistency', () => {
    it('saves user message under the sessionId from chat request', async () => {
      const { ws, messages } = await createWsClient();
      await waitForMessage(messages, 'connected');
      sendJson(ws, { type: 'set_active_session', sessionId: 'route-s1' });
      await waitForMessage(messages, 'set_active_session_ack');

      mockExecuteQuery.mockImplementationOnce(async function* () {
        yield { type: 'assistant', uuid: 'r1', message: { content: [{ type: 'text', text: 'ok' }] } };
      });

      sendJson(ws, { type: 'chat', message: 'test routing', sessionId: 'route-s1' });
      await waitForMessage(messages, 'sdk_done');

      // saveMessage should have been called with 'route-s1' for the user message
      const userSave = mockSaveMessage.mock.calls.find(
        (args: any[]) => args[0] === 'route-s1' && args[1]?.role === 'user'
      );
      expect(userSave).toBeTruthy();
      expect(userSave![1].content[0].text).toBe('test routing');

      ws.close();
    });

    it('sdk_done includes the same sessionId as the chat request', async () => {
      const { ws, messages } = await createWsClient();
      await waitForMessage(messages, 'connected');
      sendJson(ws, { type: 'set_active_session', sessionId: 'done-s1' });
      await waitForMessage(messages, 'set_active_session_ack');

      mockExecuteQuery.mockImplementationOnce(async function* () {
        yield { type: 'assistant', uuid: 'd1', message: { content: [{ type: 'text', text: 'hi' }] } };
      });

      sendJson(ws, { type: 'chat', message: 'check done', sessionId: 'done-s1' });
      const done = await waitForMessage(messages, 'sdk_done');

      // sdk_done must carry the original sessionId so frontend auto-name uses it
      expect(done.sessionId).toBe('done-s1');

      ws.close();
    });

    it('rejects chat when no sessionId is provided', async () => {
      const { ws, messages } = await createWsClient();
      await waitForMessage(messages, 'connected');

      // Send chat without sessionId and without prior set_active_session
      sendJson(ws, { type: 'chat', message: 'orphan message' });
      const err = await waitForMessage(messages, 'error');

      expect(err.errorCode).toBe('NO_SESSION_ID');

      ws.close();
    });

    it('uses client.sessionId as fallback when chat request omits sessionId', async () => {
      const { ws, messages } = await createWsClient();
      await waitForMessage(messages, 'connected');

      // First set active session to establish client.sessionId
      sendJson(ws, { type: 'set_active_session', sessionId: 'fallback-s1' });
      await waitForMessage(messages, 'set_active_session_ack');

      mockExecuteQuery.mockImplementationOnce(async function* () {
        yield { type: 'assistant', uuid: 'f1', message: { content: [{ type: 'text', text: 'fallback' }] } };
      });

      // Send chat WITHOUT sessionId — should use client.sessionId
      sendJson(ws, { type: 'chat', message: 'no explicit sid' });
      const done = await waitForMessage(messages, 'sdk_done');
      expect(done.sessionId).toBe('fallback-s1');

      ws.close();
    });

    it('session_status broadcasts carry the correct sessionId', async () => {
      const clientA = await createWsClient();
      await waitForMessage(clientA.messages, 'connected');
      sendJson(clientA.ws, { type: 'set_active_session', sessionId: 'status-s1' });
      await waitForMessage(clientA.messages, 'set_active_session_ack');

      // Client B on different session — should still get session_status (broadcast to all)
      const clientB = await createWsClient();
      await waitForMessage(clientB.messages, 'connected');
      sendJson(clientB.ws, { type: 'set_active_session', sessionId: 'status-s2' });
      await waitForMessage(clientB.messages, 'set_active_session_ack');

      mockExecuteQuery.mockImplementationOnce(async function* () {
        yield { type: 'assistant', uuid: 'st1', message: { content: [{ type: 'text', text: 'x' }] } };
      });

      sendJson(clientA.ws, { type: 'chat', message: 'status test', sessionId: 'status-s1' });

      // Both clients should get session_status with streaming then idle
      const statusA = await waitForMessage(clientA.messages, 'session_status');
      expect(statusA.sessionId).toBe('status-s1');

      // Client B should also get session_status (broadcastToAll) with correct sessionId
      const statusB = await waitForMessage(clientB.messages, 'session_status');
      expect(statusB.sessionId).toBe('status-s1');

      clientA.ws.close();
      clientB.ws.close();
    });
  });
});
