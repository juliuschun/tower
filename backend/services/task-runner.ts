import { executeQuery, abortSession } from './claude-sdk.js';
import { createSession, updateSession, getSession } from './session-manager.js';
import { updateTask, getTask, getTasks } from './task-manager.js';
import { saveMessage, attachToolResultInDb } from './message-store.js';
import { buildDamageControl, buildPathEnforcement, type TowerRole } from './damage-control.js';
import { v4 as uuidv4 } from 'uuid';

const MAX_CONCURRENT_TASKS = 10;
const runningTasks = new Map<string, { sessionId: string; aborted: boolean }>();

type BroadcastFn = (type: string, data: any) => void;

// On server startup, mark any in_progress tasks as failed.
// These are zombies from a previous server crash or restart.
function recoverZombieTasks() {
  try {
    const allTasks = getTasks();
    const zombies = allTasks.filter(t => t.status === 'in_progress');
    for (const task of zombies) {
      updateTask(task.id, {
        status: 'failed',
        progressSummary: [...task.progressSummary, 'Server restarted — task interrupted'],
      });
      console.log(`[task-runner] Recovered zombie task "${task.title}" (${task.id}) → failed`);
    }
    if (zombies.length > 0) {
      console.log(`[task-runner] Recovered ${zombies.length} zombie task(s)`);
    }
  } catch (err: any) {
    console.error('[task-runner] Failed to recover zombie tasks:', err.message);
  }
}

recoverZombieTasks();

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

  runTaskAgent(taskId, sessionId, task.title, task.description, task.cwd, broadcastToAll, userRole, allowedPath, resumeClaudeSessionId, task.progressSummary)
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
      model: 'claude-sonnet-4-6',
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
  abortSession(running.sessionId);
  return true;
}

export function getRunningTaskCount(): number {
  return runningTasks.size;
}

export function isTaskRunning(taskId: string): boolean {
  return runningTasks.has(taskId);
}
