/**
 * Claude Code engine — wraps @anthropic-ai/claude-agent-sdk.
 *
 * Absorbs all Claude-specific logic from claude-sdk.ts and ws-handler.ts.
 * ws-handler.ts only sees the Engine interface; it never imports this file directly.
 *
 * To remove Claude: delete this file + remove 'claude' case from engines/index.ts.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Engine, RunOpts, EngineCallbacks, TowerMessage, TowerContentBlock, QuickReplyOpts } from './types.js';
import {
  executeQuery,
  abortSession,
  cleanupSession,
  getClaudeSessionId,
  getActiveSessionCount,
  getRunningSessionIds as sdkGetRunningSessionIds,
  getSession as getSDKSession,
  backupSessionFile,
  cleanupOrphanedSdkProcesses,
  stopOrphanMonitor,
  gracefulShutdown,
} from '../services/claude-sdk.js';
import { config, getPermissionMode } from '../config.js';
import { buildSystemPrompt } from '../services/system-prompt.js';
import { buildToolGuard, type ToolGuard } from '../services/project-access.js';
import { autoCommit } from '../services/git-manager.js';

// CRITICAL: Remove CLAUDECODE env var to prevent SDK conflicts
delete process.env.CLAUDECODE;

export class ClaudeEngine implements Engine {

  // ═══════════════════════════════════════════════════════════════
  // Engine.run() — main entry point, replaces handleChat() logic
  // ═══════════════════════════════════════════════════════════════

  async *run(
    sessionId: string,
    prompt: string,
    opts: RunOpts,
    callbacks: EngineCallbacks,
  ): AsyncGenerator<TowerMessage> {
    const permissionMode = getPermissionMode(opts.userRole);

    // Build unified tool guard (damage control + path enforcement + project ACL)
    const guard = buildToolGuard({
      role: opts.userRole || 'member',
      allowedPath: opts.allowedPath,
      accessiblePaths: opts.accessiblePaths,
    });

    // Build canUseTool interceptor (guard + AskUserQuestion → callbacks.askUser)
    const canUseTool = this.createCanUseTool(sessionId, guard, callbacks);

    // Build system prompt (Layer 2: team rules + role context)
    const systemPrompt = await buildSystemPrompt({
      userId: opts.userId,
      username: opts.username || 'anonymous',
      role: opts.userRole || 'member',
      allowedPath: opts.allowedPath,
    });

    let engineSessionId: string | undefined;
    let currentAssistantId: string | null = null;
    const editedFiles = new Set<string>();

    try {
      for await (const message of executeQuery(sessionId, prompt, {
        cwd: opts.cwd,
        resumeSessionId: opts.engineSessionId,
        permissionMode,
        model: opts.model,
        canUseTool,
        systemPrompt,
        userRole: opts.userRole,
      })) {
        // Track Claude session ID
        if ('session_id' in message && message.session_id) {
          if (!engineSessionId) {
            callbacks.claimSessionId(message.session_id);
          }
          engineSessionId = message.session_id;
        }

        // Handle resume failure
        if ((message as any).type === 'system' && (message as any).subtype === 'resume_failed') {
          yield {
            type: 'engine_error',
            sessionId,
            message: (message as any).message || 'Previous conversation context could not be restored.',
            recoverable: true,
          };
          continue;
        }

        // Save tool results to DB (from SDK user messages)
        if ((message as any).type === 'user') {
          const userContent = (message as any).message?.content;
          if (Array.isArray(userContent)) {
            for (const block of userContent) {
              if (block.type === 'tool_result' && block.tool_use_id) {
                const resultText = typeof block.content === 'string'
                  ? block.content
                  : Array.isArray(block.content)
                    ? block.content.map((c: any) => c.text || '').join('\n')
                    : JSON.stringify(block.content);
                const structured = (message as any).tool_use_result;
                const finalResult = structured?.stdout || structured?.stderr
                  ? [structured.stdout, structured.stderr].filter(Boolean).join('\n')
                  : resultText;
                try { callbacks.attachToolResult(block.tool_use_id, finalResult); } catch {}
              }
            }

            // Save user tool_result message to DB
            const parentToolUseId = userContent.find((b: any) => b.tool_use_id)?.tool_use_id || null;
            if (parentToolUseId) {
              const msgId = (message as any).uuid || uuidv4();
              try {
                callbacks.saveMessage({
                  id: msgId,
                  role: 'user',
                  content: userContent,
                  parentToolUseId,
                });
              } catch {}
            }
          }
        }

        // Save assistant messages to DB + yield TowerMessage
        if ((message as any).type === 'assistant') {
          const msgId = (message as any).uuid || uuidv4();
          const content = (message as any).message?.content || [];

          if (msgId !== currentAssistantId) {
            // New assistant message
            currentAssistantId = msgId;
            try {
              callbacks.saveMessage({
                id: msgId,
                role: 'assistant',
                content,
                parentToolUseId: (message as any).parent_tool_use_id,
              });
            } catch {}
          } else {
            // Streaming update
            try { callbacks.updateMessageContent(msgId, content); } catch {}
          }

          // Track edited files
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_use') {

                const toolName = block.name?.toLowerCase() || '';
                if ((toolName === 'write' || toolName === 'edit') && block.input?.file_path) {
                  editedFiles.add(block.input.file_path);
                }
              }
            }
          }

          // Yield TowerMessage
          yield {
            type: 'assistant',
            sessionId,
            msgId,
            content: this.convertContent(content),
            parentToolUseId: (message as any).parent_tool_use_id || null,
          };
        }

        // Turn metrics
        if ((message as any).type === 'result' && currentAssistantId) {
          const usage = (message as any).usage;
          // Context size = all input tokens (new + cache read + cache creation)
          const totalInputTokens = (usage?.input_tokens || 0)
            + (usage?.cache_read_input_tokens || 0)
            + (usage?.cache_creation_input_tokens || 0);
          try {
            callbacks.updateMessageMetrics(currentAssistantId, {
              durationMs: (message as any).duration_ms,
              inputTokens: totalInputTokens,
              outputTokens: usage?.output_tokens,
            });
          } catch {}

          yield {
            type: 'turn_done',
            sessionId,
            msgId: currentAssistantId,
            usage: {
              inputTokens: totalInputTokens,
              outputTokens: usage?.output_tokens || 0,
              cacheReadTokens: usage?.cache_read_input_tokens || 0,
              cacheCreationTokens: usage?.cache_creation_input_tokens || 0,
              durationMs: (message as any).duration_ms || 0,
            },
          };
        }
      }

      // Get final engine session ID
      const finalSessionId = getClaudeSessionId(sessionId) || engineSessionId;
      if (finalSessionId) {
        callbacks.claimSessionId(finalSessionId);
        backupSessionFile(finalSessionId, opts.cwd);
      }

      // Auto-commit edited files
      if (config.gitAutoCommit && editedFiles.size > 0) {
        try {
          await autoCommit(
            config.workspaceRoot,
            opts.username || 'anonymous',
            sessionId,
            [...editedFiles],
          );
          // commitResult broadcast is handled by ws-handler if needed
        } catch (err) {
          console.error('[Claude Engine] Auto-commit failed:', err);
        }
      }

      // Engine done
      yield {
        type: 'engine_done',
        sessionId,
        engineSessionId: finalSessionId,
        editedFiles: [...editedFiles],
        model: opts.model,
      };

    } catch (error: any) {
      const isAbort = /aborted by user|abort/i.test(error.message || '') || error.name === 'AbortError';
      const isSpawnError = /ENOENT|spawn.*failed/i.test(error.message || '');

      // Clear stale engineSessionId on resume failure (not on abort or spawn error)
      if (!isAbort && !isSpawnError && opts.engineSessionId &&
          /exited with code|session.*not found/i.test(error.message || '')) {
        callbacks.claimSessionId('');
      }

      if (!isAbort) {
        yield {
          type: 'engine_error',
          sessionId,
          message: error.message || 'Claude query failed',
        };
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Engine interface methods
  // ═══════════════════════════════════════════════════════════════

  async quickReply(prompt: string, opts: QuickReplyOpts): Promise<string> {
    const { query: sdkQuery } = await import('@anthropic-ai/claude-agent-sdk');
    const abortController = new AbortController();
    let fullContent = '';

    const response = sdkQuery({
      prompt,
      options: {
        abortController,
        pathToClaudeCodeExecutable: config.claudeExecutable,
        cwd: config.defaultCwd,
        permissionMode: 'plan',  // no tool execution
        model: opts.model,
        systemPrompt: opts.systemPrompt,
        maxTurns: 1,
      },
    });

    for await (const message of response) {
      if (message.type === 'assistant' && message.message?.content) {
        // SDK yields full accumulated content on each update (not deltas).
        // Extract all text blocks and compute delta from previous state.
        const currentText = (message.message.content as any[])
          .filter((b: any) => b.type === 'text' && b.text)
          .map((b: any) => b.text)
          .join('');

        if (currentText && currentText.length > fullContent.length) {
          const chunk = currentText.slice(fullContent.length);
          fullContent = currentText;
          opts.onChunk(chunk, fullContent);
        }
      }
    }

    return fullContent;
  }

  abort(sessionId: string): void {
    abortSession(sessionId);
  }

  dispose(sessionId: string): void {
    cleanupSession(sessionId);
  }

  isRunning(sessionId: string): boolean {
    return getSDKSession(sessionId)?.isRunning || false;
  }

  getActiveCount(): number {
    return getActiveSessionCount();
  }

  getRunningSessionIds(): string[] {
    return sdkGetRunningSessionIds();
  }

  init(): void {
    cleanupOrphanedSdkProcesses();
  }

  shutdown(): void {
    gracefulShutdown('shutdown');
    stopOrphanMonitor();
  }

  // ═══════════════════════════════════════════════════════════════
  // Claude-specific internals
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create canUseTool interceptor for Claude SDK.
   * Delegates to unified ToolGuard, then handles AskUserQuestion.
   */
  private createCanUseTool(
    _sessionId: string,
    guard: ToolGuard,
    callbacks: EngineCallbacks,
  ) {
    return async (toolName: string, input: Record<string, unknown>, _options: { signal: AbortSignal }) => {
      // Unified guard: damage control + path enforcement + project ACL + TeamCreate block
      const check = guard(toolName, input);
      if (!check.allowed) {
        return { behavior: 'deny' as const, message: check.message };
      }

      // Allow all non-AskUserQuestion tools
      if (toolName !== 'AskUserQuestion') {
        return { behavior: 'allow' as const, updatedInput: input };
      }

      // ── AskUserQuestion: delegate to ws-handler via callbacks ──
      const questionId = `q-${uuidv4()}`;
      const questions = (input as any).questions || [];

      const buildAnswersInput = (answersObj: Record<string, string>) => ({
        behavior: 'allow' as const,
        updatedInput: { ...input, answers: answersObj },
      });

      try {
        // callbacks.askUser broadcasts to session and waits for answer
        const answer = await callbacks.askUser(questionId, questions);

        // Parse structured "question: answer" lines
        const answersObj: Record<string, string> = {};
        const lines = answer.split('\n');
        for (const line of lines) {
          const colonIdx = line.indexOf(': ');
          if (colonIdx > -1) {
            answersObj[line.substring(0, colonIdx)] = line.substring(colonIdx + 2);
          }
        }
        return buildAnswersInput(answersObj);
      } catch {
        // Abort or timeout — deny
        return { behavior: 'deny' as const, message: 'Session aborted', interrupt: true };
      }
    };
  }

  /** Convert Claude SDK content blocks → TowerContentBlock[] */
  private convertContent(content: any[]): TowerContentBlock[] {
    if (!Array.isArray(content)) return [];
    return content.map(block => {
      if (block.type === 'text') return { type: 'text' as const, text: block.text || '' };
      if (block.type === 'thinking') return { type: 'thinking' as const, text: block.thinking || block.text || '' };
      if (block.type === 'tool_use') return {
        type: 'tool_use' as const,
        id: block.id || '',
        name: block.name || '',
        input: block.input || {},
      };
      // Fallback: render as text
      return { type: 'text' as const, text: JSON.stringify(block) };
    });
  }
}
