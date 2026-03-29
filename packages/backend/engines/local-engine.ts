/**
 * Local LLM engine — connects to any OpenAI-compatible API (e.g. llama.cpp, vLLM, Ollama).
 *
 * Uses streaming chat completions via fetch (no SDK dependency).
 * Loads conversation history from DB for multi-turn context.
 *
 * To remove: delete this file + remove 'local' case from engines/index.ts.
 */

import crypto from 'crypto';
import type {
  Engine, RunOpts, EngineCallbacks, TowerMessage,
  TowerContentBlock, QuickReplyOpts,
} from './types.js';
import { getMessages as loadSessionMessages } from '../services/message-store.js';
import { buildSystemPrompt } from '../services/system-prompt.js';
import { config } from '../config.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LocalSessionEntry {
  isRunning: boolean;
  abortController: AbortController | null;
}

// ═══════════════════════════════════════════════════════════════
// Engine
// ═══════════════════════════════════════════════════════════════

export class LocalEngine implements Engine {
  private sessions = new Map<string, LocalSessionEntry>();

  private get baseUrl(): string {
    return (config as any).localLlmBaseUrl || 'http://localhost:8080';
  }

  private get apiKey(): string {
    return (config as any).localLlmApiKey || '';
  }

  private get defaultModel(): string {
    return (config as any).localLlmDefaultModel || '';
  }

  /**
   * Build OpenAI-format message history from Tower DB messages.
   * Skips tool_use/tool_result blocks — local LLMs don't use tools.
   */
  private async buildHistory(sessionId: string, currentPrompt: string, opts: RunOpts): Promise<OpenAIChatMessage[]> {
    const messages: OpenAIChatMessage[] = [];

    // System prompt
    const systemPrompt = await buildSystemPrompt({
      userId: opts.userId,
      username: opts.username || 'anonymous',
      role: opts.userRole || 'member',
      allowedPath: opts.allowedPath,
    });
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // Load conversation history from DB
    const stored = await loadSessionMessages(sessionId);
    for (const msg of stored) {
      const role = msg.role === 'assistant' ? 'assistant' : 'user';
      try {
        const blocks = JSON.parse(msg.content);
        const text = blocks
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n');
        if (text.trim()) {
          messages.push({ role, content: text });
        }
      } catch {
        // content might be plain string
        if (typeof msg.content === 'string' && msg.content.trim()) {
          messages.push({ role, content: msg.content });
        }
      }
    }

    // Current user message (already saved to DB by ws-handler, but ensure it's last)
    // Check if the last message in history is already the current prompt
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== currentPrompt) {
      messages.push({ role: 'user', content: currentPrompt });
    }

    return messages;
  }

  /**
   * Stream chat completions from OpenAI-compatible endpoint.
   * Parses SSE (Server-Sent Events) response.
   */
  private async *streamCompletion(
    messages: OpenAIChatMessage[],
    model: string,
    signal: AbortSignal,
  ): AsyncGenerator<{ text: string; model?: string }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 16384,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Local LLM API error ${response.status}: ${errBody.slice(0, 300)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body from local LLM');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') return;

          try {
            const event = JSON.parse(jsonStr);
            const delta = event.choices?.[0]?.delta?.content;
            if (delta) yield { text: delta, model: event.model };
          } catch { /* skip malformed JSON */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Engine interface
  // ═══════════════════════════════════════════════════════════════

  async *run(
    sessionId: string,
    prompt: string,
    opts: RunOpts,
    callbacks: EngineCallbacks,
  ): AsyncGenerator<TowerMessage> {
    const abortController = new AbortController();
    const entry: LocalSessionEntry = { isRunning: true, abortController };
    this.sessions.set(sessionId, entry);

    const msgId = crypto.randomUUID();
    const model = opts.model || this.defaultModel;
    let fullText = '';
    let assistantSaved = false;
    let actualModel: string | undefined;

    try {
      // Build conversation history
      const messages = await this.buildHistory(sessionId, prompt, opts);

      // Stream response
      const startTime = Date.now();

      for await (const chunk of this.streamCompletion(messages, model, abortController.signal)) {
        if (!entry.isRunning) break;

        fullText += chunk.text;
        if (chunk.model) actualModel = chunk.model;
        const content: TowerContentBlock[] = [{ type: 'text', text: fullText }];

        // Save/update in DB
        if (!assistantSaved) {
          callbacks.saveMessage({ id: msgId, role: 'assistant', content });
          assistantSaved = true;
        } else {
          callbacks.updateMessageContent(msgId, content);
        }

        // Stream to frontend
        yield { type: 'assistant', sessionId, msgId, content };
      }

      const durationMs = Date.now() - startTime;

      // Rough token estimate (for display only — local LLMs may not return usage)
      const estimatedInputTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
      const estimatedOutputTokens = Math.ceil(fullText.length / 4);

      callbacks.updateMessageMetrics(msgId, {
        durationMs,
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
      });

      yield {
        type: 'turn_done',
        sessionId,
        msgId,
        usage: {
          inputTokens: estimatedInputTokens,
          outputTokens: estimatedOutputTokens,
          costUsd: 0, // local = free
          durationMs,
        },
        model: actualModel || model,
      };

      yield { type: 'engine_done', sessionId, model: actualModel || model };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // User aborted — still send engine_done
        yield { type: 'engine_done', sessionId, model };
      } else {
        yield {
          type: 'engine_error',
          sessionId,
          message: `Local LLM error: ${err.message}`,
          recoverable: true,
        };
      }
    } finally {
      entry.isRunning = false;
      entry.abortController = null;
    }
  }

  async quickReply(prompt: string, opts: QuickReplyOpts): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const model = opts.model || this.defaultModel;

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        stream: true,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Local LLM API error ${response.status}: ${errBody.slice(0, 200)}`);
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
      entry.isRunning = false;
      entry.abortController?.abort();
    }
  }

  dispose(sessionId: string): void {
    this.abort(sessionId);
    this.sessions.delete(sessionId);
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

  init(): void {}

  shutdown(): void {
    for (const [id] of this.sessions) {
      this.abort(id);
    }
    this.sessions.clear();
  }
}
