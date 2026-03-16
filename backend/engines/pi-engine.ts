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
import { createAgentTool } from './pi-agent-tool.js';
import { excelReadTool, excelQueryTool } from './pi-finance-tools.js';
import { pdfReadTool, excelWriteTool, excelDiffTool } from './pi-finance-tools-extra.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Types from Pi SDK (not exported directly) ──
type AgentSession = Awaited<ReturnType<typeof createAgentSession>>['session'];

interface PiSessionEntry {
  session: AgentSession;
  isRunning: boolean;
}

export class PiEngine implements Engine {
  private sessions = new Map<string, PiSessionEntry>();
  private authStorage: AuthStorage | null = null;
  private modelRegistry: ModelRegistry | null = null;

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
          reasoning: false,
          input: ['text', 'image'] as ('text' | 'image')[],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200000,
          maxTokens: 16384,
        });
        byProvider.set(m.provider, list);
      }

      // Register each provider with its models
      for (const [provider, providerModels] of byProvider) {
        // Only register models that aren't already in the registry
        const newModels = providerModels.filter((m: any) => !registry.find(provider, m.id));
        if (newModels.length > 0) {
          // Get existing models for this provider to merge
          const existing = registry.getAll().filter((m: any) => m.provider === provider);
          const allModels = [
            ...existing.map((m: any) => ({
              id: m.id,
              name: m.name,
              reasoning: m.reasoning,
              input: m.input,
              cost: m.cost,
              contextWindow: m.contextWindow,
              maxTokens: m.maxTokens,
            })),
            ...newModels,
          ];
          registry.registerProvider(provider, { models: allModels });
          console.log(`[Pi] Registered ${newModels.length} custom model(s) for provider "${provider}": ${newModels.map((m: any) => m.id).join(', ')}`);
        }
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
    // 1. Get or create AgentSession (cached per Tower session)
    let entry = this.sessions.get(sessionId);
    if (!entry) {
      try {
        entry = await this.createSession(sessionId, opts);
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

    entry.isRunning = true;

    // 2. ContentAccumulator + event queue
    const accumulator = new ContentAccumulator();
    const msgId = crypto.randomUUID();
    const eventQueue: TowerMessage[] = [];
    let resolveWait: (() => void) | null = null;
    let done = false;

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
          if (usage) {
            callbacks.updateMessageMetrics(msgId, {
              inputTokens: usage.input || 0,
              outputTokens: usage.output || 0,
            });

            eventQueue.push({
              type: 'turn_done',
              sessionId,
              msgId,
              usage: {
                inputTokens: usage.input || 0,
                outputTokens: usage.output || 0,
                costUsd: usage.cost?.total,
                durationMs: 0,
              },
            });
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
        done = true;
        resolveWait?.();
      })
      .catch((err: any) => {
        eventQueue.push({
          type: 'engine_error',
          sessionId,
          message: err.message || 'Pi prompt failed',
        });
        done = true;
        resolveWait?.();
      });

    // 5. Yield loop
    try {
      while (!done || eventQueue.length > 0) {
        if (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        } else {
          await new Promise<void>(r => { resolveWait = r; });
          resolveWait = null;
        }
      }
      await promptPromise;

      // 6. Engine done
      yield {
        type: 'engine_done',
        sessionId,
        editedFiles: [...editedFiles],
      };
    } finally {
      unsub();
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

  private async createSession(sessionId: string, opts: RunOpts): Promise<PiSessionEntry> {
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
    const towerPrompt = buildSystemPrompt({
      userId: opts.userId,
      username: opts.username || 'anonymous',
      role: opts.userRole || 'member',
      allowedPath: opts.allowedPath,
    });

    const resourceLoader = new DefaultResourceLoader({
      cwd: opts.cwd,
      appendSystemPrompt: towerPrompt,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: opts.cwd,
      model,
      tools: [readTool, bashTool, editTool, writeTool, grepTool, findTool, lsTool],
      customTools: [createAgentTool(auth, registry), excelReadTool, excelQueryTool, pdfReadTool, excelWriteTool, excelDiffTool],
      authStorage: auth,
      modelRegistry: registry,
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: true },
        retry: { enabled: true, maxRetries: 2 },
      }),
    });

    const entry: PiSessionEntry = { session, isRunning: false };
    this.sessions.set(sessionId, entry);
    console.log(`[Pi] Session created: ${sessionId.slice(0, 8)} model=${model?.provider}/${model?.id}`);
    return entry;
  }

  async quickReply(prompt: string, opts: QuickReplyOpts): Promise<string> {
    // Pi quick reply: use OpenRouter API directly (lightweight, no session needed)
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured for Pi quick reply');

    // Parse model: "openrouter/anthropic/claude-sonnet-4.6" → "anthropic/claude-sonnet-4.6"
    let modelId = opts.model || '';
    if (modelId.startsWith('openrouter/')) modelId = modelId.slice('openrouter/'.length);
    if (!modelId) {
      // Fallback to first available Pi model
      const registry = this.getModelRegistry();
      const available = registry.getAvailable();
      if (available.length > 0) modelId = `${available[0].provider === 'openrouter' ? '' : ''}${available[0].id}`;
      else throw new Error('No Pi models available');
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 2048,
        stream: true,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errBody.slice(0, 200)}`);
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
      entry.session.abort();
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

  // Pi has no orphan processes (in-process SDK)
  init(): void {}

  shutdown(): void {
    for (const entry of this.sessions.values()) {
      try { entry.session.dispose(); } catch {}
    }
    this.sessions.clear();
  }
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
      input: toolCall.arguments,  // Pi: arguments → Tower: input
    });
  }

  toTowerBlocks(): TowerContentBlock[] {
    // Return deep-ish copy to avoid mutation issues
    return this.blocks.map(b => ({ ...b }));
  }
}
