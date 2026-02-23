import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server } from 'http';
import { WebSocket } from 'ws';

// ── Mocks (must be before dynamic import) ──────────────────────────

const mockExecuteQuery = vi.fn();
const mockAbortSession = vi.fn(() => true);
const mockCleanupSession = vi.fn();
const mockGetClaudeSessionId = vi.fn();
const mockGetActiveSessionCount = vi.fn(() => 0);
const mockGetSDKSession = vi.fn(() => undefined);

vi.mock('../services/claude-sdk.js', () => ({
  executeQuery: (...args: any[]) => mockExecuteQuery(...args),
  abortSession: (...args: any[]) => mockAbortSession(...args),
  cleanupSession: (...args: any[]) => mockCleanupSession(...args),
  getClaudeSessionId: (...args: any[]) => mockGetClaudeSessionId(...args),
  getActiveSessionCount: (...args: any[]) => mockGetActiveSessionCount(...args),
  getSession: (...args: any[]) => mockGetSDKSession(...args),
}));

vi.mock('../services/message-store.js', () => ({
  saveMessage: vi.fn(),
  updateMessageContent: vi.fn(),
  attachToolResultInDb: vi.fn(),
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
  });

  describe('ws close', () => {
    it('cleans up and allows new client to take over session', async () => {
      const { ws, messages } = await createWsClient();
      const connected = await waitForMessage(messages, 'connected');

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
});
