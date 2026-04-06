/**
 * AI Quick Reply — handles @ai mentions in chat rooms.
 *
 * Persistent Channel AI: each room maintains a dedicated AI session
 * that resumes across @ai calls. The SDK's auto-compact manages
 * context window automatically — no manual .jsonl cleanup needed.
 *
 * Mutex: room-level async lock prevents concurrent session access.
 */

import { getEngine } from '../engines/index.js';
import { getModelDefaults } from '../config.js';
import { engineFromModel } from './utility-agent.js';

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

// ── Room-level mutex for channel AI ──────────────────────────────────
// Prevents concurrent @ai calls from colliding on the same session.
// Each room's requests are queued; different rooms run in parallel.

const roomAiLocks = new Map<string, Promise<void>>();

async function withRoomAiLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
  const prev = roomAiLocks.get(roomId) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>((r) => { resolve = r; });
  roomAiLocks.set(roomId, next);

  // Wait for previous request to finish
  await prev;

  try {
    return await fn();
  } finally {
    resolve!();
    // Clean up if this was the last request
    if (roomAiLocks.get(roomId) === next) {
      roomAiLocks.delete(roomId);
    }
  }
}

// ── Channel AI System Prompt ─────────────────────────────────────────

function buildChannelAiSystemPrompt(roomName: string): string {
  return `You are a dedicated AI team member assigned to the channel "${roomName}".
You have persistent memory of all previous conversations in this channel.

## Your Role
- You are the team's ace worker — reliable, precise, proactive.
- Answer questions directly and accurately. No hedging when you know the answer.
- When asked to do something, do it and report back concisely.
- If you notice something relevant from previous conversations, bring it up.
- Keep responses focused — this is a team chat, not an essay contest.

## Response Style
- Default to concise answers (2-5 sentences) unless depth is clearly needed.
- Use bullet points for multi-item answers.
- When executing tasks, report results like a status update:
  "✅ Done. [what you did]. [key finding/result]."
- Ask clarifying questions only when truly ambiguous — prefer making reasonable assumptions and stating them.

## Context Awareness
- You remember previous conversations in this channel.
- Reference past discussions naturally when relevant.
- Track ongoing topics and provide continuity.

## Tools & Capabilities
- You can read files, search code, and execute commands when needed.
- Use tools to give accurate answers rather than guessing.

## Visualization
When your answer involves data or processes, proactively use visualization code blocks:
- Numeric comparisons → \`\`\`chart with JSON: { "type": "bar|line|pie|...", "data": [...], "xKey": "...", "yKey": "..." }
- Processes/workflows → \`\`\`mermaid (flowchart, sequence, etc.)
- Structured comparisons → \`\`\`datatable with JSON: { "columns": [...], "data": [[...]] }
- Timelines/roadmaps → \`\`\`timeline with JSON: { "items": [{ "date", "title", "status" }] }
- Math formulas → $$LaTeX$$ (no single $ for inline)
Use these automatically when helpful — don't wait for the user to ask.

Respond in the same language as the user's message.`;
}

// ── Tool name → user-friendly Korean label ──────────────────────────

function toolDisplayName(name: string): string {
  const map: Record<string, string> = {
    Read: '📄 파일 읽는 중...',
    Write: '✏️ 파일 작성 중...',
    Edit: '✏️ 파일 수정 중...',
    Bash: '⚙️ 명령 실행 중...',
    Glob: '🔍 파일 검색 중...',
    Grep: '🔍 코드 검색 중...',
    WebFetch: '🌐 웹 조회 중...',
    WebSearch: '🌐 웹 검색 중...',
    Agent: '🤖 에이전트 실행 중...',
  };
  return map[name] || `🔧 ${name} 실행 중...`;
}

/**
 * Handle @ai quick reply with persistent channel session.
 * Uses engine.channelReply() for resume support, falls back to quickReply().
 */
