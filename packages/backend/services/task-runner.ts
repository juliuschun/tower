import { executeQuery, abortSession } from './claude-sdk.js';
import { createSession, updateSession, getSession } from './session-manager.js';
import { updateTask, getTask, getTasks, type ScheduleCron, type WorkflowMode } from './task-manager.js';
import { saveMessage, attachToolResultInDb } from './message-store.js';
import { buildDamageControl, buildPathEnforcement, type TowerRole } from './damage-control.js';
import { buildSystemPrompt } from './system-prompt.js';
import { calculateNextRun } from './task-scheduler.js';
import { buildWorkflowPrompt } from './workflow-prompts.js';
import { createWorktree } from './worktree-manager.js';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { buildJsonlPath, checkJsonlForCompletion } from './jsonl-utils.js';

const MAX_CONCURRENT_TASKS = 30;
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

// --- Recovery & Monitoring ---

/**
 * Smart recovery: check .jsonl files for in-progress tasks instead of
 * blindly marking them all as failed. Returns task IDs still running.
 */
async function recoverZombieTasks(): Promise<string[]> {
  const stillRunning: string[] = [];
  try {
    const allTasks = await getTasks();
    const zombies = allTasks.filter(t => t.status === 'in_progress');
    if (zombies.length === 0) return stillRunning;

    const orphansExist = hasOrphanProcesses();
    console.log(`[task-runner] Recovery: ${zombies.length} in_progress task(s), orphans=${orphansExist}`);

    for (const task of zombies) {
      // Look up claudeSessionId from DB
      let claudeSessionId: string | undefined;
      if (task.sessionId) {
        const session = await getSession(task.sessionId);
        claudeSessionId = session?.claudeSessionId;
      }

      if (!claudeSessionId) {
        await updateTask(task.id, {
          status: 'failed',
          progressSummary: [...task.progressSummary, 'Server restarted — no session to recover'],
        });
        console.log(`[task-runner] Task "${task.title}" (${task.id.slice(0, 8)}) → failed (no claudeSessionId)`);
        continue;
      }

      // Try worktree path first, then original cwd
      const cwdForJsonl = task.worktreePath && fs.existsSync(task.worktreePath) ? task.worktreePath : task.cwd;
      let jsonlPath = buildJsonlPath(cwdForJsonl, claudeSessionId);

      // Fallback: if not found at worktree path, try original cwd
      if (!fs.existsSync(jsonlPath) && cwdForJsonl !== task.cwd) {
        jsonlPath = buildJsonlPath(task.cwd, claudeSessionId);
      }

      if (!fs.existsSync(jsonlPath)) {
        await updateTask(task.id, {
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
        await updateTask(task.id, {
          status: 'done',
          progressSummary: finalSummary,
          completedAt: new Date().toISOString(),
        });
        console.log(`[task-runner] Recovered task "${task.title}" (${task.id.slice(0, 8)}) → done`);
      } else if (result.status === 'failed') {
        const newStages = result.stages.filter(s => !task.progressSummary.includes(s));
        const finalSummary = [...task.progressSummary, ...newStages, `Failed: ${result.reason}`];
        await updateTask(task.id, {
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
          await updateTask(task.id, {
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
export async function resumeOrphanedTaskMonitoring(broadcastFn: BroadcastFn): Promise<void> {
  const stillRunning = await recoverZombieTasks();

  if (stillRunning.length === 0) {
    console.log('[task-runner] No orphaned tasks to monitor');
    return;
  }

  for (const taskId of stillRunning) {
    const task = await getTask(taskId);
    if (!task || !task.sessionId) continue;

    const session = await getSession(task.sessionId);
    if (!session?.claudeSessionId) continue;

    const jsonlPath = buildJsonlPath(task.cwd, session.claudeSessionId);
    if (!fs.existsSync(jsonlPath)) continue;

    const progressStages = [...task.progressSummary];
    const startTime = Date.now();

    const timer = setInterval(async () => {
      const monitored = monitoredTasks.get(taskId);
      if (!monitored) return;

      // Timeout check
      if (Date.now() - monitored.startTime > MONITOR_TIMEOUT) {
        clearInterval(monitored.timer);
        monitoredTasks.delete(taskId);
        runningTasks.delete(taskId);

        const finalSummary = [...monitored.progressStages, 'Timed out after 60 minutes'];
        await updateTask(taskId, { status: 'failed', progressSummary: finalSummary });
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
          await updateTask(taskId, { progressSummary: monitored.progressStages });
          broadcastFn('task_update', { taskId, status: 'in_progress', progressSummary: monitored.progressStages });
        }
      }

      if (result.status === 'complete') {
        clearInterval(monitored.timer);
        monitoredTasks.delete(taskId);
        runningTasks.delete(taskId);

        const finalSummary = [...monitored.progressStages, 'Completed successfully'];
        await updateTask(taskId, { status: 'done', progressSummary: finalSummary, completedAt: new Date().toISOString() });
        broadcastFn('task_update', { taskId, status: 'done', sessionId: monitored.sessionId, progressSummary: finalSummary });
        broadcastFn('session_status', { sessionId: monitored.sessionId, status: 'idle' });
        console.log(`[task-runner] Monitored task ${taskId.slice(0, 8)} → done`);
      } else if (result.status === 'failed') {
        clearInterval(monitored.timer);
        monitoredTasks.delete(taskId);
        runningTasks.delete(taskId);

        const finalSummary = [...monitored.progressStages, `Failed: ${result.reason}`];
        await updateTask(taskId, { status: 'failed', progressSummary: finalSummary });
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
    const task = await getTask(taskId);
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

function buildTaskPromptForWorkflow(
  title: string,
  description: string,
  workflow: WorkflowMode,
  taskId: string,
  isResume?: boolean,
  previousProgress?: string[],
): string {
  return buildWorkflowPrompt(title, description, workflow, {
    taskId,
    apiBaseUrl: 'http://localhost:32355',
    isResume,
    previousProgress,
  });
}

export async function spawnTask(
  taskId: string,
  broadcastToAll: BroadcastFn,
  userId?: number,
  userRole?: string,
  allowedPath?: string,
): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  if (task.status !== 'todo' && task.status !== 'failed') throw new Error(`Task status is ${task.status}, expected todo or failed`);

  if (runningTasks.size >= MAX_CONCURRENT_TASKS) {
    throw new Error(`Max concurrent tasks (${MAX_CONCURRENT_TASKS}) reached`);
  }

  // If re-running a failed task, try to resume from the previous session
  let resumeClaudeSessionId: string | undefined;
  if (task.status === 'failed' && task.sessionId) {
    const prevSession = await getSession(task.sessionId);
    if (prevSession?.claudeSessionId) {
      resumeClaudeSessionId = prevSession.claudeSessionId;
      console.log(`[task-runner] Will resume task "${task.title}" from claudeSessionId=${resumeClaudeSessionId}`);
    }
  }

  const session = await createSession(`🟢 ${task.title}`, task.cwd, userId);
  const sessionId = session.id;

  await updateTask(taskId, {
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

  runTaskAgent(taskId, sessionId, task.title, task.description, task.cwd, broadcastToAll, userRole, allowedPath, resumeClaudeSessionId, task.progressSummary, task.model, task.workflow)
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
  workflow?: WorkflowMode,
): Promise<void> {
  const effectiveWorkflow = workflow || 'auto';

  // Worktree creation for feature/big_task workflows
  let agentCwd = cwd;
  if ((effectiveWorkflow === 'feature' || effectiveWorkflow === 'big_task') && !resumeClaudeSessionId) {
    const wt = createWorktree(cwd, taskId, title);
    if (wt) {
      agentCwd = wt.worktreePath;
      await updateTask(taskId, { worktreePath: wt.worktreePath });
      broadcastToAll('task_update', { taskId, worktreePath: wt.worktreePath });
      console.log(`[task-runner] Task "${title}" using worktree: ${wt.worktreePath}`);
    }
  } else if (resumeClaudeSessionId) {
    // Resume: use existing worktree if present
    const existingTask = await getTask(taskId);
    if (existingTask?.worktreePath && fs.existsSync(existingTask.worktreePath)) {
      agentCwd = existingTask.worktreePath;
    }
  }

  const prompt = buildTaskPromptForWorkflow(
    title, description, effectiveWorkflow, taskId,
    !!resumeClaudeSessionId, previousProgress,
  );
  const progressStages: string[] = [resumeClaudeSessionId ? 'Resuming task...' : 'Starting task...'];
  let claudeSessionId: string | undefined;
  let turnCount = 0;
  let lastSummary = '';
  let completionSummary = ''; // Richer summary for room reporting

  // Save user prompt to DB so it's visible when viewing the session
  await saveMessage(sessionId, {
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
      // Block EnterWorktree for non-worktree modes (worktree is managed by task-runner)
      if (toolName === 'EnterWorktree') {
        return { behavior: 'deny' as const, message: 'Worktree is managed by the task runner. Use the current working directory.' };
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

    // Build system prompt for task agent (Layer 2)
    let systemPrompt = buildSystemPrompt({
      username: 'task-agent',
      role: effectiveRole,
      allowedPath,
    });

    // Inject room context if this is a room-triggered task
    const currentTask = await getTask(taskId);
    if (currentTask?.roomId) {
      try {
        const { getMessages: getRoomMessages, getAiContexts, getRoom: fetchRoom } = await import('./room-manager.js');
        const { assembleRoomContext } = await import('./room-context.js');

        const room = await fetchRoom(currentTask.roomId);
        const recentMsgs = await getRoomMessages(currentTask.roomId, { limit: 20 });
        const aiContexts = await getAiContexts(currentTask.roomId, 5);

        const config = {
          maxTier1Count: 5,
          maxTier1Tokens: 500,
          maxTier2Tokens: 2000,
          maxRecentMessages: 20,
          maxTotalTokens: 3000,
        };

        const aiEntries = aiContexts.map(ctx => ({
          taskId: ctx.sourceTaskId || 'unknown',
          question: '',
          answerSummary: ctx.content,
          tokenCount: ctx.tokenCount,
          createdAt: ctx.createdAt,
          expiresAt: ctx.expiresAt ?? undefined,
        }));

        const recentForContext = recentMsgs
          .filter(m => m.msgType === 'human' || m.msgType === 'ai_summary')
          .map(m => ({
            sender: m.senderName || 'system',
            content: m.content,
            timestamp: m.createdAt,
          }));

        const roomContext = assembleRoomContext({
          roomName: room?.name || 'Unknown Room',
          roomDescription: room?.description || '',
          aiContextEntries: aiEntries,
          recentMessages: recentForContext,
          userPrompt: description,
          config,
        });

        systemPrompt = roomContext + '\n\n---\n\n' + systemPrompt;
        console.log(`[task-runner] Room context injected for task "${title}" (room: ${room?.name})`);
      } catch (err: any) {
        console.error(`[task-runner] Failed to build room context for task ${taskId.slice(0, 8)}:`, err.message);
      }
    }

    const generator = executeQuery(sessionId, prompt, {
      cwd: agentCwd,
      permissionMode: taskPermission,
      model: model || 'claude-opus-4-6',
      canUseTool: taskCanUseTool,
      systemPrompt,
      userRole: effectiveRole,
      ...(resumeClaudeSessionId ? { resumeSessionId: resumeClaudeSessionId } : {}),
    });

    for await (const msg of generator) {
      const running = runningTasks.get(taskId);
      if (!running || running.aborted) break;

      // Track claude session ID — save immediately so resume works after crash
      if (msg.session_id && msg.session_id !== claudeSessionId) {
        claudeSessionId = msg.session_id;
        await updateSession(sessionId, { claudeSessionId });
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
              await saveMessage(sessionId, {
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
        await saveMessage(sessionId, { id: msgId, role: 'assistant', content });
        turnCount++;

        // Extract progress from text blocks
        const textBlocks = content.filter((b: any) => b.type === 'text');
        for (const block of textBlocks) {
          const text = (block as any).text || '';

          // Detect triage workflow classification (auto mode only)
          if (effectiveWorkflow === 'auto') {
            const workflowMatch = text.match(/\[WORKFLOW:\s*(simple|default|feature|big_task)\]/);
            if (workflowMatch) {
              const classified = workflowMatch[1] as WorkflowMode;
              await updateTask(taskId, { workflow: classified });
              broadcastToAll('task_update', { taskId, workflow: classified });
              console.log(`[task-runner] Task "${title}" triage → ${classified}`);

              // For feature/big_task, create worktree and instruct agent to cd
              if ((classified === 'feature' || classified === 'big_task') && agentCwd === cwd) {
                const wt = createWorktree(cwd, taskId, title);
                if (wt) {
                  await updateTask(taskId, { worktreePath: wt.worktreePath });
                  broadcastToAll('task_update', { taskId, worktreePath: wt.worktreePath });
                  // Note: can't change SDK cwd mid-stream, but the agent can cd
                  console.log(`[task-runner] Late worktree created: ${wt.worktreePath} — agent should cd there`);
                }
              }
            }
          }

          // Detect stage markers
          const stageMatch = text.match(/\[STAGE:\s*(.+?)\]/);
          if (stageMatch) {
            const stage = stageMatch[1];
            if (!progressStages.includes(stage)) {
              progressStages.push(stage);
              await updateTask(taskId, { progressSummary: progressStages });
              broadcastToAll('task_update', {
                taskId,
                status: 'in_progress',
                progressSummary: progressStages,
              });
            }
          }

          // Detect completion — capture the full text block as rich summary
          if (text.includes('[TASK COMPLETE]')) {
            lastSummary = 'Completed successfully';
            // Extract everything after [TASK COMPLETE] marker as the summary
            const afterMarker = text.split('[TASK COMPLETE]').pop()?.trim();
            if (afterMarker && afterMarker.length > 5) {
              completionSummary = afterMarker.slice(0, 1000);
            }
          }

          // Detect failure
          const failMatch = text.match(/\[TASK FAILED:\s*(.+?)\]/);
          if (failMatch) {
            lastSummary = failMatch[1];
            completionSummary = text.trim().slice(0, 1000);
          }

          // Keep last meaningful text as summary
          if (text.trim().length > 10 && !text.startsWith('[')) {
            lastSummary = text.trim().slice(0, 200);
            // Also accumulate for richer room summary (keep latest substantial block)
            if (text.trim().length > 30) {
              completionSummary = text.trim().slice(0, 1000);
            }
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
      await updateTask(taskId, {
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

      await updateTask(taskId, {
        status: finalStatus,
        progressSummary: finalSummary,
        completedAt: new Date().toISOString(),
      });

      if (claudeSessionId) {
        await updateSession(sessionId, { claudeSessionId, turnCount });
      }

      broadcastToAll('task_update', {
        taskId,
        status: finalStatus,
        sessionId,
        claudeSessionId,
        progressSummary: finalSummary,
      });

      // ── Room task completion: post summary + save context ──
      const completedTaskForRoom = await getTask(taskId);
      if (completedTaskForRoom?.roomId) {
        try {
          const { sendMessage: sendRoomMsg, saveAiContext } = await import('./room-manager.js');
          const { broadcastToRoom } = await import('../routes/ws-handler.js');

          const msgType = finalStatus === 'done' ? 'ai_summary' : 'ai_error';

          // Build rich summary for room reporting
          const stagesReport = progressStages
            .filter(s => s !== 'Starting task...' && s !== 'Resuming task...')
            .map(s => `• ${s}`)
            .join('\n');

          let summaryText: string;
          if (completionSummary) {
            // Use the rich completion summary (captured from agent's final output)
            summaryText = `📋 태스크: ${title}\n📊 상태: ${finalStatus === 'done' ? '✅ 완료' : '❌ 실패'}\n\n${completionSummary}`;
            if (stagesReport) {
              summaryText += `\n\n🔄 진행 단계:\n${stagesReport}`;
            }
          } else if (lastSummary && lastSummary !== 'Completed successfully') {
            summaryText = `📋 태스크: ${title}\n📊 상태: ${finalStatus === 'done' ? '✅ 완료' : '❌ 실패'}\n\n${lastSummary}`;
          } else {
            summaryText = `📋 태스크: ${title}\n📊 상태: ${finalStatus === 'done' ? '✅ 완료' : '❌ 실패'}`;
            if (stagesReport) {
              summaryText += `\n\n🔄 진행 단계:\n${stagesReport}`;
            }
          }

          // Post message to room
          const roomMsg = await sendRoomMsg(
            completedTaskForRoom.roomId,
            null, // system sender
            summaryText,
            msgType,
            { taskId, taskTitle: title, status: finalStatus },
            taskId,
          );

          // Broadcast to room clients
          broadcastToRoom(completedTaskForRoom.roomId, {
            type: 'room_message',
            roomId: completedTaskForRoom.roomId,
            message: roomMsg,
          });

          // Save as AI context (rough token estimate: 1 token per 4 chars)
          if (finalStatus === 'done') {
            await saveAiContext(
              completedTaskForRoom.roomId,
              summaryText,
              Math.ceil(summaryText.length / 4),
              taskId,
            );
          }

          console.log(`[task-runner] Room task "${title}" → posted ${msgType} to room ${completedTaskForRoom.roomId.slice(0, 8)}`);
        } catch (err: any) {
          console.error(`[task-runner] Failed to post room summary for task ${taskId.slice(0, 8)}:`, err.message);
        }
      }

      // ── Recurring schedule reset ──
      // If this task has a cron pattern, reset it to 'todo' with next scheduled_at
      const completedTask = await getTask(taskId);
      if (completedTask?.scheduleCron) {
        try {
          const cronObj: ScheduleCron = JSON.parse(completedTask.scheduleCron);
          const nextRun = calculateNextRun(cronObj);
          await updateTask(taskId, {
            status: 'todo',
            scheduledAt: nextRun.toISOString(),
            scheduleEnabled: true,
            sessionId: null as any,
            progressSummary: [],
            completedAt: null as any,
            worktreePath: null,
          });
          broadcastToAll('task_update', {
            taskId,
            status: 'todo',
            scheduledAt: nextRun.toISOString(),
            scheduleEnabled: true,
            sessionId: null,
            progressSummary: [],
            worktreePath: null,
          });
          console.log(`[task-runner] Recurring task "${completedTask.title}" rescheduled → ${nextRun.toISOString()}`);
        } catch (err: any) {
          console.error(`[task-runner] Failed to reschedule recurring task ${taskId.slice(0, 8)}:`, err.message);
        }
      }
    }

    // Notify viewers: session done streaming (clears isStreaming in chat + sidebar indicator)
    broadcastToAll('sdk_done', { sessionId, claudeSessionId });
    broadcastToAll('session_status', { sessionId, status: 'idle' });
  } catch (err: any) {
    runningTasks.delete(taskId);
    const errorSummary = [...progressStages, `Error: ${err.message}`];

    await updateTask(taskId, {
      status: 'failed',
      progressSummary: errorSummary,
    });

    broadcastToAll('task_update', {
      taskId,
      status: 'failed',
      progressSummary: errorSummary,
    });

    // Post error to room if this was a room-triggered task
    const failedTaskForRoom = await getTask(taskId);
    if (failedTaskForRoom?.roomId) {
      try {
        const { sendMessage: sendRoomMsg } = await import('./room-manager.js');
        const { broadcastToRoom } = await import('../routes/ws-handler.js');
        const errorText = `📋 태스크: ${title}\n📊 상태: ❌ 실패\n\n오류: ${err.message}`;
        const roomMsg = await sendRoomMsg(
          failedTaskForRoom.roomId,
          null,
          errorText,
          'ai_error',
          { taskId, taskTitle: title, status: 'failed' },
          taskId,
        );
        broadcastToRoom(failedTaskForRoom.roomId, {
          type: 'room_message',
          roomId: failedTaskForRoom.roomId,
          message: roomMsg,
        });
      } catch (roomErr: any) {
        console.error(`[task-runner] Failed to post error to room:`, roomErr.message);
      }
    }

    // Notify viewers: session done streaming (even on error)
    broadcastToAll('sdk_done', { sessionId, claudeSessionId });
    broadcastToAll('session_status', { sessionId, status: 'idle' });
  }
}

export async function abortTask(taskId: string): Promise<boolean> {
  const running = runningTasks.get(taskId);
  if (!running) return false;
  running.aborted = true;

  // If it's a monitored orphan, clean up monitoring and mark as todo
  const monitored = monitoredTasks.get(taskId);
  if (monitored) {
    clearInterval(monitored.timer);
    monitoredTasks.delete(taskId);
    runningTasks.delete(taskId);
    await updateTask(taskId, {
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
