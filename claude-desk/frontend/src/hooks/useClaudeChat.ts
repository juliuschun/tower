import { useCallback, useRef } from 'react';
import { useWebSocket } from './useWebSocket';
import { useChatStore, type ChatMessage, type ContentBlock } from '../stores/chat-store';
import { useFileStore } from '../stores/file-store';
import { useSessionStore } from '../stores/session-store';
import { parseSDKMessage } from '../utils/message-parser';

export function useClaudeChat() {
  const token = localStorage.getItem('token');
  const wsBase = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const wsUrl = token ? `${wsBase}?token=${encodeURIComponent(token)}` : wsBase;
  const currentAssistantMsg = useRef<ChatMessage | null>(null);

  const {
    addMessage, setStreaming, setSessionId, setClaudeSessionId,
    setSystemInfo, setCost, sessionId, claudeSessionId
  } = useChatStore();

  const { setTree, setDirectoryChildren, handleFileChange } = useFileStore();

  const handleMessage = useCallback((data: any) => {
    switch (data.type) {
      case 'connected':
        break;

      case 'sdk_message': {
        const sdkMsg = data.data;

        // System init — may repeat each turn, only update info without resetting
        if (sdkMsg.type === 'system' && sdkMsg.subtype === 'init') {
          setSessionId(data.sessionId);
          setClaudeSessionId(sdkMsg.session_id);
          setSystemInfo({
            slashCommands: sdkMsg.slash_commands,
            tools: sdkMsg.tools,
            model: sdkMsg.model,
          });
          return;
        }

        // User message (tool_result from SDK) — attach result to the matching tool_use
        if (sdkMsg.type === 'user') {
          const content = sdkMsg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_result' && block.tool_use_id) {
                const resultText = typeof block.content === 'string'
                  ? block.content
                  : Array.isArray(block.content)
                    ? block.content.map((c: any) => c.text || '').join('\n')
                    : JSON.stringify(block.content);
                // Also check structured tool_use_result at top level
                const structured = sdkMsg.tool_use_result;
                const finalResult = structured?.stdout || structured?.stderr
                  ? [structured.stdout, structured.stderr].filter(Boolean).join('\n')
                  : resultText;
                useChatStore.getState().attachToolResult(block.tool_use_id, finalResult);
              }
            }
          }
          return;
        }

        // Rate limit event — nested under rate_limit_info
        if (sdkMsg.type === 'rate_limit_event') {
          const info = sdkMsg.rate_limit_info;
          if (info && info.status !== 'allowed') {
            useChatStore.getState().setRateLimit({
              status: info.status,
              resetsAt: info.resetsAt,
              type: info.rateLimitType,
            });
          }
          return;
        }

        // Assistant message — each new UUID gets its own message bubble
        if (sdkMsg.type === 'assistant') {
          const parsed = parseSDKMessage(sdkMsg);
          const msgId = sdkMsg.uuid || crypto.randomUUID();

          if (!currentAssistantMsg.current || currentAssistantMsg.current.id !== msgId) {
            // New assistant message (new turn or new UUID)
            const msg: ChatMessage = {
              id: msgId,
              role: 'assistant',
              content: parsed,
              timestamp: Date.now(),
              parentToolUseId: sdkMsg.parent_tool_use_id,
            };
            currentAssistantMsg.current = msg;
            addMessage(msg);
          } else {
            // Same message updated (streaming increments)
            currentAssistantMsg.current = {
              ...currentAssistantMsg.current,
              content: parsed,
            };
            useChatStore.getState().updateLastAssistant(parsed);
          }
          return;
        }

        // Result
        if (sdkMsg.type === 'result') {
          setCost({
            totalCost: sdkMsg.total_cost_usd,
            inputTokens: sdkMsg.usage?.input_tokens || 0,
            outputTokens: sdkMsg.usage?.output_tokens || 0,
            cacheCreationTokens: sdkMsg.usage?.cache_creation_input_tokens,
            cacheReadTokens: sdkMsg.usage?.cache_read_input_tokens,
            duration: sdkMsg.duration_ms,
          });
          return;
        }
        break;
      }

      case 'sdk_done':
        setStreaming(false);
        currentAssistantMsg.current = null;
        if (data.claudeSessionId) {
          setClaudeSessionId(data.claudeSessionId);
          // Persist claudeSessionId to DB for session resume
          const activeId = useSessionStore.getState().activeSessionId;
          if (activeId) {
            const tk = localStorage.getItem('token');
            const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
            if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
            fetch(`/api/sessions/${activeId}`, {
              method: 'PATCH',
              headers: hdrs,
              body: JSON.stringify({ claudeSessionId: data.claudeSessionId }),
            }).catch(() => {});
            useSessionStore.getState().updateSessionMeta(activeId, { claudeSessionId: data.claudeSessionId });
          }
        }
        break;

      case 'file_tree': {
        // If we already have a tree and this is a subdirectory fetch, set as children
        const currentTree = useFileStore.getState().tree;
        if (currentTree.length > 0 && data.path) {
          // Check if this path is one of the directories in the existing tree (recursive)
          const findInTree = (entries: any[], p: string): boolean => {
            for (const e of entries) {
              if (e.path === p && e.isDirectory) return true;
              if (e.children && findInTree(e.children, p)) return true;
            }
            return false;
          };
          if (findInTree(currentTree, data.path)) {
            setDirectoryChildren(data.path, data.entries);
            break;
          }
        }
        setTree(data.entries);
        break;
      }

      case 'file_content':
        useFileStore.getState().setOpenFile({
          path: data.path,
          content: data.content,
          language: data.language,
          modified: false,
        });
        break;

      case 'file_changed':
        handleFileChange(data.event, data.path);
        break;

      case 'error':
        setStreaming(false);
        currentAssistantMsg.current = null;
        addMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: [{ type: 'text', text: `오류: ${data.message}` }],
          timestamp: Date.now(),
        });
        break;
    }
  }, [addMessage, setStreaming, setSessionId, setClaudeSessionId, setSystemInfo, setCost, setTree, setDirectoryChildren, handleFileChange]);

  const { send, connected } = useWebSocket(wsUrl, handleMessage);

  const sendMessage = useCallback(
    (message: string, cwd?: string) => {
      // Add user message locally
      addMessage({
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: message }],
        timestamp: Date.now(),
      });

      setStreaming(true);
      currentAssistantMsg.current = null;

      send({
        type: 'chat',
        message,
        sessionId: useChatStore.getState().sessionId,
        claudeSessionId: useChatStore.getState().claudeSessionId,
        cwd,
      });
    },
    [send, addMessage, setStreaming]
  );

  const abort = useCallback(() => {
    send({ type: 'abort', sessionId: useChatStore.getState().sessionId });
    setStreaming(false);
  }, [send, setStreaming]);

  const requestFileTree = useCallback(
    (path?: string) => {
      send({ type: 'file_tree', path });
    },
    [send]
  );

  const requestFile = useCallback(
    (path: string) => {
      send({ type: 'file_read', path });
    },
    [send]
  );

  const saveFile = useCallback(
    (path: string, content: string) => {
      send({ type: 'file_write', path, content });
    },
    [send]
  );

  return {
    sendMessage,
    abort,
    requestFileTree,
    requestFile,
    saveFile,
    connected,
  };
}
