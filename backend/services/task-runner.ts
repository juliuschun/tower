import { executeQuery, abortSession } from './claude-sdk.js';
import { createSession, updateSession, getSession } from './session-manager.js';
import { updateTask, getTask, getTasks } from './task-manager.js';
import { saveMessage, attachToolResultInDb } from './message-store.js';
import { buildDamageControl, buildPathEnforcement, type TowerRole } from './damage-control.js';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const MAX_CONCURRENT_TASKS = 10;
const runningTasks = new Map<string, { sessionId: string; aborted: boolean }>();
const MONITOR_POLL_INTERVAL = 3000;
const MONITOR_TIMEOUT = 60 * 60 * 1000; // 60 minutes

interface MonitoredTask {
  taskId: string;
  sessionId: string;
  claudeSessionId: string;
  jsonlPath: string;
  startTime: number;
  progressStages: string[];
  timer: ReturnType<typeof setInterval>;
}

const monitoredTasks = new Map<string, MonitoredTask>();

type BroadcastFn = (type: string, data: any) => void;

// --- Helpers for .jsonl-based recovery ---

/** Build .jsonl file path for a Claude session */
function buildJsonlPath(cwd: string, claudeSessionId: string): string {
  const cwdPath = cwd.replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', cwdPath, `${claudeSessionId}.jsonl`);
}

