/**
 * Agent custom tool for Pi — spawns a sub-session to handle complex tasks.
 *
 * Similar to Claude Code's Agent tool: the parent AI decides to delegate
 * a task to a child agent, which runs independently and returns the result.
 *
 * The child session gets the same cwd and model but a fresh context,
 * so it won't pollute the parent's conversation history.
 */

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

const AgentParams = Type.Object({
  prompt: Type.String({ description: 'The task for the sub-agent to perform' }),
  description: Type.Optional(Type.String({ description: 'Short (3-5 word) description of what the agent will do' })),
});

/**
 * Create an Agent tool instance bound to shared auth/registry.
 * Called once per PiEngine session. Accepts optional ToolGuard
 * to enforce the same access control in sub-agent sessions.
 */
export function createAgentTool(
  authStorage: AuthStorage,
  modelRegistry: ModelRegistry,
  guard?: ToolGuard,
): ToolDefinition {
  return {
    name: 'agent',
    label: 'Agent',
    description: 'Launch a sub-agent to handle a complex task autonomously. The sub-agent gets its own context and returns the result. Use this for tasks that require multiple steps, broad codebase exploration, or work that can run independently.',
    promptSnippet: 'Launch a sub-agent for complex, multi-step tasks.',
    promptGuidelines: [
      'Use the agent tool when a task requires exploring many files, running multiple commands, or doing work that benefits from a fresh context.',
      'Provide a clear, detailed prompt so the sub-agent can work autonomously.',
      'The sub-agent has the same tools (read, bash, edit, write, grep, find, ls) but a separate conversation context.',
      'The sub-agent result is returned as text — summarize key findings for the user.',
    ],
    parameters: AgentParams,

    async execute(_toolCallId: string, params: { prompt: string; description?: string }, _signal: AbortSignal | undefined) {
      const { prompt, description } = params;
      console.log(`[Pi:Agent] Sub-agent started: ${description || prompt.slice(0, 50)}`);

      try {
        // Create a lightweight child session with same access control
        const childTools = guard
          ? wrapPiTools([readTool, bashTool, editTool, writeTool, grepTool, findTool, lsTool], guard)
          : [readTool, bashTool, editTool, writeTool, grepTool, findTool, lsTool];
        const { session: child } = await createAgentSession({
          cwd: process.cwd(),
          tools: childTools,
          authStorage,
          modelRegistry,
          sessionManager: SessionManager.inMemory(),
          settingsManager: SettingsManager.inMemory({
            compaction: { enabled: true },
            retry: { enabled: true, maxRetries: 2 },
          }),
        });

        // Collect text output from the child
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

        console.log(`[Pi:Agent] Sub-agent done: ${description || prompt.slice(0, 50)} (${resultText.length} chars)`);

        return {
          content: [{ type: 'text' as const, text: resultText || '(sub-agent produced no output)' }],
          details: undefined,
        };
      } catch (err: any) {
        console.error(`[Pi:Agent] Sub-agent failed: ${err.message}`);
        return {
          content: [{ type: 'text' as const, text: `Sub-agent error: ${err.message}` }],
          details: undefined,
        };
      }
    },
  } as ToolDefinition;
}
