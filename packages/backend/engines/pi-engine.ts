/**
 * Pi coding agent engine — wraps @mariozechner/pi-coding-agent SDK.
 *
 * Uses OpenRouter (or any Pi-supported provider) for LLM calls.
 * Converts Pi's delta-based streaming events to cumulative TowerMessage format.
 *
 * To remove: delete this file + remove 'pi' case from engines/index.ts.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Engine, RunOpts, EngineCallbacks, TowerMessage, TowerContentBlock, QuickReplyOpts } from './types.js';
import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  readTool, bashTool, editTool, writeTool, grepTool, findTool, lsTool,
} from '@mariozechner/pi-coding-agent';
import { buildSystemPrompt } from '../services/system-prompt.js';
import { buildToolGuard, wrapPiTools } from '../services/project-access.js';
import { backupPiSessionFile, consumeInterruptedPiSessions, gracefulPiShutdown, preparePiResumeSession } from '../services/pi-session-runtime.js';
import { createAgentTool } from './pi-agent-tool.js';
import { createAskUserQuestionTool } from './pi-ask-user-tool.js';
import { webFetchTool, webSearchTool } from './pi-web-tools.js';
import { excelReadTool, excelQueryTool } from './pi-finance-tools.js';
import { pdfReadTool, excelWriteTool, excelDiffTool } from './pi-finance-tools-extra.js';
import { todoWriteTool } from './pi-todo-tool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Types from Pi SDK (not exported directly) ──
type AgentSession = Awaited<ReturnType<typeof createAgentSession>>['session'];

interface PiSessionEntry {
  session: AgentSession;
  isRunning: boolean;
  abortRequested?: boolean;
  activePrompt?: Promise<void> | null;
  _abortResolve?: (() => void) | null;
  /** Set by createSession when resume fails — run() yields engine_error(recoverable) */
  resumeFailedMessage?: string | null;
}

export class PiEngine implements Engine {
  private sessions = new Map<string, PiSessionEntry>();
  private authStorage: AuthStorage | null = null;
  private modelRegistry: ModelRegistry | null = null;
  private interruptedSessionIds = new Set<string>();

  private getAuth(): AuthStorage {
    if (!this.authStorage) {
      this.authStorage = AuthStorage.create();
      // Inject API keys from environment
      if (process.env.OPENROUTER_API_KEY) {
        this.authStorage.setRuntimeApiKey('openrouter', process.env.OPENROUTER_API_KEY);
      }
      if (process.env.ANTHROPIC_API_KEY) {
        this.authStorage.setRuntimeApiKey('anthropic', process.env.ANTHROPIC_API_KEY);
      }
      if (process.env.OPENAI_API_KEY) {
        this.authStorage.setRuntimeApiKey('openai', process.env.OPENAI_API_KEY);
      }
      if (process.env.AZURE_OPENAI_API_KEY) {
        this.authStorage.setRuntimeApiKey('azure-openai-responses', process.env.AZURE_OPENAI_API_KEY);
      }
    }
    return this.authStorage;
  }

  private getModelRegistry(): ModelRegistry {
    if (!this.modelRegistry) {
      this.modelRegistry = new ModelRegistry(this.getAuth());
      this.registerCustomModels(this.modelRegistry);
    }
    return this.modelRegistry;
  }

  /** Register custom models from pi-models.json so Pi SDK recognizes them */
  private registerCustomModels(registry: ModelRegistry) {
    try {
      const jsonPath = path.join(__dirname, 'pi-models.json');
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const models = data.models || [];

      // Group by provider
      const byProvider = new Map<string, any[]>();
      for (const m of models) {
        const list = byProvider.get(m.provider) || [];
        list.push({
          id: m.modelId,
          name: m.name || m.modelId,
          api: m.api || m.provider,
          reasoning: false,
          input: ['text', 'image'] as ('text' | 'image')[],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200000,
          maxTokens: 16384,
        });
        byProvider.set(m.provider, list);
      }

      // registerProvider replaces ALL models for that provider, so we must
      // include every custom model (not filter out "existing" ones).
      for (const [provider, providerModels] of byProvider) {
        const providerOpts: any = { models: providerModels };
        if (provider === 'azure-openai-responses') {
          providerOpts.baseUrl = process.env.AZURE_OPENAI_BASE_URL || '';
          providerOpts.apiKey = process.env.AZURE_OPENAI_API_KEY || '';
        } else if (provider === 'openrouter') {
          providerOpts.apiKey = process.env.OPENROUTER_API_KEY || '';
        }
        registry.registerProvider(provider, providerOpts);
        console.log(`[Pi] Registered ${providerModels.length} custom model(s) for provider "${provider}": ${providerModels.map((m: any) => m.id).join(', ')}`);
      }
    } catch (err: any) {
      console.warn(`[Pi] Failed to load custom models: ${err.message}`);
    }
  }

