/**
 * Agent custom tool for Pi — spawns a sub-session to handle complex tasks.
 *
 * Two modes:
 *   1. Fresh context (default) — child gets a blank slate, lightweight
 *   2. Fork mode (fork: true) — child inherits parent's full conversation
 *      history via SessionManager.forkFrom(), enabling prompt-cache hits
 *      on the shared prefix. Inspired by Claude Code's fork sub-agent pattern.
 *
 * Design principle (from Claude Code analysis):
 *   "Same token budget → cache hit saves tokens → spawn more agents"
 */

import fs from 'fs';
import path from 'path';
import { Type } from '@sinclair/typebox';
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  readTool, bashTool, editTool, writeTool, grepTool, findTool, lsTool,
} from '@mariozechner/pi-coding-agent';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
import { wrapPiTools, type ToolGuard } from '../services/project-access.js';
import { sharedTaskCreateTool, sharedTaskUpdateTool, sharedTaskListTool } from './pi-shared-task-tool.js';

// ── Safety limits (inspired by Claude Code's 292-agent / 36.8GB incident) ──
// Unlike Claude Code which blocks fork-of-fork entirely (CLI safety),
// we allow hierarchical forking (PM → Senior → Junior) with a depth cap.
// Context flows downward: each level inherits everything above it.
const MAX_CONCURRENT_FORKS = 8;
const MAX_FORK_DEPTH = 3; // PM(0) → Senior(1) → Junior(2) → hard stop at 3
const RSS_LIMIT_BYTES = 2 * 1024 * 1024 * 1024; // 2GB hard cap
let activeForkCount = 0;

const AgentParams = Type.Object({
  prompt: Type.String({ description: 'The task for the sub-agent to perform' }),
  description: Type.Optional(Type.String({ description: 'Short (3-5 word) description of what the agent will do' })),
  fork: Type.Optional(Type.Boolean({
    description:
      'If true, the sub-agent inherits the parent conversation context (fork mode). ' +
      'Use this when the sub-agent needs to understand what has already been discussed — ' +
      'e.g. codebase analysis, project context, prior decisions. ' +
      'Costs slightly more on first call but enables prompt-cache reuse.',
    default: false,
  })),
});

/**
 * Create an Agent tool instance bound to shared auth/registry.
 * Called once per PiEngine session. Accepts optional ToolGuard
 * to enforce the same access control in sub-agent sessions.
 *
 * @param parentSessionFile — path to parent's Pi session file (.jsonl).
 *        When provided and fork=true, child inherits full conversation history.
 * @param forkDepth — current depth in the fork hierarchy.
 *        0 = root (PM level), 1 = senior, 2 = junior, etc.
 *        Forking is blocked when depth >= MAX_FORK_DEPTH.
 *        Context accumulates as it flows down: Junior inherits PM + Senior context.
 */
