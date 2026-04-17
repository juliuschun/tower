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
import { buildSystemPrompt } from './system-prompt.js';
import { getProject } from './project-manager.js';

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

/**
 * Channel-specific behavior overlay — appended to the full team system prompt.
 * Regular session prompt provides: core identity, org policy, role, visualization.
 * This overlay adds: channel context, project awareness, response style for team chat.
 */
function channelBehaviorOverlay(roomName: string, projectName?: string, projectDesc?: string): string {
  const projectCtx = projectName
    ? `\nYou are working in the project "${projectName}"${projectDesc ? ` — ${projectDesc}` : ''}.\nProject context (AGENTS.md / CLAUDE.md) at your cwd describes the project's goals, conventions, and rules. Read and apply them.`
    : '\nThis channel is not linked to a specific project.';

  return `
## Channel AI Context
You are a dedicated AI team member assigned to the channel "${roomName}".${projectCtx}
You have persistent memory of all previous conversations in this channel.

## Your Role in Channel
- You are a persistent AI partner living inside this channel — not a one-shot responder.
- Answer questions directly and accurately. No hedging when you know the answer.
- When asked to do something, do it end-to-end. You are not turn-limited; take as many tool calls as the task honestly needs.
- If you notice something relevant from previous conversations, bring it up.
- Long investigations, refactors, and multi-file work are all fair game — don't bail out early.

## Response Style in Channel
- Match depth to the question: quick chat → short answer, real work → full execution + report.
- Use bullet points for multi-item answers.
- When executing tasks, report results like a status update:
  "✅ Done. [what you did]. [key finding/result]."
- Ask clarifying questions only when truly ambiguous — prefer making reasonable assumptions and stating them.

## Context Awareness
- You remember previous conversations in this channel across sessions (auto-compact keeps context alive long-term).
- Reference past discussions naturally when relevant.
- Track ongoing topics and provide continuity.
- Your working directory (cwd) is the project root. Use it to read project files.

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

  // Notify user if their request is queued (another @ai is still running in this room)
  const isQueued = roomAiLocks.has(roomId);
  if (isQueued) {
    broadcastToRoom(roomId, {
      type: 'room_ai_status',
      roomId,
      messageId: `queued-${Date.now()}`,
      status: '⏳ 이전 AI 응답 완료 대기 중...',
    });
  }

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

    // 4. Load room + project context (Level 2: full parity with regular sessions)
    const { getRoom: fetchRoom2 } = await import('./room-manager.js');
    const roomData = await fetchRoom2(roomId);
    const projectId = roomData?.projectId ?? null;
    let projectRootPath: string | undefined;
    let projectName: string | undefined;
    let projectDesc: string | undefined;
    if (projectId) {
      const project = await getProject(projectId);
      if (project) {
        projectRootPath = project.rootPath || undefined;
        projectName = project.name;
        projectDesc = project.description || undefined;
      }
    }

    // Build system prompt: team base (buildSystemPrompt) + channel behavior overlay
    // SDK will auto-load CLAUDE.md/AGENTS.md from cwd (project rootPath) via settingSources
    const baseSystemPrompt = await buildSystemPrompt({
      username: username || 'channel-ai',
      role: 'member',  // channel AI operates as member
    });
    const systemPrompt = baseSystemPrompt + '\n' + channelBehaviorOverlay(roomName, projectName, projectDesc);

    // 5. Get or create persistent channel AI session
    const { getOrCreateChannelAiSession } = await import('./room-manager.js');
    const channelSession = await getOrCreateChannelAiSession(
      roomId, roomName, userId, projectId, engineName,
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
      const { saveMessage: saveSessionMsg } = await import('./message-store.js');
      const { v4: uuidv4 } = await import('uuid');

      // 5a. Save user message to session messages table (so it shows in ChatPanel)
      const { broadcastToSession } = await import('../routes/ws-handler.js');
      const userMsgId = uuidv4();
      const userContent = [{ type: 'text', text: prompt }];
      await saveSessionMsg(channelSession.sessionId, {
        id: userMsgId,
        role: 'user',
        content: userContent,
        username,
      });
      // Broadcast to ChatPanel in real-time
      broadcastToSession(channelSession.sessionId, {
        type: 'channel_ai_message',
        sessionId: channelSession.sessionId,
        message: { id: userMsgId, role: 'user', content: userContent, timestamp: Date.now() },
      });

      // 5b. Try persistent channelReply (with resume), fall back to quickReply
      if (engine.channelReply) {
        const result = await engine.channelReply(fullPrompt, {
          model: modelId,
          systemPrompt,
          cwd: projectRootPath,  // SDK loads CLAUDE.md/AGENTS.md from project folder
          resumeSessionId: resumeSessionId || undefined,
          // maxTurns intentionally unset — @ai is a persistent channel partner.
          // SDK auto-compacts when the context window fills, so long sessions survive.
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

      // 7a. Save AI response to session messages table (ChatPanel can show it)
      const assistantMsgId = uuidv4();
      const assistantContent = [{ type: 'text', text: streamedContent }];
      await saveSessionMsg(channelSession.sessionId, {
        id: assistantMsgId,
        role: 'assistant',
        content: assistantContent,
      });
      // Broadcast to ChatPanel in real-time
      broadcastToSession(channelSession.sessionId, {
        type: 'channel_ai_message',
        sessionId: channelSession.sessionId,
        message: { id: assistantMsgId, role: 'assistant', content: assistantContent, timestamp: Date.now() },
      });

      // 7b. Save final message to room (channel display)
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