  async *run(
    sessionId: string,
    prompt: string,
    opts: RunOpts,
    callbacks: EngineCallbacks,
  ): AsyncGenerator<TowerMessage> {
    // 1. Get or create AgentSession (cached per Tower session, persisted to disk)
    let entry = this.sessions.get(sessionId);
    if (!entry) {
      try {
        entry = await this.createSession(sessionId, opts, callbacks);
      } catch (err: any) {
        yield { type: 'engine_error', sessionId, message: `Pi session creation failed: ${err.message}` };
        return;
      }
    }

    // Switch model if user changed it mid-session
    if (opts.model) {
      try {
        await this.switchModelIfNeeded(entry, opts.model);
      } catch (err: any) {
        console.warn(`[Pi] Model switch failed: ${err.message}`);
      }
    }

    // G3: Notify frontend if Pi resume failed (before starting the turn)
    if (entry.resumeFailedMessage) {
      yield {
        type: 'engine_error',
        sessionId,
        message: entry.resumeFailedMessage,
        recoverable: true,
      };
      entry.resumeFailedMessage = null;
    }

    entry.isRunning = true;
    entry.abortRequested = false;

    // 2. ContentAccumulator + event queue
    const accumulator = new ContentAccumulator();
    const msgId = crypto.randomUUID();
    const eventQueue: TowerMessage[] = [];
    let resolveWait: (() => void) | null = null;
    let done = false;
    let stopReason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' | undefined;
    const turnStartTime = Date.now();

    // G2: Track iteration count + cumulative tokens for context metrics.
    // Pi emits message_end for intermediate tool-use messages too.
    // Hold the latest usage until the whole prompt is actually finished.
    let iterationCount = 0;
    let cumulativeInput = 0;
    let cumulativeOutput = 0;
    let lastIterationInput = 0;
    let lastIterationOutput = 0;
    let lastCostUsd: number | undefined;
    // Resolve model context window from the session's current model
    const modelContextWindow = entry.session.model?.contextWindow || 200_000;

    // Save initial assistant message to DB
    let assistantSaved = false;

    // 3. Subscribe to Pi events
    const unsub = entry.session.subscribe((event: any) => {
      switch (event.type) {
        case 'message_update': {
          const evt = event.assistantMessageEvent;
          if (evt?.type === 'text_delta') {
            accumulator.appendText(evt.delta);
          } else if (evt?.type === 'thinking_delta') {
            accumulator.appendThinking(evt.delta);
          } else if (evt?.type === 'toolcall_end' && evt.toolCall) {
            accumulator.addToolUse(evt.toolCall);
          } else if (evt?.type === 'done' || evt?.type === 'error') {
            stopReason = evt.reason || stopReason;
          }

          const content = accumulator.toTowerBlocks();
          // DB save
          if (!assistantSaved) {
            callbacks.saveMessage({ id: msgId, role: 'assistant', content });
            assistantSaved = true;
          } else {
            callbacks.updateMessageContent(msgId, content);
          }

          eventQueue.push({ type: 'assistant', sessionId, msgId, content });
          resolveWait?.();
          break;
        }

        case 'tool_execution_end': {
          const resultContent = event.result?.content;
          const resultText = Array.isArray(resultContent)
            ? resultContent.map((c: any) => c.text || '').join('\n')
            : JSON.stringify(event.result);

          if (event.toolCallId) {
            callbacks.attachToolResult(event.toolCallId, resultText);
          }

          // Track edited files
          const toolName = (event.toolName || '').toLowerCase();
          if (toolName === 'write' || toolName === 'edit') {
            // Pi tool args are in event.args
            const filePath = event.args?.path || event.args?.file_path;
            if (filePath) editedFiles.add(filePath);
          }

          resolveWait?.();
          break;
        }

        case 'message_end': {
          const msg = event.message;
          const usage = msg?.usage;
          stopReason = msg?.stopReason || stopReason;

          if (msg?.role === 'assistant' && Array.isArray(msg.content)) {
            const finalContent = agentMessageToTowerBlocks(msg);
            accumulator.replaceAll(finalContent);
            if (!assistantSaved) {
              callbacks.saveMessage({ id: msgId, role: 'assistant', content: finalContent });
              assistantSaved = true;
            } else {
              callbacks.updateMessageContent(msgId, finalContent);
            }
            eventQueue.push({ type: 'assistant', sessionId, msgId, content: finalContent });
          }

          if (usage) {
            iterationCount++;
            const iterInput = usage.input || 0;
            const iterOutput = usage.output || 0;
            cumulativeInput += iterInput;
            cumulativeOutput += iterOutput;
            lastIterationInput = iterInput;
            lastIterationOutput = iterOutput;
            lastCostUsd = usage.cost?.total;
          }
          resolveWait?.();
          break;
        }
      }
    });

    const editedFiles = new Set<string>();

    // 4. Execute prompt
    const promptPromise = entry.session.prompt(prompt)
      .then(() => {
        if (iterationCount > 0) {
          const durationMs = Date.now() - turnStartTime;
          // Per-message metrics: use last iteration (= current context size)
          callbacks.updateMessageMetrics(msgId, {
            durationMs,
            inputTokens: lastIterationInput,
            outputTokens: lastIterationOutput,
          });
          eventQueue.push({
            type: 'turn_done',
            sessionId,
            msgId,
            usage: {
              inputTokens: cumulativeInput,
              outputTokens: cumulativeOutput,
              costUsd: lastCostUsd,
              durationMs,
              stopReason,
              // G2: Context window tracking — same contract as Claude engine
              contextInputTokens: lastIterationInput,
              contextOutputTokens: lastIterationOutput,
              contextWindowSize: modelContextWindow,
              numIterations: iterationCount,
            },
          });
        }
      })
      .catch((err: any) => {
        const message = err?.message || 'Pi prompt failed';
        const isAbortError = entry.abortRequested && /abort|cancel/i.test(message);
        if (!isAbortError) {
          eventQueue.push({
            type: 'engine_error',
            sessionId,
            message,
          });
        }
      })
      .finally(() => {
        done = true;
        resolveWait?.();
      });
    entry.activePrompt = promptPromise;

    // 5. Yield loop (with abort detection)
    // Store abort resolver on entry so abort() can break the loop,
    // but keep isRunning=true until Pi's prompt promise actually settles.
    try {
      while (!done || eventQueue.length > 0) {
        if (entry.abortRequested && eventQueue.length === 0) {
          break;
        }
        if (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        } else {
          await new Promise<void>(r => {
            resolveWait = r;
            entry._abortResolve = r;
          });
          resolveWait = null;
          entry._abortResolve = null;
        }
      }

      await promptPromise;

      // 6. Engine done — include session file path for persistence
      const piSessionFile = entry.session.sessionFile;
      if (piSessionFile) {
        backupPiSessionFile(piSessionFile);
        this.interruptedSessionIds.delete(sessionId);
      }
      yield {
        type: 'engine_done',
        sessionId,
        engineSessionId: piSessionFile,
        editedFiles: [...editedFiles],
      };
    } finally {
      unsub();
      entry.activePrompt = null;
      entry.abortRequested = false;
      entry._abortResolve = null;
      entry.isRunning = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Session lifecycle
  // ═══════════════════════════════════════════════════════════════

  /** Switch model on existing session if user selected a different one */
  private async switchModelIfNeeded(entry: PiSessionEntry, modelStr: string) {
    const parts = modelStr.split('/');
    if (parts.length < 2) return;
    const provider = parts[0];
    const modelId = parts.slice(1).join('/');

    const currentModel = entry.session.model;
    if (currentModel && currentModel.provider === provider && currentModel.id === modelId) {
      return; // same model, no switch needed
    }

    const registry = this.getModelRegistry();
    const newModel = registry.find(provider, modelId);
    if (newModel) {
      await entry.session.setModel(newModel);
      console.log(`[Pi] Model switched to ${provider}/${modelId}`);
    }
  }

  private async createSession(sessionId: string, opts: RunOpts, callbacks?: EngineCallbacks): Promise<PiSessionEntry> {
    const auth = this.getAuth();
    const registry = this.getModelRegistry();

    // Parse model string: "openrouter/anthropic/claude-sonnet-4" → provider=openrouter, id=anthropic/claude-sonnet-4
    let model: any = undefined;
    if (opts.model) {
      const parts = opts.model.split('/');
      if (parts.length >= 2) {
        const provider = parts[0];
        const modelId = parts.slice(1).join('/');

        // Registry now includes custom models from pi-models.json (via registerCustomModels)
        model = registry.find(provider, modelId);
        if (!model) {
          console.warn(`[Pi] Model ${opts.model} not found in registry (check pi-models.json)`);
        }
      }
    }

    // Fallback: first available model
    if (!model) {
      const available = registry.getAvailable();
      if (available.length > 0) {
        model = available[0];
        console.log(`[Pi] Using fallback model: ${model.provider}/${model.id}`);
      }
    }

    // ── Build Tower context for Pi ──
    // Pi SDK auto-discovers AGENTS.md/CLAUDE.md from cwd — let it.
    // Tower only injects what Pi can't know: user identity, team rules, path restrictions.
    const towerPrompt = await buildSystemPrompt({
      userId: opts.userId,
      username: opts.username || 'anonymous',
      role: opts.userRole || 'member',
      allowedPath: opts.allowedPath,
    });

    // Build additional skill paths for 3-tier skill registry
    const additionalSkillPaths: string[] = [];
    try {
      const { getCompanySkillsDir, getPersonalSkillPaths, getProjectSkillPaths } = await import('../services/skill-registry.js');
      additionalSkillPaths.push(getCompanySkillsDir());
      additionalSkillPaths.push(...getPersonalSkillPaths(opts.userId));
      additionalSkillPaths.push(...getProjectSkillPaths(opts.cwd));
    } catch {}

    const resourceLoader = new DefaultResourceLoader({
      cwd: opts.cwd,
      appendSystemPrompt: towerPrompt,
      additionalSkillPaths,
    });
    await resourceLoader.reload();

    // ── Session persistence ──
    // Use file-based SessionManager so Pi remembers conversation across server restarts.
    // engineSessionId (from Tower DB) points to a Pi session file path.
    const piSessionDir = path.join(opts.cwd, '.pi', 'sessions');
    fs.mkdirSync(piSessionDir, { recursive: true });

    let sessionMgr: ReturnType<typeof SessionManager.create>;
    let resumeFailedMsg: string | null = null;
    const resumeSessionFile = opts.engineSessionId
      ? preparePiResumeSession(opts.engineSessionId)
      : undefined;
    if (resumeSessionFile) {
      // Resume existing session
      try {
        sessionMgr = SessionManager.open(resumeSessionFile, piSessionDir);
        console.log(`[Pi] Resuming session: ${sessionId.slice(0, 8)} from ${resumeSessionFile}`);
      } catch (err: any) {
        console.warn(`[Pi] Resume failed (${err.message}), creating new session`);
        sessionMgr = SessionManager.create(opts.cwd, piSessionDir);
        // Do NOT clear session ID — clearing causes permanent context loss.
        // The explicit error message below tells the user what happened.
        // Flag will be set on entry after creation → run() yields recoverable error
        resumeFailedMsg = `Previous Pi conversation could not be restored: ${err.message}`;
      }
    } else {
      if (opts.engineSessionId) {
        console.log(`[Pi] Resume skipped (missing file/backup): ${opts.engineSessionId}`);
      }
      sessionMgr = SessionManager.create(opts.cwd, piSessionDir);
    }

    // Build unified tool guard and wrap Pi tools with it
    let piTools: any[] = [readTool, bashTool, editTool, writeTool, grepTool, findTool, lsTool];
    const guard = buildToolGuard({
      role: opts.userRole || 'member',
      allowedPath: opts.allowedPath,
      accessiblePaths: opts.accessiblePaths,
    });
    // Always wrap — guard handles damage control + path enforcement + project ACL
    piTools = wrapPiTools(piTools, guard);
    console.log(`[Pi] ToolGuard active (role=${opts.userRole || 'member'}, accessiblePaths=${opts.accessiblePaths === null ? 'admin' : opts.accessiblePaths?.length ?? 'none'})`);

    const customTools = [
      createAgentTool(auth, registry, guard),
      createAskUserQuestionTool(callbacks?.askUser || (async () => 'No user answer available.')),
      webFetchTool,
      webSearchTool,
      excelReadTool,
      excelQueryTool,
      pdfReadTool,
      excelWriteTool,
      excelDiffTool,
      todoWriteTool,
    ];

    const { session } = await createAgentSession({
      cwd: opts.cwd,
      model,
      tools: piTools,
      customTools: wrapPiTools(customTools, guard),
      authStorage: auth,
      modelRegistry: registry,
      resourceLoader,
      sessionManager: sessionMgr,
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: true },
        retry: { enabled: true, maxRetries: 2 },
      }),
    });