export function createAgentTool(
  authStorage: AuthStorage,
  modelRegistry: ModelRegistry,
  guard?: ToolGuard,
  parentSessionFile?: string,
  forkDepth = 0,
): ToolDefinition {
  return {
    name: 'agent',
    label: 'Agent',
    description:
      'Launch a sub-agent to handle a complex task autonomously. ' +
      'Set fork=true to inherit the current conversation context (the sub-agent "remembers" everything discussed so far). ' +
      'Use fork mode when context matters (refactoring, multi-file changes). ' +
      'Use default mode for independent tasks (file search, simple edits). ' +
      `Fork depth: ${forkDepth}/${MAX_FORK_DEPTH} (${forkDepth >= MAX_FORK_DEPTH ? 'fork unavailable' : 'fork available'}).`,
    promptSnippet: 'Launch a sub-agent for complex, multi-step tasks. Use fork=true to share conversation context.',
    promptGuidelines: [
      'Use the agent tool when a task requires exploring many files, running multiple commands, or doing work that benefits from delegation.',
      'Set fork=true when the sub-agent needs to understand prior conversation context (e.g. "apply the pattern we discussed", "refactor the module we analyzed").',
      'Leave fork=false (default) for independent tasks that don\'t need conversation history (e.g. "search for all usages of X", "run tests").',
      'Provide a clear, detailed prompt so the sub-agent can work autonomously.',
      'The sub-agent has the same tools (read, bash, edit, write, grep, find, ls) but a separate conversation.',
      'The sub-agent result is returned as text — summarize key findings for the user.',
    ],
    parameters: AgentParams,

    async execute(
      _toolCallId: string,
      params: { prompt: string; description?: string; fork?: boolean },
      _signal: AbortSignal | undefined,
    ) {
      const { prompt, description, fork } = params;
      const canFork = forkDepth < MAX_FORK_DEPTH && !!parentSessionFile;
      const useFork = fork && canFork;
      const mode = useFork ? `fork(depth=${forkDepth + 1})` : 'fresh';
      console.log(`[Pi:Agent] Sub-agent started (${mode}): ${description || prompt.slice(0, 50)}`);

      // ── Safety: max depth reached ──
      if (fork && !canFork) {
        console.warn(`[Pi:Agent] Fork blocked at depth ${forkDepth} (max=${MAX_FORK_DEPTH})`);
      }

      // ── Safety: concurrent fork limit ──
      if (useFork && activeForkCount >= MAX_CONCURRENT_FORKS) {
        const msg = `Too many concurrent fork agents (${activeForkCount}/${MAX_CONCURRENT_FORKS}). Use fork=false or wait for existing agents to finish.`;
        console.warn(`[Pi:Agent] ${msg}`);
        return {
          content: [{ type: 'text' as const, text: msg }],
          details: undefined,
        };
      }

      // ── Safety: memory pressure check ──
      const rssBytes = process.memoryUsage().rss;
      if (rssBytes > RSS_LIMIT_BYTES) {
        const rssMB = Math.round(rssBytes / 1024 / 1024);
        const msg = `Memory limit reached (${rssMB}MB / ${Math.round(RSS_LIMIT_BYTES / 1024 / 1024)}MB). Cannot create more agents. Complete existing work first.`;
        console.warn(`[Pi:Agent] ${msg}`);
        return {
          content: [{ type: 'text' as const, text: msg }],
          details: undefined,
        };
      }

      if (useFork) activeForkCount++;
      try {
        // ── Build child session manager ──
        let sessionMgr: ReturnType<typeof SessionManager.create> | ReturnType<typeof SessionManager.inMemory>;

        if (useFork) {
          // Fork mode: copy parent's full conversation history.
          // The child's API request will share the same message prefix as the parent,
          // enabling prompt-cache hits on providers that support it (Anthropic, etc.).
          const forkDir = path.join(path.dirname(parentSessionFile!), 'forks');
          fs.mkdirSync(forkDir, { recursive: true });

          sessionMgr = SessionManager.forkFrom(parentSessionFile!, process.cwd(), forkDir);
          console.log(`[Pi:Agent] Forked from ${path.basename(parentSessionFile!)} → ${forkDir}`);
        } else {
          // Fresh mode: blank slate (current behavior)
          sessionMgr = SessionManager.inMemory();
        }

        // ── Create child agent session ──
        const childTools = guard
          ? wrapPiTools([readTool, bashTool, editTool, writeTool, grepTool, findTool, lsTool], guard)
          : [readTool, bashTool, editTool, writeTool, grepTool, findTool, lsTool];

        // Child gets its own agent tool with incremented depth — context keeps flowing down.
        // PM(0) → Senior(1) → Junior(2): each level inherits all context above it.
        const childSessionFile = useFork
          ? (sessionMgr as any).getSessionFile?.()
          : undefined;
        const childDepth = useFork ? forkDepth + 1 : 0;
        const childCustomTools = [
          createAgentTool(authStorage, modelRegistry, guard, childSessionFile, childDepth),
          // Shared TaskList tools — enables agent collaboration across fork hierarchy
          sharedTaskCreateTool,
          sharedTaskUpdateTool,
          sharedTaskListTool,
        ];

        const { session: child } = await createAgentSession({
          cwd: process.cwd(),
          tools: childTools,
          customTools: guard ? wrapPiTools(childCustomTools, guard) : childCustomTools,
          authStorage,
          modelRegistry,
          sessionManager: sessionMgr,
          settingsManager: SettingsManager.inMemory({
            compaction: { enabled: true },
            retry: { enabled: true, maxRetries: 2 },
          }),
        });

        // ── Collect text output from the child ──
        let resultText = '';
        const unsub = child.subscribe((event: any) => {
          if (event.type === 'message_update') {
            const evt = event.assistantMessageEvent;
            if (evt?.type === 'text_delta') {
              resultText += evt.delta;
            }
          }
        });

        // Run the prompt and wait for completion
        await child.prompt(prompt);
        unsub();
        child.dispose();

        // Clean up fork session file (ephemeral — don't accumulate on disk)
        if (useFork && childSessionFile) {
          try { fs.unlinkSync(childSessionFile); } catch { /* best-effort */ }
        }

        console.log(`[Pi:Agent] Sub-agent done (${mode}): ${description || prompt.slice(0, 50)} (${resultText.length} chars)`);

        return {
          content: [{ type: 'text' as const, text: resultText || '(sub-agent produced no output)' }],
          details: undefined,
        };
      } catch (err: any) {
        console.error(`[Pi:Agent] Sub-agent failed (${mode}): ${err.message}`);
        return {
          content: [{ type: 'text' as const, text: `Sub-agent error: ${err.message}` }],
          details: undefined,
        };
      } finally {
        if (useFork) activeForkCount--;
      }
    },
  } as ToolDefinition;
}
