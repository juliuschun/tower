import { query, type SDKMessage, type Query, type Options, type CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'child_process';
import { config } from '../config.js';

// CRITICAL: Remove CLAUDECODE env var to prevent SDK conflicts
delete process.env.CLAUDECODE;

// Kill orphaned SDK-spawned Claude processes from previous backend runs.
// When tsx watch restarts the backend, previously spawned Claude processes
// lose their parent reference and become orphans (ppid=1, tty=?).
function cleanupOrphanedSdkProcesses() {
  try {
    // Match: ppid=1, no tty (?), command contains "claude --dangerously-skip-permissions"
    const result = execSync(
      `ps -eo pid,ppid,tty,args | awk '$2==1 && $3=="?" && /claude.*--dangerously-skip-permissions/ {print $1}'`,
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    if (result) {
      const pids = result.split('\n').filter(Boolean);
      console.log(`[sdk] Found ${pids.length} orphaned Claude process(es): ${pids.join(', ')}`);
      for (const pid of pids) {
        try {
          process.kill(Number(pid), 'SIGTERM');
          console.log(`[sdk] Killed orphaned Claude process PID=${pid}`);
        } catch { /* already dead */ }
      }
      // SIGTERM may be ignored — follow up with SIGKILL after 3s
      setTimeout(() => {
        for (const pid of pids) {
          try {
            process.kill(Number(pid), 0); // check if still alive
            process.kill(Number(pid), 'SIGKILL');
            console.log(`[sdk] Force-killed orphan PID=${pid} (SIGTERM was ignored)`);
          } catch { /* already dead — good */ }
        }
      }, 3000);
    }
  } catch { /* ps/awk not available or no orphans */ }
}

cleanupOrphanedSdkProcesses();

// Graceful shutdown: abort all active SDK sessions before the process exits.
// Prevents orphaned claude child processes when tsx watch restarts the backend.
function gracefulShutdown(signal: string) {
  let aborted = 0;
  for (const session of activeSessions.values()) {
    if (session.isRunning) {
      session.abortController.abort();
      session.isRunning = false;
      aborted++;
    }
  }
  if (aborted > 0) {
    console.log(`[sdk] ${signal}: aborted ${aborted} active session(s)`);
  }
  // Give SDK a moment to clean up child processes, then exit
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

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
    console.log(`[sdk] executeQuery aborting EXISTING running session=${sessionId}`);
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
    settingSources: options.permissionMode === 'bypassPermissions'
      ? ['user', 'project']   // admin: user-level skills (Azure) included
      : ['project'],           // user: project skills only (no Azure)
    ...(options.model ? { model: options.model } : {}),
    ...(options.canUseTool ? { canUseTool: options.canUseTool } : {}),
  };

  if (options.resumeSessionId) {
    queryOptions.resume = options.resumeSessionId;
  }

  // Helper: run query and yield messages
  async function* runQuery(opts: Options): AsyncGenerator<SDKMessage> {
    const response = query({ prompt: processedPrompt, options: opts });
    session.query = response;
    for await (const message of response) {
      if (message.type === 'system' && message.subtype === 'init') {
        session.claudeSessionId = message.session_id;
      }
      if ('session_id' in message && message.session_id) {
        session.claudeSessionId = message.session_id;
      }
      yield message;
    }
  }

  try {
    yield* runQuery(queryOptions);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return;
    }
    // Resume failed (exit code 1, stale session) → retry without resume
    if (queryOptions.resume && /exited with code|ENOENT|session.*not found|unexpected token|invalid json|parse error|corrupt/i.test(error.message || '')) {
      console.warn(`[sdk] resume failed for session=${sessionId}, retrying fresh: ${error.message}`);
      // Yield a synthetic message so callers can notify the user
      yield {
        type: 'system',
        subtype: 'resume_failed',
        session_id: sessionId,
        message: 'Previous conversation context could not be restored. Starting fresh.',
      } as any;
      const freshOptions = { ...queryOptions };
      delete freshOptions.resume;
      session.claudeSessionId = undefined;
      try {
        yield* runQuery(freshOptions);
      } catch (retryError: any) {
        if (retryError.name === 'AbortError') return;
        throw retryError;
      }
    } else {
      throw error;
    }
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
    console.log(`[sdk] abortSession session=${sessionId}`, new Error().stack?.split('\n').slice(1, 4).join(' ← '));
    session.abortController.abort();
    session.isRunning = false;
    return true;
  }
  return false;
}

export function getSession(sessionId: string): ClaudeSession | undefined {
  return activeSessions.get(sessionId);
}

export function getRunningSessionIds(): string[] {
  const ids: string[] = [];
  for (const [id, session] of activeSessions) {
    if (session.isRunning) ids.push(id);
  }
  return ids;
}

export function getClaudeSessionId(sessionId: string): string | undefined {
  return activeSessions.get(sessionId)?.claudeSessionId;
}

export function cleanupSession(sessionId: string) {
  const session = activeSessions.get(sessionId);
  if (session?.isRunning) {
    console.log(`[sdk] cleanupSession (running!) session=${sessionId}`, new Error().stack?.split('\n').slice(1, 4).join(' ← '));
    session.abortController.abort();
  }
  activeSessions.delete(sessionId);
}