    // Claim the session file path so Tower DB can restore it later
    const sessionFile = sessionMgr.getSessionFile();
    if (sessionFile) {
      backupPiSessionFile(sessionFile);
      if (callbacks) {
        callbacks.claimSessionId(sessionFile);
      }
      console.log(`[Pi] Session file: ${sessionFile}`);
    }

    const entry: PiSessionEntry = { session, isRunning: false, abortRequested: false, activePrompt: null, _abortResolve: null, resumeFailedMessage: resumeFailedMsg };
    this.sessions.set(sessionId, entry);
    console.log(`[Pi] Session created: ${sessionId.slice(0, 8)} model=${model?.provider}/${model?.id}`);
    return entry;
  }

  async quickReply(prompt: string, opts: QuickReplyOpts): Promise<string> {
    // Parse model provider: "azure-openai-responses/gpt-5.4" or "openrouter/..."
    const modelStr = opts.model || '';
    const isAzure = modelStr.startsWith('azure-openai-responses/');

    if (isAzure) {
      return this.quickReplyAzure(prompt, opts, modelStr.slice('azure-openai-responses/'.length));
    }

    // Pi quick reply: use OpenRouter API directly (lightweight, no session needed)
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured for Pi quick reply');

    // Parse model: "openrouter/anthropic/claude-sonnet-4.6" → "anthropic/claude-sonnet-4.6"
    let modelId = modelStr;
    if (modelId.startsWith('openrouter/')) modelId = modelId.slice('openrouter/'.length);
    if (!modelId) {
      // Fallback to first available Pi model
      const registry = this.getModelRegistry();
      const available = registry.getAvailable();
      if (available.length > 0) modelId = `${available[0].provider === 'openrouter' ? '' : ''}${available[0].id}`;
      else throw new Error('No Pi models available');
    }

    return this.streamChatCompletion(prompt, opts, 'https://openrouter.ai/api/v1/chat/completions', {
      'Authorization': `Bearer ${apiKey}`,
    }, modelId);
  }

  private async quickReplyAzure(prompt: string, opts: QuickReplyOpts, modelId: string): Promise<string> {
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    if (!apiKey) throw new Error('AZURE_OPENAI_API_KEY not configured');

    const baseUrl = (process.env.AZURE_OPENAI_BASE_URL || '').replace(/\/$/, '');
    if (!baseUrl) throw new Error('AZURE_OPENAI_BASE_URL not configured');

    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-03-01-preview';

    // Resolve deployment name via AZURE_OPENAI_DEPLOYMENT_NAME_MAP (e.g. "gpt-5.4=gpt-54-tower")
    const deploymentName = this.resolveAzureDeployment(modelId);

    // Strip trailing /openai if present (Pi SDK expects it in AZURE_OPENAI_BASE_URL, but chat completions URL includes /openai/)
    const rawBase = baseUrl.replace(/\/openai$/, '');
    const url = `${rawBase}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
    return this.streamChatCompletion(prompt, opts, url, { 'api-key': apiKey }, modelId);
  }

  private resolveAzureDeployment(modelId: string): string {
    const mapStr = process.env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP || '';
    for (const entry of mapStr.split(',')) {
      const [id, deployment] = entry.trim().split('=', 2);
      if (id?.trim() === modelId && deployment?.trim()) return deployment.trim();
    }
    return modelId; // fallback: use model ID as deployment name
  }

  private async streamChatCompletion(
    prompt: string,
    opts: QuickReplyOpts,
    url: string,
    extraHeaders: Record<string, string>,
    modelId: string,
  ): Promise<string> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify({
        model: modelId,
        max_completion_tokens: 2048,
        stream: true,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`API error ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') continue;

        try {
          const event = JSON.parse(jsonStr);
          const delta = event.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            opts.onChunk(delta, fullContent);
          }
        } catch { /* skip */ }
      }
    }

    return fullContent;
  }

  abort(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry?.isRunning) {
      entry.abortRequested = true;
      entry.session.abort();
      // Force-resolve the yield loop in case SDK doesn't emit events after abort,
      // but keep isRunning=true until the prompt promise actually settles.
      entry._abortResolve?.();
    }
  }

  dispose(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.session.dispose();
      this.sessions.delete(sessionId);
    }
  }

  isRunning(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.isRunning || false;
  }

  getActiveCount(): number {
    let count = 0;
    for (const entry of this.sessions.values()) {
      if (entry.isRunning) count++;
    }
    return count;
  }

  getRunningSessionIds(): string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.sessions) {
      if (entry.isRunning) ids.push(id);
    }
    return ids;
  }

  // Pi has no orphan processes (in-process SDK), but we still keep interrupted-session metadata.
  init(): void {
    this.interruptedSessionIds = new Set(consumeInterruptedPiSessions());
  }

  shutdown(): void {
    const runningSessionIds = [...this.sessions.entries()]
      .filter(([, entry]) => entry.isRunning)
      .map(([sessionId]) => sessionId);
    this.interruptedSessionIds = new Set(runningSessionIds);
    gracefulPiShutdown(runningSessionIds);
    for (const entry of this.sessions.values()) {
      try { entry.session.dispose(); } catch {}
    }
    this.sessions.clear();
  }
}

