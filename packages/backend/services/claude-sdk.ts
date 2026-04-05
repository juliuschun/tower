import { query, type SDKMessage, type Query, type Options, type CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { config } from '../config.js';
import { createBwrapWrapper, shouldUseSandbox } from './bwrap-sandbox.js';
import { findJsonlFile } from './jsonl-utils.js';

// CRITICAL: Remove CLAUDECODE env var to prevent SDK conflicts
delete process.env.CLAUDECODE;

// Clean up orphaned Claude processes from previous backend runs.
// When tsx watch restarts the backend, SDK-spawned CLI processes lose their
// parent and become orphans (ppid=1, tty=?).
//
// Strategy: DON'T kill immediately. Orphans may be mid-task for minutes.
// Instead, poll every 60s and only kill orphans that have been idle (low CPU)
// for at least one check cycle. This lets long-running tasks finish and flush
// their .jsonl files, so resume always works.
//
// Session IDs are preserved in DB — user's next message resumes from .jsonl.
const ORPHAN_CHECK_INTERVAL = 60_000; // check every 60s
const ORPHAN_CPU_IDLE_THRESHOLD = 1.0; // below 1% CPU = idle
let orphanCheckTimer: ReturnType<typeof setInterval> | null = null;
const idleOrphans = new Set<number>(); // PIDs that were idle on last check

// Restart-loop guard: track when the server started so we can detect rapid restarts
const SERVER_START_TIME = Date.now();
const MIN_UPTIME_FOR_INTERRUPT_FILE_MS = 30_000; // 30s — if uptime < this, don't write interrupted file

export function cleanupOrphanedSdkProcesses() {
  // Don't stack multiple intervals
  if (orphanCheckTimer) return;

  console.log('[sdk] Starting orphan monitor (check every 60s, kill only idle orphans)');
  orphanCheckTimer = setInterval(() => {
    try {
      // Find orphans with their CPU usage
      const result = execSync(
        `ps -eo pid,ppid,tty,pcpu,args | awk '$2==1 && $3=="?" && /claude.*(--dangerously-skip-permissions|--permission-mode)/ {print $1, $4}'`,
        { encoding: 'utf8', timeout: 3000 }
      ).trim();

      if (!result) {
        idleOrphans.clear();
        return;
      }

      const entries = result.split('\n').filter(Boolean).map(line => {
        const [pid, cpu] = line.trim().split(/\s+/);
        return { pid: Number(pid), cpu: parseFloat(cpu) || 0 };
      });

      for (const { pid, cpu } of entries) {
        if (cpu < ORPHAN_CPU_IDLE_THRESHOLD) {
          if (idleOrphans.has(pid)) {
            // Idle for 2 consecutive checks → safe to kill
            try {
              process.kill(pid, 'SIGTERM');
              console.log(`[sdk] SIGTERM idle orphan PID=${pid} (CPU=${cpu}%, idle for 2 checks)`);
            } catch { /* already dead */ }
            idleOrphans.delete(pid);
          } else {
            // First time seeing it idle — mark it, kill on next check
            idleOrphans.add(pid);
          }
        } else {
          // Still working — remove from idle set, let it run
          idleOrphans.delete(pid);
        }
      }

      // Clean up PIDs that disappeared
      for (const pid of idleOrphans) {
        if (!entries.some(e => e.pid === pid)) {
          idleOrphans.delete(pid);
        }
      }
    } catch { /* ps/awk not available */ }
  }, ORPHAN_CHECK_INTERVAL);

  // Don't prevent Node from exiting
  orphanCheckTimer.unref();
}

export function stopOrphanMonitor() {
  if (orphanCheckTimer) {
    clearInterval(orphanCheckTimer);
    orphanCheckTimer = null;
    idleOrphans.clear();
  }
}

// Cleanup deferred — called conditionally from index.ts after task recovery

// Graceful shutdown: mark sessions as not running but do NOT abort CLI processes.
// Let them become orphans — the next startup's cleanupOrphanedSdkProcesses()
// will SIGTERM them gracefully, giving them time to flush session files.
// Also marks streaming sessions as "interrupted" in DB so frontend can auto-resume.
export function gracefulShutdown(signal: string) {
  const interruptedSessions: string[] = [];
  for (const session of activeSessions.values()) {
    if (session.isRunning) {
      session.isRunning = false;
      interruptedSessions.push(session.id);
    }
  }
  if (interruptedSessions.length > 0) {
    const uptimeMs = Date.now() - SERVER_START_TIME;
    if (uptimeMs < MIN_UPTIME_FOR_INTERRUPT_FILE_MS) {
      // Restart-loop guard: server was up for less than 30s → likely a restart loop.
      // Do NOT write the interrupted file — break the cycle.
      console.warn(`[sdk] ${signal}: Skipping interrupted-sessions file (uptime ${Math.round(uptimeMs / 1000)}s < ${MIN_UPTIME_FOR_INTERRUPT_FILE_MS / 1000}s — restart loop guard)`);
      return;
    }
    console.log(`[sdk] ${signal}: ${interruptedSessions.length} CLI process(es) will be cleaned up on next startup`);
    // Write interrupted session IDs to a temp file for next startup to read.
    // Can't use async DB calls in shutdown handler (process exits too fast).
    try {
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(
        path.join(dataDir, 'interrupted-sessions.json'),
        JSON.stringify({ sessions: interruptedSessions, at: new Date().toISOString() }),
      );
    } catch (err: any) {
      console.error(`[sdk] Failed to write interrupted sessions file:`, err.message);
    }
  }
}

export interface ClaudeSession {
  id: string;
  claudeSessionId?: string;
  /** Last known good claudeSessionId whose .jsonl was confirmed to exist (for abort fallback) */
  prevClaudeSessionId?: string;
  abortController: AbortController;
  query?: Query;
  isRunning: boolean;
}

const activeSessions = new Map<string, ClaudeSession>();

// Session file backup directory — protects against external .jsonl deletion
const SESSION_BACKUP_DIR = path.join(process.cwd(), 'data', 'session-backups');

/** Get the SDK .jsonl file path for a given claudeSessionId and cwd */
function getJsonlPath(claudeSessionId: string, cwd: string, configDir?: string): string {
  const encodedCwd = cwd.replace(/\//g, '-');
  const base = configDir || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects', encodedCwd, `${claudeSessionId}.jsonl`);
}

/** Get the backup path for a .jsonl file */
function getBackupPath(claudeSessionId: string): string {
  return path.join(SESSION_BACKUP_DIR, `${claudeSessionId}.jsonl`);
}

/**
 * Back up a .jsonl session file after a successful turn.
 * If the SDK or CLI later deletes the original, we can restore it.
 */
export function backupSessionFile(claudeSessionId: string, cwd: string, configDir?: string): boolean {
  const jsonlPath = findJsonlFile(claudeSessionId, cwd, configDir) || getJsonlPath(claudeSessionId, cwd, configDir);
  if (!fs.existsSync(jsonlPath)) return false;

  try {
    if (!fs.existsSync(SESSION_BACKUP_DIR)) {
      fs.mkdirSync(SESSION_BACKUP_DIR, { recursive: true });
    }
    fs.copyFileSync(jsonlPath, getBackupPath(claudeSessionId));
    return true;
  } catch (err: any) {
    console.warn(`[sdk] backup failed for ${claudeSessionId.slice(0, 12)}: ${err.message}`);
    return false;
  }
}

/**
 * Restore a .jsonl session file from backup if the original is missing.
 * Returns true if restored, false if no backup available.
 */
function restoreSessionFile(claudeSessionId: string, cwd: string, configDir?: string): boolean {
  const jsonlPath = getJsonlPath(claudeSessionId, cwd, configDir);
  if (fs.existsSync(jsonlPath)) return true; // original exists, no need

  const backupPath = getBackupPath(claudeSessionId);
  if (!fs.existsSync(backupPath)) return false; // no backup

  try {
    // Ensure target directory exists
    const dir = path.dirname(jsonlPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(backupPath, jsonlPath);
    console.log(`[sdk] restored .jsonl from backup: ${claudeSessionId.slice(0, 12)}`);
    return true;
  } catch (err: any) {
    console.warn(`[sdk] restore from backup failed for ${claudeSessionId.slice(0, 12)}: ${err.message}`);
    return false;
  }
}

/**
 * Repair a .jsonl session file by removing corrupted trailing lines.
 * When a CLI process is killed mid-write, the last line may be truncated JSON.
 * The SDK refuses to resume from a corrupted file (exit code 1).
 * Fix: read backwards, remove lines that aren't valid JSON, keep the rest.
 */
function repairSessionFile(claudeSessionId: string, cwd: string, configDir?: string): boolean {
  const jsonlPath = getJsonlPath(claudeSessionId, cwd, configDir);

  if (!fs.existsSync(jsonlPath)) return false;

  try {
    const content = fs.readFileSync(jsonlPath, 'utf8');
    const lines = content.split('\n');

    // Remove trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }

    if (lines.length === 0) return false;

    // Check last lines for valid JSON, remove corrupted ones
    let removed = 0;
    while (lines.length > 0) {
      const lastLine = lines[lines.length - 1].trim();
      if (lastLine === '') { lines.pop(); continue; }
      try {
        JSON.parse(lastLine);
        break; // valid JSON — stop
      } catch {
        lines.pop();
        removed++;
      }
    }

    if (removed > 0 && lines.length > 0) {
      fs.writeFileSync(jsonlPath, lines.join('\n') + '\n');
      console.log(`[sdk] Repaired ${jsonlPath}: removed ${removed} corrupted line(s), ${lines.length} lines remain`);
      return true;
    }
  } catch (err: any) {
    console.warn(`[sdk] Failed to repair session file: ${err.message}`);
  }
  return false;
}

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
    systemPrompt?: string;
    userRole?: string;
    configDir?: string;  // Claude account credential directory (CLAUDE_CONFIG_DIR)
  } = {}
): AsyncGenerator<SDKMessage> {
  // Abort any existing query for this session
  const existing = activeSessions.get(sessionId);
  if (existing?.isRunning) {
    console.log(`[sdk] executeQuery aborting EXISTING running session=${sessionId}`);
    existing.abortController.abort();
  }

  // Preserve previous claudeSessionId for abort fallback
  const prevClaudeSessionId = existing?.prevClaudeSessionId || existing?.claudeSessionId;

  const abortController = new AbortController();
  const session: ClaudeSession = {
    id: sessionId,
    claudeSessionId: options.resumeSessionId,
    prevClaudeSessionId,
    abortController,
    isRunning: true,
  };
  activeSessions.set(sessionId, session);

  // Strip leading "/" from slash commands — SDK handles them as plain prompts
  let processedPrompt = prompt;
  if (prompt.startsWith('/')) {
    processedPrompt = prompt.substring(1);
  }

  const useSandbox = shouldUseSandbox();
  const sandboxRole = (options.userRole || 'member') as 'admin' | 'operator' | 'member' | 'viewer';
  const effectiveCwd = options.cwd || config.defaultCwd;
  if (useSandbox) {
    console.log(`[sdk] bwrap sandbox enabled for session=${sessionId} role=${sandboxRole} cwd=${effectiveCwd}`);
  }

  // Sandbox: generate a wrapper script that invokes bwrap around Claude CLI
  const wrapperPath = useSandbox
    ? createBwrapWrapper(effectiveCwd, sandboxRole)
    : undefined;

  const queryOptions: Options = {
    abortController,
    pathToClaudeCodeExecutable: wrapperPath || config.claudeExecutable,
    cwd: effectiveCwd,
    permissionMode: options.permissionMode || config.permissionMode,
    settingSources: ['user', 'project'],  // all roles: load user-level skills + project CLAUDE.md
    // Credential rotation: inject CLAUDE_CONFIG_DIR to isolate account tokens per child process
    ...(options.configDir ? {
      env: { ...process.env, CLAUDE_CONFIG_DIR: options.configDir },
    } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.canUseTool ? { canUseTool: options.canUseTool } : {}),
    ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
  };

  if (options.resumeSessionId) {
    const resumeCwd = queryOptions.cwd || config.defaultCwd;
    const cfgDir = options.configDir;

    // Try to find .jsonl for the requested claudeSessionId
    let resolvedResumeId = options.resumeSessionId;
    let jsonlPath = findJsonlFile(resolvedResumeId, resumeCwd, cfgDir);

    // If not found anywhere, try restoring from our backup to the expected path
    if (!jsonlPath) {
      restoreSessionFile(resolvedResumeId, resumeCwd, cfgDir);
      const expectedPath = getJsonlPath(resolvedResumeId, resumeCwd, cfgDir);
      if (fs.existsSync(expectedPath)) jsonlPath = expectedPath;
    }

    // Fallback: if current ID's .jsonl missing (e.g. abort killed process before flush),
    // try the previous known-good claudeSessionId whose .jsonl should still exist
    if (!jsonlPath && prevClaudeSessionId && prevClaudeSessionId !== resolvedResumeId) {
      console.log(`[sdk] resume fallback: session=${sessionId.slice(0,8)} current=${resolvedResumeId.slice(0,12)} → prev=${prevClaudeSessionId.slice(0,12)}`);
      jsonlPath = findJsonlFile(prevClaudeSessionId, resumeCwd, cfgDir);
      if (!jsonlPath) {
        restoreSessionFile(prevClaudeSessionId, resumeCwd, cfgDir);
        const expectedPath = getJsonlPath(prevClaudeSessionId, resumeCwd, cfgDir);
        if (fs.existsSync(expectedPath)) jsonlPath = expectedPath;
      }
      if (jsonlPath) {
        resolvedResumeId = prevClaudeSessionId;
        session.claudeSessionId = prevClaudeSessionId;
      }
    }

    if (jsonlPath) {
      // If the .jsonl was found in a different configDir (e.g. session created before account rotation),
      // copy it to the current configDir so the SDK child process can find it
      if (cfgDir) {
        const expectedPath = getJsonlPath(resolvedResumeId, resumeCwd, cfgDir);
        if (jsonlPath !== expectedPath) {
          // Copy if target doesn't exist, or source is newer/larger (account was switched back)
          try {
            const sourceSize = fs.statSync(jsonlPath).size;
            const targetExists = fs.existsSync(expectedPath);
            const targetSize = targetExists ? fs.statSync(expectedPath).size : 0;
            if (!targetExists || sourceSize > targetSize) {
              const dir = path.dirname(expectedPath);
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              fs.copyFileSync(jsonlPath, expectedPath);
              console.log(`[sdk] copied .jsonl to current configDir for resume: ${resolvedResumeId.slice(0, 12)} (${sourceSize} > ${targetSize})`);
            }
          } catch (err: any) {
            console.warn(`[sdk] failed to copy .jsonl for resume: ${err.message}`);
          }
        }
      }
      // Repair .jsonl before resume — removes corrupted trailing lines from killed processes
      repairSessionFile(resolvedResumeId, resumeCwd, cfgDir);
      queryOptions.resume = resolvedResumeId;
      console.log(`[sdk] resume attempt: session=${sessionId.slice(0,8)} claudeSid=${resolvedResumeId.slice(0,12)} jsonl=${path.basename(path.dirname(jsonlPath))}`);
    } else {
      console.log(`[sdk] resume skipped (no file, no backup): session=${sessionId.slice(0,8)} claudeSid=${options.resumeSessionId.slice(0,12)} cwd=${queryOptions.cwd}`);
      session.claudeSessionId = undefined;
    }
  }

  // Helper: run query and yield messages
  async function* runQuery(opts: Options): AsyncGenerator<SDKMessage> {
    const response = query({ prompt: processedPrompt, options: opts });
    session.query = response;
    let resumeConfirmed = false;
    for await (const message of response) {
      if (message.type === 'system' && message.subtype === 'init') {
        // Promote current claudeSessionId to prev before overwriting
        if (session.claudeSessionId && session.claudeSessionId !== message.session_id) {
          session.prevClaudeSessionId = session.claudeSessionId;
        }
        session.claudeSessionId = message.session_id;
        if (opts.resume && !resumeConfirmed) {
          console.log(`[sdk] resume succeeded: session=${sessionId.slice(0,8)} claudeSid=${message.session_id?.slice(0,12)}`);
          resumeConfirmed = true;
        }
      }
      if ('session_id' in message && message.session_id) {
        if (session.claudeSessionId && session.claudeSessionId !== message.session_id) {
          session.prevClaudeSessionId = session.claudeSessionId;
        }
        session.claudeSessionId = message.session_id;
      }
      yield message;
    }
  }

  // Helper: check if an error is an abort (SDK may throw Error with message, not AbortError)
  const isAbortError = (err: any) =>
    err.name === 'AbortError' || /aborted by user|abort/i.test(err.message || '');

  try {
    yield* runQuery(queryOptions);
  } catch (error: any) {
    if (isAbortError(error)) {
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
        if (isAbortError(retryError)) return;
        throw retryError;
      }
    } else {
      console.error(`[sdk] query error (unmatched for resume): ${error.message}`);
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

/**
 * Read and consume the interrupted-sessions.json file written during graceful shutdown.
 * Returns session IDs that were streaming when the backend last shut down.
 */
export function consumeInterruptedSessions(): string[] {
  const filePath = path.join(process.cwd(), 'data', 'interrupted-sessions.json');
  try {
    if (!fs.existsSync(filePath)) return [];
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    // Delete the file so it's only consumed once
    fs.unlinkSync(filePath);
    const sessions: string[] = data.sessions || [];
    if (sessions.length > 0) {
      console.log(`[sdk] Recovered ${sessions.length} interrupted session(s) from previous shutdown`);
    }
    return sessions;
  } catch {
    return [];
  }
}

export function cleanupSession(sessionId: string) {
  const session = activeSessions.get(sessionId);
  if (session?.isRunning) {
    console.log(`[sdk] cleanupSession (running!) session=${sessionId}`, new Error().stack?.split('\n').slice(1, 4).join(' ← '));
    session.abortController.abort();
  }
  activeSessions.delete(sessionId);
}
