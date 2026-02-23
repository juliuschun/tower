import { query, type SDKMessage, type Query, type Options, type CanUseTool } from '@anthropic-ai/claude-code';
import { config } from '../config.js';

// CRITICAL: Remove CLAUDECODE env var to prevent SDK conflicts
delete process.env.CLAUDECODE;

export interface ClaudeSession {
  id: string;
  claudeSessionId?: string;
  abortController: AbortController;
  query?: Query;
  isRunning: boolean;
}

const activeSessions = new Map<string, ClaudeSession>();

export function getActiveSessionCount(): number {
  let count = 0;
  for (const session of activeSessions.values()) {
    if (session.isRunning) count++;
  }
  return count;
}

export async function* executeQuery(
  sessionId: string,
  prompt: string,
  options: {
    cwd?: string;
    resumeSessionId?: string;
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
    model?: string;
    canUseTool?: CanUseTool;
  } = {}
): AsyncGenerator<SDKMessage> {
  // Abort any existing query for this session
  const existing = activeSessions.get(sessionId);
  if (existing?.isRunning) {
    existing.abortController.abort();
  }

  const abortController = new AbortController();
  const session: ClaudeSession = {
    id: sessionId,
    claudeSessionId: options.resumeSessionId,
    abortController,
    isRunning: true,
  };
  activeSessions.set(sessionId, session);

  // Strip leading "/" from slash commands — SDK handles them as plain prompts
  let processedPrompt = prompt;
  if (prompt.startsWith('/')) {
    processedPrompt = prompt.substring(1);
  }

  const queryOptions: Options = {
    abortController,
    executable: 'node',
    executableArgs: [],
    pathToClaudeCodeExecutable: config.claudeExecutable,
    cwd: options.cwd || config.defaultCwd,
    permissionMode: options.permissionMode || config.permissionMode,
    ...(options.model ? { model: options.model } : {}),
    ...(options.canUseTool ? { canUseTool: options.canUseTool } : {}),
  };

  if (options.resumeSessionId) {
    queryOptions.resume = options.resumeSessionId;
  }

  try {
    const response = query({
      prompt: processedPrompt,
      options: queryOptions,
    });

    session.query = response;

    for await (const message of response) {
      // Capture claude session ID from system init message
      if (message.type === 'system' && message.subtype === 'init') {
        session.claudeSessionId = message.session_id;
      }
      // Track session ID from any message
      if ('session_id' in message && message.session_id) {
        session.claudeSessionId = message.session_id;
      }

      yield message;
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      // User aborted, not an error
      return;
    }
    throw error;
  } finally {
    session.isRunning = false;
    // Auto-cleanup after 5 minutes to prevent memory leak
    setTimeout(() => {
      const current = activeSessions.get(sessionId);
      if (current === session && !current.isRunning) {
        activeSessions.delete(sessionId);
      }
    }, 5 * 60 * 1000);
  }
}

export function abortSession(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (session?.isRunning) {
    session.abortController.abort();
    session.isRunning = false;
    return true;
  }
  return false;
}

export function getSession(sessionId: string): ClaudeSession | undefined {
  return activeSessions.get(sessionId);
}

export function getClaudeSessionId(sessionId: string): string | undefined {
  return activeSessions.get(sessionId)?.claudeSessionId;
}

export function cleanupSession(sessionId: string) {
  const session = activeSessions.get(sessionId);
  if (session?.isRunning) {
    session.abortController.abort();
  }
  activeSessions.delete(sessionId);
}