// ═══════════════════════════════════════════════════════════════
// Tool input normalization: Pi uses `path`, Tower standard is `file_path`
// ═══════════════════════════════════════════════════════════════

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'read', 'write', 'edit']);

function normalizeToolInput(name: string, input: Record<string, any>): Record<string, any> {
  if (FILE_TOOLS.has(name) && input.path && !input.file_path) {
    return { ...input, file_path: input.path };
  }
  return input;
}

// ═══════════════════════════════════════════════════════════════
// ContentAccumulator: Pi delta → cumulative TowerContentBlock[]
// ═══════════════════════════════════════════════════════════════

class ContentAccumulator {
  private blocks: TowerContentBlock[] = [];
  private currentTextIdx = -1;
  private currentThinkingIdx = -1;

  appendText(delta: string) {
    if (this.currentTextIdx >= 0 && this.blocks[this.currentTextIdx].type === 'text') {
      (this.blocks[this.currentTextIdx] as any).text += delta;
    } else {
      this.currentTextIdx = this.blocks.length;
      this.currentThinkingIdx = -1;
      this.blocks.push({ type: 'text', text: delta });
    }
  }

  appendThinking(delta: string) {
    if (this.currentThinkingIdx >= 0 && this.blocks[this.currentThinkingIdx].type === 'thinking') {
      (this.blocks[this.currentThinkingIdx] as any).text += delta;
    } else {
      this.currentThinkingIdx = this.blocks.length;
      this.currentTextIdx = -1;
      this.blocks.push({ type: 'thinking', text: delta });
    }
  }

