/**
 * AI Quick Reply — handles @ai mentions in chat rooms.
 * Uses Engine.quickReply() for engine-agnostic single-turn responses.
 * Streams response text to room via WebSocket. No task/session creation.
 */

import { getEngine } from '../engines/index.js';
import { getModelDefaults } from '../config.js';

interface QuickReplyOptions {
  roomId: string;
  roomName: string;
  prompt: string;
  userId: number;
  username: string;
  messageId: string;  // the triggering human message ID
  replyTo?: string;   // if replying to a specific message (thread)
  broadcastToRoom: (roomId: string, data: any) => void;
}

/**
 * Determine engine name from model ID.
 * Pi models contain '/' (e.g. "openrouter/anthropic/claude-sonnet-4.6").
 * Claude models start with "claude-" (e.g. "claude-haiku-4-5-20251001").
 */
function engineFromModel(modelId: string): string {
  if (modelId.includes('/')) return 'pi';
  return 'claude';
}

/**
 * Handle @ai quick reply: fetch recent messages, call engine.quickReply(), stream to room.
 */
export async function handleAiQuickReply(opts: QuickReplyOptions): Promise<void> {
  const { roomId, roomName, prompt, userId, username, messageId, replyTo, broadcastToRoom } = opts;
  const { getMessages, sendMessage } = await import('./room-manager.js');

  // 1. Build context — if replying to a thread, collect thread messages; otherwise last 20
  let contextMessages: string;
  if (replyTo) {
    // Thread mode: collect the parent message + all replies to it + the current reply
    const allMsgs = await getMessages(roomId, { limit: 100 });
    const threadMsgs = allMsgs.filter((m: any) =>
      m.id === replyTo || m.replyTo === replyTo
    );
    // Also include the parent's parent if it exists
    const parent = allMsgs.find((m: any) => m.id === replyTo);
    if (parent?.replyTo) {
      const grandparent = allMsgs.find((m: any) => m.id === parent.replyTo);
      if (grandparent) threadMsgs.unshift(grandparent);
    }
    contextMessages = threadMsgs
      .filter((m: any) => m.msgType === 'human' || m.msgType === 'ai_reply' || m.msgType === 'ai_summary')
      .map((m: any) => `${m.senderName || 'AI'}: ${m.content}`)
      .join('\n');
  } else {
    const recentMsgs = await getMessages(roomId, { limit: 20 });
    contextMessages = recentMsgs
      .filter((m: any) => m.msgType === 'human' || m.msgType === 'ai_reply' || m.msgType === 'ai_summary')
      .map((m: any) => `${m.senderName || 'AI'}: ${m.content}`)
      .join('\n');
  }

  // 2. Create streaming placeholder message
  const replyId = `ai-reply-${Date.now()}`;
  broadcastToRoom(roomId, {
    type: 'room_message',
    roomId,
    message: {
      id: replyId,
      roomId,
      senderId: null,
      senderName: null,
      msgType: 'ai_reply',
      content: '',
      metadata: { streaming: true },
      replyTo: replyTo || null,
      createdAt: new Date().toISOString(),
    },
  });

  // 3. Resolve engine + model from admin defaults
  const defaults = getModelDefaults();
  const modelId = defaults.ai_reply;
  const engineName = engineFromModel(modelId);

  const systemPrompt = `You are a helpful AI assistant in a team channel called "${roomName}".
Read the recent conversation and respond naturally.
Keep answers concise and relevant to the discussion.
You can use tools to read files, search code, and execute commands when needed.
Respond in the same language as the user's message.

When your answer involves data or processes, proactively use visualization code blocks:
- Numeric comparisons → \`\`\`chart with JSON: { "type": "bar|line|pie|...", "data": [...], "xKey": "...", "yKey": "..." }
- Processes/workflows → \`\`\`mermaid (flowchart, sequence, etc.)
- Structured comparisons → \`\`\`datatable with JSON: { "columns": [...], "data": [[...]] }
- Timelines/roadmaps → \`\`\`timeline with JSON: { "items": [{ "date", "title", "status" }] }
- Math formulas → $$LaTeX$$ (no single $ for inline)
Use these automatically when helpful — don't wait for the user to ask.`;

  const fullPrompt = contextMessages
    ? `Here are recent messages from the channel:\n\n${contextMessages}\n\nUser's question: ${prompt}`
    : prompt;

  let streamedContent = '';  // track what has been streamed so far

  try {
    const engine = await getEngine(engineName);

    // 4. Call engine.quickReply() with streaming callback
    const fullContent = await engine.quickReply(fullPrompt, {
      model: modelId,
      systemPrompt,
      onChunk: (chunk, content) => {
        streamedContent = content;  // always track latest
        broadcastToRoom(roomId, {
          type: 'room_ai_stream',
          roomId,
          messageId: replyId,
          chunk,
          content,
        });
      },
    });

    // 5. Save final message to DB (with replyTo for thread linking)
    const savedMsg = await sendMessage(roomId, null, fullContent, 'ai_reply', {
      model: modelId,
      engine: engineName,
      triggered_by: userId,
      triggered_by_name: username,
      source_message_id: messageId,
    }, undefined, replyTo);

    // 6. Send stream-done event (replace placeholder with real DB message)
    broadcastToRoom(roomId, {
      type: 'room_ai_stream_done',
      roomId,
      messageId: replyId,
      finalMessageId: savedMsg.id,
      content: fullContent,
    });

    console.log(`[ai-quick-reply] Done room=${roomId} engine=${engineName} model=${modelId} len=${fullContent.length}`);
  } catch (err: any) {
    console.error('[ai-quick-reply] Error:', err.message);

    // If we already streamed some content, preserve it instead of deleting
    if (streamedContent.length > 0) {
      const savedMsg = await sendMessage(roomId, null, streamedContent, 'ai_reply', {
        model: modelId,
        engine: engineName,
        triggered_by: userId,
        triggered_by_name: username,
        source_message_id: messageId,
        partial: true,
        error: err.message,
      }, undefined, replyTo);
      broadcastToRoom(roomId, {
        type: 'room_ai_stream_done',
        roomId,
        messageId: replyId,
        finalMessageId: savedMsg.id,
        content: streamedContent,
      });
      console.log(`[ai-quick-reply] Partial save room=${roomId} len=${streamedContent.length} err=${err.message}`);
      return;
    }

    // No content was streamed — remove placeholder and show error
    broadcastToRoom(roomId, {
      type: 'room_ai_stream_done',
      roomId,
      messageId: replyId,
      finalMessageId: `err-${Date.now()}`,
      content: '',
      remove: true,
    });
    const errContent = `AI reply failed: ${err.message}`;
    try {
      const errMsg = await sendMessage(roomId, null, errContent, 'ai_error', {
        triggered_by: userId,
        error: err.message,
      });
      broadcastToRoom(roomId, {
        type: 'room_message',
        roomId,
        message: {
          id: errMsg.id,
          roomId,
          senderId: null,
          msgType: 'ai_error',
          content: errContent,
          metadata: { triggered_by: userId, error: err.message },
          createdAt: new Date().toISOString(),
        },
      });
    } catch {
      // DB save also failed — broadcast ephemeral error
      broadcastToRoom(roomId, {
        type: 'room_message',
        roomId,
        message: {
          id: `err-${Date.now()}`,
          roomId,
          senderId: null,
          msgType: 'ai_error',
          content: errContent,
          metadata: {},
          createdAt: new Date().toISOString(),
        },
      });
    }
  }
}
