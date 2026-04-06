/**
 * Claude Code engine — wraps @anthropic-ai/claude-agent-sdk.
 *
 * Absorbs all Claude-specific logic from claude-sdk.ts and ws-handler.ts.
 * ws-handler.ts only sees the Engine interface; it never imports this file directly.
 *
 * To remove Claude: delete this file + remove 'claude' case from engines/index.ts.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Engine, RunOpts, EngineCallbacks, TowerMessage, TowerContentBlock, QuickReplyOpts, ChannelReplyOpts, ChannelReplyResult } from './types.js';
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
import { getConfigDir } from '../services/credential-store.js';

// CRITICAL: Remove CLAUDECODE env var to prevent SDK conflicts
delete process.env.CLAUDECODE;

function extractThinkingTitle(raw?: string): string | undefined {
  if (!raw) return undefined;

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const firstLine = lines[0];
  if (!firstLine) return undefined;

  const boldTitle = firstLine.match(/^\*\*(.+?)\*\*[：:]?$/);
  if (boldTitle?.[1]) return boldTitle[1].trim();

  const headingTitle = firstLine.match(/^#{1,6}\s+(.+)$/);
  if (headingTitle?.[1]) return headingTitle[1].trim();

  return undefined;
}

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

    // Resolve credential directory for this project (multi-account rotation)
    const configDir = await getConfigDir(opts.projectId);

    let engineSessionId: string | undefined;
    let currentAssistantId: string | null = null;
    const editedFiles = new Set<string>();
    let isCompacting = false;

    try {
      for await (const message of executeQuery(sessionId, prompt, {
        cwd: opts.cwd,
        resumeSessionId: opts.engineSessionId,
        permissionMode,
        model: opts.model,
        canUseTool,
        systemPrompt,
        userRole: opts.userRole,
        configDir,
      })) {
        // Track Claude session ID (in-memory only — DB claim deferred to engine_done
        // so that abort/crash leaves the previous verified ID in DB for safe resume)
        if ('session_id' in message && message.session_id) {
          engineSessionId = message.session_id;
        }

        // ── Autocompact lifecycle events ──
        if ((message as any).type === 'system') {
          const subtype = (message as any).subtype;
          const status = (message as any).status;

          if (subtype === 'compact_boundary') {
            isCompacting = true;
            yield { type: 'compact', sessionId, phase: 'boundary' };
            continue;
          }
          if (subtype === 'status') {
            if (status !== 'compacting') isCompacting = false;
            yield {
              type: 'compact',
              sessionId,
              phase: status === 'compacting' ? 'compacting' : 'done',
            };
            continue;
          }
        }

        // SDK may not send explicit status:null after compaction —
        // auto-close compacting when the first non-system message arrives
        if (isCompacting && (message as any).type !== 'system') {
          isCompacting = false;
          yield { type: 'compact', sessionId, phase: 'done' };
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
          const modelUsage = (message as any).modelUsage as Record<string, { contextWindow?: number }> | undefined;

          // Cumulative tokens across all iterations (for cost tracking)
          const cumulativeInputTokens = (usage?.input_tokens || 0)
            + (usage?.cache_read_input_tokens || 0)
            + (usage?.cache_creation_input_tokens || 0);

          // Context window usage = last iteration's input (= actual context size right now)
          // If iterations not available, contextInputTokens = 0 → frontend uses its own fallback with cap
          const iterations: Array<{ input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; type?: string }> | null = usage?.iterations;
          const lastIter = iterations?.filter(it => it.type === 'message').pop();
          const contextInputTokens = lastIter
            ? (lastIter.input_tokens || 0) + (lastIter.cache_read_input_tokens || 0) + (lastIter.cache_creation_input_tokens || 0)
            : 0; // no iterations → let frontend fallback with cap
          const contextOutputTokens = lastIter?.output_tokens ?? 0;

          // Model's context window size from SDK
          const contextWindowSize = modelUsage
            ? Math.max(...Object.values(modelUsage).map(m => m.contextWindow || 0)) || 0
            : 0;

          // Per-message metrics: prefer context (last iteration) for accurate display.
          // When iterations unavailable, estimate ≈ cumulative / numIterations.
          const iterCount = iterations?.filter(it => it.type === 'message').length || 1;
          const estimatedInput = contextInputTokens || Math.round(cumulativeInputTokens / iterCount);
          const estimatedOutput = contextOutputTokens || Math.round((usage?.output_tokens || 0) / iterCount);
          try {
            callbacks.updateMessageMetrics(currentAssistantId, {
              durationMs: (message as any).duration_ms,
              inputTokens: estimatedInput,
              outputTokens: estimatedOutput,
            });
          } catch {}

          yield {
            type: 'turn_done',
            sessionId,
            msgId: currentAssistantId,
            usage: {
              inputTokens: cumulativeInputTokens,
              outputTokens: usage?.output_tokens || 0,
              cacheReadTokens: usage?.cache_read_input_tokens || 0,
              cacheCreationTokens: usage?.cache_creation_input_tokens || 0,
              durationMs: (message as any).duration_ms || 0,
              // Context window tracking (last iteration = real context size)
              contextInputTokens,
              contextOutputTokens,
              contextWindowSize,
              numIterations: iterations?.filter(it => it.type === 'message').length || 1,
            },
          };
        }
      }

      // Get final engine session ID
      const finalSessionId = getClaudeSessionId(sessionId) || engineSessionId;
      if (finalSessionId) {
        callbacks.claimSessionId(finalSessionId);
        backupSessionFile(finalSessionId, opts.cwd, configDir);
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
        permissionMode: 'bypassPermissions',  // allow tool execution (read/write/bash)
        allowDangerouslySkipPermissions: true,
        model: opts.model,
        systemPrompt: opts.systemPrompt,
        maxTurns: 5,  // allow multi-turn tool usage
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

  /**
   * Persistent channel reply — wraps executeQuery with resume support.
   * Streams only text content; tool_use triggers onToolUse callback.
   * Returns content + engineSessionId for next resume.
   */
  async channelReply(prompt: string, opts: ChannelReplyOpts): Promise<ChannelReplyResult> {
    // Use a stable internal session ID for the channel AI query
    const internalSessionId = `channel-ai-${Date.now()}`;
    let fullContent = '';
    let engineSessionId: string | undefined;

    try {
      for await (const message of executeQuery(internalSessionId, prompt, {
        cwd: config.defaultCwd,
        resumeSessionId: opts.resumeSessionId,
        permissionMode: 'bypassPermissions',
        model: opts.model,
        systemPrompt: opts.systemPrompt,
        maxTurns: opts.maxTurns ?? 10,
      })) {
        // Track session ID for resume
        if ('session_id' in message && (message as any).session_id) {
          engineSessionId = (message as any).session_id;
        }

        // Handle autocompact lifecycle
        if ((message as any).type === 'system') {
          const subtype = (message as any).subtype;
          const status = (message as any).status;
          if (subtype === 'compact_boundary') {
            opts.onCompact?.('boundary');
            continue;
          }
          if (subtype === 'status') {
            opts.onCompact?.(status === 'compacting' ? 'compacting' : 'done');
            continue;
          }
        }

        // Extract text from assistant messages
        if ((message as any).type === 'assistant' && (message as any).message?.content) {
          const content = (message as any).message.content as any[];

          // Notify tool use for status indicators
          for (const block of content) {
            if (block.type === 'tool_use' && block.name) {
              opts.onToolUse?.(block.name);
            }
          }

          // Extract text and compute delta
          const currentText = content
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
    } finally {
      // Clean up the internal session tracking (but don't kill the SDK process — it's done)
      cleanupSession(internalSessionId);
    }

    // Get the final session ID from SDK tracking
    const finalSessionId = getClaudeSessionId(internalSessionId) || engineSessionId;

    // Backup session file for resilience
    if (finalSessionId) {
      backupSessionFile(finalSessionId, config.defaultCwd);
    }

    return {
      content: fullContent,
      engineSessionId: finalSessionId,
    };
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
      if (block.type === 'thinking') {
        const thinkingText = block.thinking || block.text || '';
        const thinkingTitle = typeof block.title === 'string'
          ? block.title
          : extractThinkingTitle(thinkingText);
        return { type: 'thinking' as const, text: thinkingText, title: thinkingTitle };
      }
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