/** Check if orphan Claude CLI processes exist */
function hasOrphanProcesses(): boolean {
  try {
    const result = execSync(
      `ps -eo pid,ppid,tty,args | awk '$2==1 && $3=="?" && /claude.*(--dangerously-skip-permissions|--permission-mode)/ {print $1}'`,
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

/** Read a .jsonl file and check for task completion markers */
function checkJsonlForCompletion(jsonlPath: string): {
  status: 'complete' | 'failed' | 'running';
  reason?: string;
  stages: string[];
} {
  const stages: string[] = [];
  try {
    const content = fs.readFileSync(jsonlPath, 'utf8');

    // Extract stage markers
    const stageMatches = content.matchAll(/\[STAGE:\s*(.+?)\]/g);
    for (const m of stageMatches) {
      if (!stages.includes(m[1])) stages.push(m[1]);
    }

    // Check for completion markers
    if (content.includes('[TASK COMPLETE]')) {
      return { status: 'complete', stages };
    }

    const failMatch = content.match(/\[TASK FAILED:\s*(.+?)\]/);
    if (failMatch) {
      return { status: 'failed', reason: failMatch[1], stages };
    }

    return { status: 'running', stages };
  } catch {
    return { status: 'running', stages };
  }
}

// --- Recovery & Monitoring ---

/**
 * Smart recovery: check .jsonl files for in-progress tasks instead of
 * blindly marking them all as failed. Returns task IDs still running.
 */
function recoverZombieTasks(): string[] {
  const stillRunning: string[] = [];
  try {
    const allTasks = getTasks();
    const zombies = allTasks.filter(t => t.status === 'in_progress');
    if (zombies.length === 0) return stillRunning;

    const orphansExist = hasOrphanProcesses();
    console.log(`[task-runner] Recovery: ${zombies.length} in_progress task(s), orphans=${orphansExist}`);

    for (const task of zombies) {
      // Look up claudeSessionId from DB
      let claudeSessionId: string | undefined;
      if (task.sessionId) {
        const session = getSession(task.sessionId);
        claudeSessionId = session?.claudeSessionId;
      }

      if (!claudeSessionId) {
        updateTask(task.id, {
          status: 'failed',
          progressSummary: [...task.progressSummary, 'Server restarted — no session to recover'],
        });
        console.log(`[task-runner] Task "${task.title}" (${task.id.slice(0, 8)}) → failed (no claudeSessionId)`);
        continue;
      }

      const jsonlPath = buildJsonlPath(task.cwd, claudeSessionId);

      if (!fs.existsSync(jsonlPath)) {
        updateTask(task.id, {
          status: 'failed',
          progressSummary: [...task.progressSummary, 'Server restarted — session file not found'],
        });
        console.log(`[task-runner] Task "${task.title}" (${task.id.slice(0, 8)}) → failed (no .jsonl)`);
        continue;
      }

      const result = checkJsonlForCompletion(jsonlPath);

      if (result.status === 'complete') {
        const newStages = result.stages.filter(s => !task.progressSummary.includes(s));
        const finalSummary = [...task.progressSummary, ...newStages, 'Completed successfully'];
        updateTask(task.id, {
          status: 'done',
          progressSummary: finalSummary,
          completedAt: new Date().toISOString(),
        });
        console.log(`[task-runner] Recovered task "${task.title}" (${task.id.slice(0, 8)}) → done`);
      } else if (result.status === 'failed') {
        const newStages = result.stages.filter(s => !task.progressSummary.includes(s));
        const finalSummary = [...task.progressSummary, ...newStages, `Failed: ${result.reason}`];
        updateTask(task.id, {
          status: 'failed',
          progressSummary: finalSummary,
        });
        console.log(`[task-runner] Recovered task "${task.title}" (${task.id.slice(0, 8)}) → failed: ${result.reason}`);
      } else {
        // No completion markers yet
        if (orphansExist) {
          // Orphan process alive → task probably still running → monitor
          stillRunning.push(task.id);
          runningTasks.set(task.id, { sessionId: task.sessionId!, aborted: false });
          console.log(`[task-runner] Task "${task.title}" (${task.id.slice(0, 8)}) → still running, will monitor`);
        } else {
          // No orphan processes → task crashed
          const newStages = result.stages.filter(s => !task.progressSummary.includes(s));
          const finalSummary = [...task.progressSummary, ...newStages, 'Server restarted — process not found'];
          updateTask(task.id, {
            status: 'failed',
            progressSummary: finalSummary,
          });
          console.log(`[task-runner] Task "${task.title}" (${task.id.slice(0, 8)}) → failed (no orphan process)`);
        }
      }
    }

    console.log(`[task-runner] Recovery complete: ${stillRunning.length} still running, ${zombies.length - stillRunning.length} resolved`);
  } catch (err: any) {
    console.error('[task-runner] Failed to recover zombie tasks:', err.message);
  }
  return stillRunning;
}

/**
 * Start monitoring .jsonl files for tasks that survived a backend restart.
 * Call from index.ts after WebSocket is ready.
 */
export function resumeOrphanedTaskMonitoring(broadcastFn: BroadcastFn): void {
  const stillRunning = recoverZombieTasks();

  if (stillRunning.length === 0) {
    console.log('[task-runner] No orphaned tasks to monitor');
    return;
  }

  for (const taskId of stillRunning) {
    const task = getTask(taskId);
    if (!task || !task.sessionId) continue;

    const session = getSession(task.sessionId);
    if (!session?.claudeSessionId) continue;

    const jsonlPath = buildJsonlPath(task.cwd, session.claudeSessionId);
    if (!fs.existsSync(jsonlPath)) continue;

    const progressStages = [...task.progressSummary];
    const startTime = Date.now();

    const timer = setInterval(() => {
      const monitored = monitoredTasks.get(taskId);
      if (!monitored) return;

      // Timeout check
      if (Date.now() - monitored.startTime > MONITOR_TIMEOUT) {
        clearInterval(monitored.timer);
        monitoredTasks.delete(taskId);
        runningTasks.delete(taskId);

        const finalSummary = [...monitored.progressStages, 'Timed out after 60 minutes'];
        updateTask(taskId, { status: 'failed', progressSummary: finalSummary });
        broadcastFn('task_update', { taskId, status: 'failed', progressSummary: finalSummary });
        broadcastFn('session_status', { sessionId: monitored.sessionId, status: 'idle' });
        console.log(`[task-runner] Monitored task ${taskId.slice(0, 8)} timed out`);
        return;
      }

      // Check .jsonl for updates
      const result = checkJsonlForCompletion(monitored.jsonlPath);

      // Update stages
      for (const stage of result.stages) {
        if (!monitored.progressStages.includes(stage)) {
          monitored.progressStages.push(stage);
          updateTask(taskId, { progressSummary: monitored.progressStages });
          broadcastFn('task_update', { taskId, status: 'in_progress', progressSummary: monitored.progressStages });
        }
      }

      if (result.status === 'complete') {
        clearInterval(monitored.timer);
        monitoredTasks.delete(taskId);
        runningTasks.delete(taskId);

        const finalSummary = [...monitored.progressStages, 'Completed successfully'];
        updateTask(taskId, { status: 'done', progressSummary: finalSummary, completedAt: new Date().toISOString() });
        broadcastFn('task_update', { taskId, status: 'done', sessionId: monitored.sessionId, progressSummary: finalSummary });
        broadcastFn('session_status', { sessionId: monitored.sessionId, status: 'idle' });
        console.log(`[task-runner] Monitored task ${taskId.slice(0, 8)} → done`);
      } else if (result.status === 'failed') {
        clearInterval(monitored.timer);
        monitoredTasks.delete(taskId);
        runningTasks.delete(taskId);

        const finalSummary = [...monitored.progressStages, `Failed: ${result.reason}`];
        updateTask(taskId, { status: 'failed', progressSummary: finalSummary });
        broadcastFn('task_update', { taskId, status: 'failed', sessionId: monitored.sessionId, progressSummary: finalSummary });
        broadcastFn('session_status', { sessionId: monitored.sessionId, status: 'idle' });
        console.log(`[task-runner] Monitored task ${taskId.slice(0, 8)} → failed: ${result.reason}`);
      }
    }, MONITOR_POLL_INTERVAL);

    monitoredTasks.set(taskId, {
      taskId,
      sessionId: task.sessionId!,
      claudeSessionId: session.claudeSessionId!,
      jsonlPath,
      startTime,
      progressStages,
      timer,
    });

    console.log(`[task-runner] Monitoring orphaned task "${task.title}" (${taskId.slice(0, 8)}) via ${path.basename(jsonlPath)}`);
  }

  // Broadcast current state to connected clients
  for (const taskId of stillRunning) {
    const task = getTask(taskId);
    if (task) {
      broadcastFn('task_update', {
        taskId,
        status: 'in_progress',
        sessionId: task.sessionId,
        progressSummary: task.progressSummary,
      });
    }
  }
}

/** Whether there are tasks being monitored after a restart */
export function hasMonitoredTasks(): boolean {
  return monitoredTasks.size > 0;
}

/** Stop all monitor timers (for graceful shutdown) */
export function stopAllMonitors(): void {
  for (const m of monitoredTasks.values()) {
    clearInterval(m.timer);
  }
  monitoredTasks.clear();
}

function buildTaskPrompt(title: string, description: string): string {
  return `# Task: ${title}

${description}

## Instructions
You are an autonomous agent executing a kanban task. Work through these stages:
1. **Research** — Understand the problem, read relevant files, gather context
2. **Plan** — Outline your approach briefly
3. **Implement** — Make the necessary changes
4. **Verify** — Run tests or verify your changes work correctly

At the start of each stage, output a single line: \`[STAGE: StageName]\` (e.g., \`[STAGE: Research]\`)
When you complete the entire task, output: \`[TASK COMPLETE]\`
If you encounter an unrecoverable error, output: \`[TASK FAILED: reason]\`

Work autonomously. Do not ask questions — make reasonable decisions and proceed.`;
}

function buildResumePrompt(title: string, description: string, completedStages: string[]): string {
  const stagesText = completedStages.length > 1
    ? `\n\n## Progress Before Interruption\nCompleted stages: ${completedStages.slice(1).join(' → ')}`
    : '';

  return `# Task: ${title} (Resuming)

${description}${stagesText}

## Instructions
You are an autonomous agent resuming a previously interrupted kanban task. The task was interrupted (e.g., by a server restart) and you are continuing from where you left off.

Review the conversation history above to understand what was already done, then continue from where work stopped.

Work through any remaining stages:
1. **Research** — Understand the problem, read relevant files, gather context
2. **Plan** — Outline your approach briefly
3. **Implement** — Make the necessary changes
4. **Verify** — Run tests or verify your changes work correctly

At the start of each stage, output a single line: \`[STAGE: StageName]\` (e.g., \`[STAGE: Research]\`)
When you complete the entire task, output: \`[TASK COMPLETE]\`
If you encounter an unrecoverable error, output: \`[TASK FAILED: reason]\`

Work autonomously. Do not ask questions — make reasonable decisions and proceed.`;
}

export async function spawnTask(
  taskId: string,
  broadcastToAll: BroadcastFn,
  userId?: number,
  userRole?: string,
  allowedPath?: string,
): Promise<void> {
  const task = getTask(taskId);
  if (!task) throw new Error('Task not found');
  if (task.status !== 'todo' && task.status !== 'failed') throw new Error(`Task status is ${task.status}, expected todo or failed`);

  if (runningTasks.size >= MAX_CONCURRENT_TASKS) {
    throw new Error(`Max concurrent tasks (${MAX_CONCURRENT_TASKS}) reached`);
  }

  // If re-running a failed task, try to resume from the previous session
  let resumeClaudeSessionId: string | undefined;
  if (task.status === 'failed' && task.sessionId) {
    const prevSession = getSession(task.sessionId);
    if (prevSession?.claudeSessionId) {
      resumeClaudeSessionId = prevSession.claudeSessionId;
      console.log(`[task-runner] Will resume task "${task.title}" from claudeSessionId=${resumeClaudeSessionId}`);
    }
  }

  const session = createSession(`🟢 ${task.title}`, task.cwd, userId);
  const sessionId = session.id;

  updateTask(taskId, {
    status: 'in_progress',
    sessionId,
    progressSummary: resumeClaudeSessionId ? ['Resuming task...'] : ['Starting task...'],
  });

  runningTasks.set(taskId, { sessionId, aborted: false });

  broadcastToAll('task_update', {
    taskId,
    status: 'in_progress',
    sessionId,
    progressSummary: resumeClaudeSessionId ? ['Resuming task...'] : ['Starting task...'],
    // Include full session data so frontend can add to session store
    session: {
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      tags: [],
      favorite: false,
      totalCost: 0,
      totalTokens: 0,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
  });

  runTaskAgent(taskId, sessionId, task.title, task.description, task.cwd, broadcastToAll, userRole, allowedPath, resumeClaudeSessionId, task.progressSummary, task.model)
    .catch((err) => {
      console.error(`[task-runner] Task ${taskId} error:`, err.message);
    });
}

async function runTaskAgent(
  taskId: string,
  sessionId: string,
  title: string,
  description: string,
  cwd: string,
  broadcastToAll: BroadcastFn,
  userRole?: string,
  allowedPath?: string,
  resumeClaudeSessionId?: string,
  previousProgress?: string[],
  model?: string,
): Promise<void> {
  const prompt = resumeClaudeSessionId
    ? buildResumePrompt(title, description, previousProgress ?? [])
    : buildTaskPrompt(title, description);
  const progressStages: string[] = [resumeClaudeSessionId ? 'Resuming task...' : 'Starting task...'];
  let claudeSessionId: string | undefined;
  let turnCount = 0;
  let lastSummary = '';

  // Save user prompt to DB so it's visible when viewing the session
  saveMessage(sessionId, {
    id: uuidv4(),
    role: 'user',
    content: JSON.stringify([{ type: 'text', text: prompt }]),
  });

  try {
    // Notify all clients that this session is streaming (for sidebar indicators)
    broadcastToAll('session_status', { sessionId, status: 'streaming' });

    const effectiveRole = (userRole || 'member') as TowerRole;
    const damageCheck = buildDamageControl(effectiveRole);
    const pathCheck = allowedPath ? buildPathEnforcement(allowedPath) : null;
    const taskCanUseTool = async (toolName: string, input: Record<string, unknown>, _options: { signal: AbortSignal }) => {
      const dc = damageCheck(toolName, input);
      if (!dc.allowed) {
        return { behavior: 'deny' as const, message: dc.message };
      }
      // Block agent teams — causes zombie polling CPU spikes
      if (toolName === 'TeamCreate') {
        return { behavior: 'deny' as const, message: 'Agent teams are disabled. Use sequential task execution.' };
      }
      if (pathCheck) {
        const pc = pathCheck(toolName, input);
        if (!pc.allowed) {
          return { behavior: 'deny' as const, message: pc.message };
        }
      }
      return { behavior: 'allow' as const, updatedInput: input };
    };
    const taskPermission = (effectiveRole === 'admin' || effectiveRole === 'operator')
      ? 'bypassPermissions' as const
      : 'acceptEdits' as const;

    const generator = executeQuery(sessionId, prompt, {
      cwd,
      permissionMode: taskPermission,
      model: model || 'claude-opus-4-6',
      canUseTool: taskCanUseTool,
      ...(resumeClaudeSessionId ? { resumeSessionId: resumeClaudeSessionId } : {}),
    });

    for await (const msg of generator) {
      const running = runningTasks.get(taskId);
      if (!running || running.aborted) break;

      // Track claude session ID — save immediately so resume works after crash
      if (msg.session_id && msg.session_id !== claudeSessionId) {
        claudeSessionId = msg.session_id;
        updateSession(sessionId, { claudeSessionId });
        // Notify frontend so session store has claudeSessionId for resume
        broadcastToAll('session_meta_update', {
          sessionId,
          updates: { claudeSessionId },
        });
      }

      // Save user messages (tool_result) to DB — same as ws-handler for complete history
      if (msg.type === 'user') {
        const userContent = (msg as any).message?.content;
        if (Array.isArray(userContent)) {
          for (const block of userContent) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              const resultText = typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.map((c: any) => c.text || '').join('\n')
                  : JSON.stringify(block.content);
              try { attachToolResultInDb(sessionId, block.tool_use_id, resultText); } catch {}
            }
          }
          const parentToolUseId = userContent.find((b: any) => b.tool_use_id)?.tool_use_id || null;
          if (parentToolUseId) {
            try {
              saveMessage(sessionId, {
                id: (msg as any).uuid || uuidv4(),
                role: 'user',
                content: userContent,
                parentToolUseId,
              });
            } catch {}
          }
        }
      }

      // Save assistant messages to DB
      if (msg.type === 'assistant' && msg.message) {
        const content = msg.message.content || [];
        const msgId = (msg.message as any).uuid || uuidv4();
        saveMessage(sessionId, { id: msgId, role: 'assistant', content });
        turnCount++;

        // Extract progress from text blocks
        const textBlocks = content.filter((b: any) => b.type === 'text');
        for (const block of textBlocks) {
          const text = block.text || '';

          // Detect stage markers
          const stageMatch = text.match(/\[STAGE:\s*(.+?)\]/);
          if (stageMatch) {
            const stage = stageMatch[1];
            if (!progressStages.includes(stage)) {
              progressStages.push(stage);
              updateTask(taskId, { progressSummary: progressStages });
              broadcastToAll('task_update', {
                taskId,
                status: 'in_progress',
                progressSummary: progressStages,
              });
            }
          }

          // Detect completion
          if (text.includes('[TASK COMPLETE]')) {
            lastSummary = 'Completed successfully';
          }

          // Detect failure
          const failMatch = text.match(/\[TASK FAILED:\s*(.+?)\]/);
          if (failMatch) {
            lastSummary = failMatch[1];
          }

          // Keep last meaningful text as summary
          if (text.trim().length > 10 && !text.startsWith('[')) {
            lastSummary = text.trim().slice(0, 200);
          }
        }

        // Broadcast sdk_message to anyone viewing this session
        broadcastToAll('task_sdk_message', {
          taskId,
          sessionId,
          sdkMessage: msg,
        });
      }
    }

    // Task completed
    const running = runningTasks.get(taskId);
    const wasAborted = running?.aborted;
    runningTasks.delete(taskId);

    if (wasAborted) {
      updateTask(taskId, {
        status: 'todo',
        progressSummary: [...progressStages, 'Aborted by user'],
      });
      broadcastToAll('task_update', {
        taskId,
        status: 'todo',
        progressSummary: [...progressStages, 'Aborted by user'],
      });
    } else {
      const finalStatus = lastSummary.startsWith('Completed') || !lastSummary.includes('FAILED') ? 'done' : 'failed';
      const finalSummary = [...progressStages, lastSummary || 'Done'];

      updateTask(taskId, {
        status: finalStatus,
        progressSummary: finalSummary,
        completedAt: new Date().toISOString(),
      });

      if (claudeSessionId) {
        updateSession(sessionId, { claudeSessionId, turnCount });
      }

      broadcastToAll('task_update', {
        taskId,
        status: finalStatus,
        sessionId,
        claudeSessionId,
        progressSummary: finalSummary,
      });
    }

    // Notify viewers: session done streaming (clears isStreaming in chat + sidebar indicator)
    broadcastToAll('sdk_done', { sessionId, claudeSessionId });
    broadcastToAll('session_status', { sessionId, status: 'idle' });
  } catch (err: any) {
    runningTasks.delete(taskId);
    const errorSummary = [...progressStages, `Error: ${err.message}`];

    updateTask(taskId, {
      status: 'failed',
      progressSummary: errorSummary,
    });

    broadcastToAll('task_update', {
      taskId,
      status: 'failed',
      progressSummary: errorSummary,
    });

    // Notify viewers: session done streaming (even on error)
    broadcastToAll('sdk_done', { sessionId, claudeSessionId });
    broadcastToAll('session_status', { sessionId, status: 'idle' });
  }
}

export function abortTask(taskId: string): boolean {
  const running = runningTasks.get(taskId);
  if (!running) return false;
  running.aborted = true;

  // If it's a monitored orphan, clean up monitoring and mark as todo
  const monitored = monitoredTasks.get(taskId);
  if (monitored) {
    clearInterval(monitored.timer);
    monitoredTasks.delete(taskId);
    runningTasks.delete(taskId);
    updateTask(taskId, {
      status: 'todo',
      progressSummary: [...monitored.progressStages, 'Aborted by user'],
    });
    return true;
  }

  // Normal running task — use SDK abort
  abortSession(running.sessionId);
  return true;
}

export function getRunningTaskCount(): number {
  return runningTasks.size;
}

export function isTaskRunning(taskId: string): boolean {
  return runningTasks.has(taskId);
}