  addToolUse(toolCall: { id: string; name: string; arguments: Record<string, any> }) {
    this.currentTextIdx = -1;
    this.currentThinkingIdx = -1;
    this.blocks.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.name,
      input: normalizeToolInput(toolCall.name, toolCall.arguments),  // Pi: arguments → Tower: input (normalized)
    });
  }

  replaceAll(blocks: TowerContentBlock[]) {
    this.blocks = blocks.map(b => ({ ...b }));
    this.currentTextIdx = -1;
    this.currentThinkingIdx = -1;
    const last = this.blocks[this.blocks.length - 1];
    if (last?.type === 'text') this.currentTextIdx = this.blocks.length - 1;
    if (last?.type === 'thinking') this.currentThinkingIdx = this.blocks.length - 1;
  }

  toTowerBlocks(): TowerContentBlock[] {
    // Return deep-ish copy to avoid mutation issues
    return this.blocks.map(b => ({ ...b }));
  }
}

function agentMessageToTowerBlocks(message: any): TowerContentBlock[] {
  if (!Array.isArray(message?.content)) return [];
  return message.content.flatMap((block: any) => {
    if (block?.type === 'text' && typeof block.text === 'string') {
      return [{ type: 'text', text: block.text } satisfies TowerContentBlock];
    }
    if (block?.type === 'thinking' && typeof block.thinking === 'string') {
      return [{ type: 'thinking', text: block.thinking } satisfies TowerContentBlock];
    }
    if (block?.type === 'toolCall' && block.id && block.name) {
      return [{
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: normalizeToolInput(block.name, block.arguments || {}),
      } satisfies TowerContentBlock];
    }
    return [];
  });
}

