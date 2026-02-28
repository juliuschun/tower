import { executeQuery, abortSession } from './claude-sdk.js';
import { createSession, updateSession } from './session-manager.js';
import { updateTask, getTask } from './task-manager.js';
import { saveMessage } from './message-store.js';
import { buildDamageControl, type TowerRole } from './damage-control.js';
import { v4 as uuidv4 } from 'uuid';

const MAX_CONCURRENT_TASKS = 10;
const runningTasks = new Map<string, { sessionId: string; aborted: boolean }>();

type BroadcastFn = (type: string, data: any) => void;

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

export async function spawnTask(
  taskId: string,
  broadcastToAll: BroadcastFn,
  userId?: number,
  userRole?: string,
): Promise<void> {
  const task = getTask(taskId);
  if (!task) throw new Error('Task not found');
  if (task.status !== 'todo' && task.status !== 'failed') throw new Error(`Task status is ${task.status}, expected todo or failed`);

  if (runningTasks.size >= MAX_CONCURRENT_TASKS) {
    throw new Error(`Max concurrent tasks (${MAX_CONCURRENT_TASKS}) reached`);
  }

  const session = createSession(`🟢 ${task.title}`, task.cwd, userId);
  const sessionId = session.id;

  updateTask(taskId, {
    status: 'in_progress',
    sessionId,
    progressSummary: ['Starting task...'],
  });

  runningTasks.set(taskId, { sessionId, aborted: false });

  broadcastToAll('task_update', {
    taskId,
    status: 'in_progress',
    sessionId,
    progressSummary: ['Starting task...'],
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

  runTaskAgent(taskId, sessionId, task.title, task.description, task.cwd, broadcastToAll, userRole)
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
): Promise<void> {
  const prompt = buildTaskPrompt(title, description);
  const progressStages: string[] = ['Starting task...'];
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
    const effectiveRole = (userRole || 'member') as TowerRole;
    const damageCheck = buildDamageControl(effectiveRole);
    const taskCanUseTool = async (toolName: string, input: Record<string, unknown>, _options: { signal: AbortSignal }) => {
      const dc = damageCheck(toolName, input);
      if (!dc.allowed) {
        return { behavior: 'deny' as const, message: dc.message };
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
    });

    for await (const msg of generator) {
      const running = runningTasks.get(taskId);
      if (!running || running.aborted) break;

      // Track claude session ID
      if (msg.session_id) {
        claudeSessionId = msg.session_id;
      }

      // Save messages to DB (using correct saveMessage signature)
      if (msg.type === 'assistant' && msg.message) {
        const content = JSON.stringify(msg.message.content || []);
        const msgId = (msg.message as any).uuid || uuidv4();
        saveMessage(sessionId, { id: msgId, role: 'assistant', content });
        turnCount++;

        // Extract progress from text blocks
        const textBlocks = (msg.message.content || []).filter((b: any) => b.type === 'text');
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
        progressSummary: finalSummary,
      });
    }
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