export async function handleAiQuickReply(opts: QuickReplyOptions): Promise<void> {
  const { roomId, roomName, prompt, userId, username, messageId, replyTo, broadcastToRoom } = opts;

  // Mutex: queue this request behind any in-progress @ai for the same room
  return withRoomAiLock(roomId, async () => {
    const { getMessages, sendMessage } = await import('./room-manager.js');

    // 1. Build context from recent messages (for the prompt, not the session)
    //    With persistent sessions, this is supplementary — the session itself has history.
    //    But for the FIRST message or after reset, this seeds the context.
    let contextMessages: string;
    if (replyTo) {
      const allMsgs = await getMessages(roomId, { limit: 100 });
      const threadMsgs = allMsgs.filter((m: any) =>
        m.id === replyTo || m.replyTo === replyTo
      );
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

    // 3. Resolve engine + model
    const defaults = getModelDefaults();
    const modelId = defaults.ai_reply;
    const engineName = engineFromModel(modelId);
    const systemPrompt = buildChannelAiSystemPrompt(roomName);

    // 4. Get or create persistent channel AI session
    const { getRoom: fetchRoom2 } = await import('./room-manager.js');
    const roomData = await fetchRoom2(roomId);
    const { getOrCreateChannelAiSession } = await import('./room-manager.js');
    const channelSession = await getOrCreateChannelAiSession(
      roomId, roomName, userId, roomData?.projectId ?? null, engineName,
    );
    const resumeSessionId = channelSession.engineSessionId;

    // Build prompt: include recent context for first message or supplementary context
    const isFirstMessage = !resumeSessionId;
    let fullPrompt: string;
    if (isFirstMessage && contextMessages) {
      // First message: seed with recent channel history
      fullPrompt = `Here are recent messages from the channel for context:\n\n${contextMessages}\n\n---\n\n${username}: ${prompt}`;
    } else {
      // Subsequent messages: the session already has history
      fullPrompt = `${username}: ${prompt}`;
    }

    let streamedContent = '';

    try {
      const engine = await getEngine(engineName);

      // 5. Try persistent channelReply (with resume), fall back to quickReply
      if (engine.channelReply) {
        const result = await engine.channelReply(fullPrompt, {
          model: modelId,
          systemPrompt,
          resumeSessionId: resumeSessionId || undefined,
          maxTurns: 10,
          onChunk: (chunk, content) => {
            streamedContent = content;
            broadcastToRoom(roomId, {
              type: 'room_ai_stream',
              roomId,
              messageId: replyId,
              chunk,
              content,
            });
          },
          onToolUse: (toolName) => {
            broadcastToRoom(roomId, {
              type: 'room_ai_status',
              roomId,
              messageId: replyId,
              status: toolDisplayName(toolName),
            });
          },
          onCompact: (phase) => {
            if (phase === 'compacting') {
              broadcastToRoom(roomId, {
                type: 'room_ai_status',
                roomId,
                messageId: replyId,
                status: '🔄 컨텍스트 정리 중...',
              });
            }
          },
        });

        // 6. Save new session ID to DB for next resume
        if (result.engineSessionId) {
          const { updateChannelAiSession } = await import('./room-manager.js');
          await updateChannelAiSession(roomId, channelSession.sessionId, result.engineSessionId);
        }

        streamedContent = result.content;
      } else {
        // Fallback: stateless quickReply (e.g. Pi engine)
        const fallbackPrompt = contextMessages
          ? `Here are recent messages from the channel:\n\n${contextMessages}\n\nUser's question: ${prompt}`
          : prompt;

        streamedContent = await engine.quickReply(fallbackPrompt, {
          model: modelId,
          systemPrompt,
          onChunk: (chunk, content) => {
            streamedContent = content;
            broadcastToRoom(roomId, {
              type: 'room_ai_stream',
              roomId,
              messageId: replyId,
              chunk,
              content,
            });
          },
        });
      }

      // 7. Save final message to DB
      const savedMsg = await sendMessage(roomId, null, streamedContent, 'ai_reply', {
        model: modelId,
        engine: engineName,
        triggered_by: userId,
        triggered_by_name: username,
        source_message_id: messageId,
        persistent_session: !!engine.channelReply,
      }, undefined, replyTo);

      // 8. Send stream-done event
      broadcastToRoom(roomId, {
        type: 'room_ai_stream_done',
        roomId,
        messageId: replyId,
        finalMessageId: savedMsg.id,
        content: streamedContent,
      });

      console.log(`[ai-quick-reply] Done room=${roomId} engine=${engineName} model=${modelId} len=${streamedContent.length} persistent=${!!engine.channelReply} resumed=${!!resumeSessionId}`);
    } catch (err: any) {
      console.error('[ai-quick-reply] Error:', err.message);

      // If resume failed, try clearing session and retrying once
      if (resumeSessionId && /resume|session.*not found|exited with code/i.test(err.message || '')) {
        console.log(`[ai-quick-reply] Resume failed, clearing session and retrying fresh`);
        const { clearChannelAiSession } = await import('./room-manager.js');
        await clearChannelAiSession(roomId);
        // Don't retry here — let the error fall through. The next @ai call will start fresh.
      }

      // Preserve partial content if any was streamed
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
  });
}

/**
 * Handle @ai /reset — clears the persistent AI session for a room.
 */
export async function handleAiReset(
  roomId: string,
  broadcastToRoom: (roomId: string, data: any) => void,
): Promise<void> {
  const { clearChannelAiSession, sendMessage } = await import('./room-manager.js');
  await clearChannelAiSession(roomId);

  const msg = await sendMessage(roomId, null, 'AI 세션이 초기화되었습니다. 다음 @ai 호출부터 새로운 대화가 시작됩니다.', 'system', {});
  broadcastToRoom(roomId, {
    type: 'room_message',
    roomId,
    message: {
      id: msg.id,
      roomId,
      senderId: null,
      msgType: 'system',
      content: msg.content,
      metadata: {},
      createdAt: new Date().toISOString(),
    },
  });
  console.log(`[ai-quick-reply] Session reset for room=${roomId}`);
}
