import React, { useState, useRef, useEffect } from 'react';
import { useChatStore, type SlashCommandInfo } from '../../stores/chat-store';
import { useSessionStore } from '../../stores/session-store';
import { useActiveSessionStreaming } from '../../hooks/useActiveSessionStreaming';
import { useActiveSessionTurnState } from '../../hooks/useActiveSessionTurnState';
import { AttachmentChip } from './AttachmentChip';
import { toastInfo } from '../../utils/toast';

const EMPTY_QUEUE: string[] = [];

interface InputBoxProps {
  onSend: (message: string) => void;
  onAbort: () => void;
}

const DRAFT_PREFIX = 'tower:inputDraft:';

function turnStatusText(phase: string, hasQueue: boolean): string {
  // Phase 상태(preparing, tool_running 등)는 AssistantPlaceholder가 메시지
  // 영역에서 직접 표시. InputBox 위 박스는 큐 상태만 담당.
  if (hasQueue && phase !== 'awaiting_user') return '대기열에 추가됨 — 현재 응답이 끝나면 자동 전송됩니다';
  return '';
}

function getDraftKey(sessionId: string | null): string {
  return sessionId ? `${DRAFT_PREFIX}${sessionId}` : `${DRAFT_PREFIX}__global`;
}

function loadDraft(sessionId: string | null): string {
  try {
    const val = localStorage.getItem(getDraftKey(sessionId));
    if (val) return val;
    // Migrate from old global key (one-time)
    const OLD_KEY = 'tower:inputDraft';
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      localStorage.removeItem(OLD_KEY);
      return old;
    }
    return '';
  } catch { return ''; }
}

function saveDraft(sessionId: string | null, value: string) {
  try {
    const key = getDraftKey(sessionId);
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* storage full */ }
}

export function InputBox({ onSend, onAbort }: InputBoxProps) {
  const [input, setInput] = useState('');
  const [showCommands, setShowCommands] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [queueExpanded, setQueueExpanded] = useState(false);
  const dragCounter = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentSessionId = useChatStore((s) => s.sessionId);
  const isStreaming = useActiveSessionStreaming();
  const activeTurn = useActiveSessionTurnState();
  const currentQueue = useChatStore((s) => {
    const sid = s.sessionId;
    if (!sid) return EMPTY_QUEUE;
    return s.messageQueue[sid] ?? EMPTY_QUEUE;
  });
  const hasQueue = currentQueue.length > 0;
  useEffect(() => {
    if (!hasQueue && queueExpanded) setQueueExpanded(false);
  }, [hasQueue, queueExpanded]);
  const slashCommands = useChatStore((s) => s.slashCommands);
  const attachments = useChatStore((s) => s.attachments);

  // Pre-load slash commands from /api/commands so they're available before first message
  useEffect(() => {
    if (slashCommands.length > 0) return; // already loaded via SDK init
    const tk = localStorage.getItem('token');
    const hdrs: Record<string, string> = {};
    if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
    const projectId = useSessionStore.getState().sessions.find(
      s => s.id === currentSessionId
    )?.projectId || '';
    fetch(`/api/commands?projectId=${projectId}`, { headers: hdrs })
      .then((r) => r.ok ? r.json() : [])
      .then((cmds: Array<{ name: string; description: string; source: string; scope?: string }>) => {
        if (cmds.length > 0 && useChatStore.getState().slashCommands.length === 0) {
          useChatStore.getState().setSystemInfo({
            slashCommands: cmds.map((c) => ({
              name: c.name.replace(/^\//, ''),
              description: c.description,
              source: c.source as 'commands' | 'sdk' | 'skills',
              scope: c.scope as 'company' | 'project' | 'personal' | undefined,
            })),
          });
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save/restore per-session draft when session changes
  const prevSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevSessionRef.current !== currentSessionId) {
      // Save current draft to previous session
      if (prevSessionRef.current !== null) {
        saveDraft(prevSessionRef.current, input);
      }
      // Load draft for new session
      const restored = loadDraft(currentSessionId);
      setInput(restored);
      setQueueExpanded(false);
      prevSessionRef.current = currentSessionId;
      // Restore textarea height
      if (textareaRef.current) {
        const el = textareaRef.current;
        requestAnimationFrame(() => {
          el.style.height = 'auto';
          el.style.height = Math.min(el.scrollHeight, 200) + 'px';
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);

  const filteredCommands: SlashCommandInfo[] = input.startsWith('/')
    ? slashCommands.filter((cmd) => cmd.name.toLowerCase().includes(input.slice(1).toLowerCase()))
    : [];

  useEffect(() => {
    const shouldShow = input.startsWith('/') && input.length > 0 && !input.includes(' ') && filteredCommands.length > 0;
    setShowCommands(shouldShow);
    if (!shouldShow) setSelectedIndex(0);
  }, [input, filteredCommands.length]);

  // Reset selectedIndex when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands.length]);

  // Track the last sent message for SESSION_BUSY re-queuing
  const lastSentRef = useRef<string | null>(null);

  // Re-entry guard for handleSubmit. setInput('') is async (React state),
  // so on a fast double-Enter the textarea still holds the old value when
  // the second handler fires — without this guard, two identical messages
  // would be sent (especially during the awaited finalize-uploads call).
  const isSubmittingRef = useRef(false);

  // Cascade guard: prevents queue.length change from re-triggering dequeue
  // before the server confirms streaming for this session.
  const drainGuardRef = useRef(false);
  const guardSessionRef = useRef<string | null>(null);

  // Auto-send first queued message when the current session becomes idle.
  // Uses the same per-session streaming source as the sidebar/toolchips.
  useEffect(() => {
    // Reset guard on session switch
    if (currentSessionId !== guardSessionRef.current) {
      drainGuardRef.current = false;
      guardSessionRef.current = currentSessionId;
    }

    if (!isStreaming && currentQueue.length > 0 && currentSessionId) {
      if (drainGuardRef.current) return;  // Already sent one, wait for the next streaming cycle
      const msg = useChatStore.getState().dequeueMessage(currentSessionId);
      if (msg) {
        useChatStore.getState().promoteLatestQueuedUser(msg);
        drainGuardRef.current = true;
        lastSentRef.current = msg;
        onSend(msg);
      }
    } else {
      // Reset guard when streaming is confirmed or queue becomes empty
      drainGuardRef.current = false;
    }
  }, [isStreaming, currentQueue.length, currentSessionId, onSend]);

  // Listen for SESSION_BUSY events — re-queue the last sent message
  useEffect(() => {
    const handler = () => {
      if (lastSentRef.current) {
        const sid = useChatStore.getState().sessionId || '';
        useChatStore.getState().markLatestUserQueued(lastSentRef.current);
        useChatStore.getState().enqueueMessage(sid, lastSentRef.current);
        lastSentRef.current = null;
      }
    };
    window.addEventListener('session-busy-requeue', handler);
    return () => window.removeEventListener('session-busy-requeue', handler);
  }, []);

  // Listen for queue-cancel restore — put cancelled text back into input or clipboard
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (!text) return;

      const currentInput = textareaRef.current?.value?.trim() || '';
      if (!currentInput) {
        // Input is empty — restore directly
        setInput(text);
        saveDraft(currentSessionId, text);
        if (textareaRef.current) {
          const el = textareaRef.current;
          requestAnimationFrame(() => {
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 200) + 'px';
            el.focus();
          });
        }
        toastInfo('대기열 취소 — 입력창에 복원했습니다');
      } else {
        // Input has text — copy to clipboard instead
        navigator.clipboard.writeText(text).then(() => {
          toastInfo('대기열 취소 — 클립보드에 복사했습니다');
        }).catch(() => {
          toastInfo('대기열 취소됨');
        });
      }
    };
    window.addEventListener('restore-input-text', handler);
    return () => window.removeEventListener('restore-input-text', handler);
  }, [currentSessionId]);

  // Stale queue guard: if queue has messages and isStreaming stays true for 2 minutes,
  // ask the server to confirm the session is actually still streaming.
  const staleGuardTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (staleGuardTimerRef.current) {
      clearTimeout(staleGuardTimerRef.current);
      staleGuardTimerRef.current = undefined;
    }

    if (hasQueue && isStreaming && currentSessionId) {
      staleGuardTimerRef.current = setTimeout(() => {
        // Re-check conditions (state may have changed during the 2 min wait)
        const sid = useChatStore.getState().sessionId;
        const queue = sid ? useChatStore.getState().messageQueue[sid] : [];
        const stillStreaming = sid ? useSessionStore.getState().streamingSessions.has(sid) : false;
        if (queue && queue.length > 0 && stillStreaming && sid) {
          console.log(`[chat] stale queue guard: requesting server status check for session ${sid.slice(0, 8)}`);
          const ws = (window as any).__claudeWs as WebSocket | undefined;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'check_session_status', sessionId: sid }));
          }
        }
      }, 10_000); // 10 seconds — fast recovery from stale streaming state
    }

    return () => {
      if (staleGuardTimerRef.current) {
        clearTimeout(staleGuardTimerRef.current);
        staleGuardTimerRef.current = undefined;
      }
    };
  }, [hasQueue, isStreaming, currentSessionId]);

  const buildMessageFrom = (text: string, atts: typeof attachments): string => {
    if (atts.length === 0) return text;

    const parts: string[] = [];
    for (const att of atts) {
      if (att.type === 'prompt') {
        parts.push(att.content);
      } else if (att.type === 'command') {
        parts.push(att.content);
      } else if (att.type === 'file') {
        parts.push(`[file: ${att.content}]`);
      } else if (att.type === 'upload') {
        parts.push(`[uploaded file: ${att.label}]\n\`\`\`\n${att.content}\n\`\`\``);
      }
    }

    // Command type: prepend as slash command prefix
    const hasCommand = atts.some((a) => a.type === 'command');
    if (hasCommand) {
      const cmdParts = atts.filter((a) => a.type === 'command').map((a) => a.content);
      const otherParts = atts.filter((a) => a.type !== 'command');
      const prefix = cmdParts.join(' ');
      const otherContent = otherParts.map((a) => a.type === 'file' ? `[file: ${a.content}]` : a.content).join('\n\n');
      const combined = otherContent ? `${otherContent}\n\n${text}` : text;
      return `${prefix} ${combined}`.trim();
    }

    // Prompt/file: join with double newlines before user text
    return `${parts.join('\n\n')}\n\n${text}`.trim();
  };

  const handleSubmit = async () => {
    // Reject re-entry while the previous submit is still awaiting finalize-uploads
    if (isSubmittingRef.current) return;
    const trimmed = input.trim();
    const hasContent = trimmed || attachments.length > 0;
    if (!hasContent) return;

    isSubmittingRef.current = true;
    try {
      // Clear UI immediately to prevent double-submit
      const currentAttachments = [...attachments];
      setInput('');
      saveDraft(currentSessionId, '');
      setShowCommands(false);
      useChatStore.getState().clearAttachments();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      // Finalize temp uploads → move to permanent uploads/
      const fileAtts = currentAttachments.filter(a => a.type === 'file' && a.tempPath);
      if (fileAtts.length > 0) {
        try {
          const token = localStorage.getItem('token');
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;
          const activeSession = useSessionStore.getState().sessions.find(
            s => s.id === useSessionStore.getState().activeSessionId
          );
          const res = await fetch('/api/files/finalize-uploads', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              tempPaths: fileAtts.map(a => a.tempPath),
              projectId: activeSession?.projectId || '',
            }),
          });
          if (res.ok) {
            const data = await res.json();
            for (const r of data.results) {
              if (r.newPath) {
                const att = fileAtts.find(a => a.tempPath === r.tempPath);
                if (att) att.content = r.newPath;
              }
            }
          }
        } catch (err) {
          console.warn('[chat] finalize-uploads failed, using temp paths:', err);
        }
      }

      // Build message with (now finalized) attachment paths
      const message = buildMessageFrom(trimmed, currentAttachments);

      // Read from the authoritative per-session streaming store synchronously.
      // This avoids double-sends on fast Enter presses and keeps queue behavior
      // aligned with the sidebar/tool chips.
      const sid = useChatStore.getState().sessionId || '';
      const isCurrentSessionStreaming = sid
        ? useSessionStore.getState().streamingSessions.has(sid)
        : useChatStore.getState().isStreaming;

      if (isCurrentSessionStreaming) {
        useChatStore.getState().markLatestUserQueued(message);
        useChatStore.getState().enqueueMessage(sid, message);
        // Immediately ask server to confirm streaming state — if it's stale,
        // server will send session_status:idle and the queue will auto-drain.
        // This is much faster than the 2-minute stale guard.
        const ws = (window as any).__claudeWs as WebSocket | undefined;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'check_session_status', sessionId: sid }));
        }
      } else {
        lastSentRef.current = message;   // track for SESSION_BUSY re-queuing
        onSend(message);
      }
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleCancelQueue = () => {
    if (currentSessionId) {
      useChatStore.getState().clearQueuedUsersForSession(currentSessionId);
      useChatStore.getState().clearSessionQueue(currentSessionId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCommands) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          selectCommand(filteredCommands[selectedIndex].name);
        }
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      const pq = useChatStore.getState().pendingQuestion;
      if (pq) {
        useChatStore.getState().setPendingQuestion(null);
      } else if (isStreaming) {
        // Esc during streaming = Stop (preserve draft + restore queue)
        e.preventDefault();
        const sid = useChatStore.getState().sessionId;
        if (sid) {
          const queue = useChatStore.getState().messageQueue[sid];
          if (queue && queue.length > 0) {
            const restored = [input, ...queue].filter(Boolean).join('\n\n');
            setInput(restored);
            saveDraft(sid, restored);
            useChatStore.getState().clearSessionQueue(sid);
          }
        }
        onAbort();
      } else if (hasQueue) {
        handleCancelQueue();
      } else if (showCommands) {
        setShowCommands(false);
      }
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    saveDraft(currentSessionId, val);
    // Batch height recalculation into a single rAF to avoid layout thrashing
    // that causes visible jitter on mobile when the virtual keyboard is open.
    const el = e.target;
    requestAnimationFrame(() => {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    });
  };

  const selectCommand = (cmd: string) => {
    setInput(`/${cmd} `);
    setShowCommands(false);
    textareaRef.current?.focus();
  };

  // ───── Drag & Drop ─────
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragOver(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);

    // Handle internal drag (prompt/command/file tree attachments)
    const raw = e.dataTransfer.getData('application/x-attachment');
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data.type && data.label && data.content) {
          useChatStore.getState().addAttachment({
            id: `${data.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: data.type,
            label: data.label,
            content: data.content,
          });
          textareaRef.current?.focus();
        }
      } catch {}
      return;
    }

    // Handle OS file drops — upload to server, pass path to AI
    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    // Small text files (<1MB) can still be inlined for quick context
    const serverFiles: File[] = [];
    for (const file of Array.from(files)) {
      const isBinary = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|tar|gz|rar|7z|png|jpg|jpeg|gif|bmp|webp|svg|mp3|mp4|mov|avi|wav)$/i.test(file.name);
      if (isBinary || file.size > 1024 * 1024) {
        serverFiles.push(file);
      } else {
        // Small text file — inline as before
        try {
          const text = await file.text();
          useChatStore.getState().addAttachment({
            id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: 'upload',
            label: file.name,
            content: text,
          });
        } catch {
          serverFiles.push(file);
        }
      }
    }

    // Upload binary/large files to server
    if (serverFiles.length > 0) {
      await uploadFilesToServer(serverFiles);
    }
    textareaRef.current?.focus();
  };

  // ───── Shared upload helper ─────
  const uploadFilesToServer = async (files: File[]) => {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    // Include projectId so uploads go to the project folder
    const activeSession = useSessionStore.getState().sessions.find(
      s => s.id === useSessionStore.getState().activeSessionId
    );
    if (activeSession?.projectId) {
      formData.append('projectId', activeSession.projectId);
    }
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/files/chat-upload', { method: 'POST', headers, body: formData });
      const data = await res.json();
      if (!res.ok) {
        useChatStore.getState().addAttachment({
          id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'upload',
          label: 'Upload failed',
          content: `[Upload failed: ${data.error || 'Unknown error'}]`,
        });
      } else {
        for (const r of data.results) {
          if (r.error) {
            useChatStore.getState().addAttachment({
              id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              type: 'upload',
              label: `${r.name} (failed)`,
              content: `[Upload failed: ${r.error}]`,
            });
          } else {
            // Use 'file' type so buildMessage generates [file: /path] — AI can read it
            useChatStore.getState().addAttachment({
              id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              type: 'file',
              label: r.name,
              content: r.path,
              size: r.size,
              mimeType: r.mimeType,
              tempPath: r.path,  // path is temp until finalized on send
            });
          }
        }
      }
    } catch {
      useChatStore.getState().addAttachment({
        id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'upload',
        label: 'Upload failed',
        content: '[Upload failed: network error]',
      });
    }
  };

  // ───── Clipboard Paste (images/files) ─────
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (const item of Array.from(items)) {
      // Only intercept file/image pastes — let text paste through normally
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length === 0) return; // plain text paste — do nothing, let browser handle it

    e.preventDefault(); // prevent pasting blob URL as text
    await uploadFilesToServer(files);
    textareaRef.current?.focus();
  };

  return (
    <div className="max-w-3xl mx-auto relative">
      {/* Turn/runtime status */}
      {turnStatusText(activeTurn.phase, hasQueue) && (
        <div className="mb-2">
          <div className="flex items-center gap-2 px-4 py-2 bg-surface-900/60 border border-surface-700/50 rounded-xl text-[13px] text-gray-300 backdrop-blur-sm">
            <div className={`w-2 h-2 rounded-full shrink-0 ${activeTurn.phase === 'error' ? 'bg-red-400' : 'bg-primary-400 thinking-indicator'}`} />
            <span className="truncate flex-1">{turnStatusText(activeTurn.phase, hasQueue)}</span>
            {hasQueue && (
              <button
                type="button"
                onClick={() => setQueueExpanded((v) => !v)}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary-500/10 border border-primary-500/20 text-primary-300 hover:bg-primary-500/20 hover:text-primary-200 transition-colors shrink-0"
                title={queueExpanded ? '대기열 닫기' : '대기열 열기'}
                aria-expanded={queueExpanded}
              >
                <span>+{currentQueue.length}</span>
                <svg
                  className={`w-3 h-3 transition-transform ${queueExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )}
          </div>
          {hasQueue && queueExpanded && (
            <div className="mt-1.5 rounded-xl border border-surface-700/50 bg-surface-900/40 backdrop-blur-sm overflow-hidden">
              <ul className="divide-y divide-surface-700/40 max-h-60 overflow-y-auto">
                {currentQueue.map((text, idx) => (
                  <li
                    key={`${idx}-${text.slice(0, 16)}`}
                    className="flex items-start gap-2 px-3 py-2 group hover:bg-surface-800/40 transition-colors"
                  >
                    <span className="shrink-0 text-[10px] font-semibold text-primary-300/70 mt-0.5 tabular-nums">
                      {idx + 1}
                    </span>
                    <span
                      className="flex-1 text-[12px] text-gray-300 whitespace-pre-wrap line-clamp-2 break-words"
                      title={text}
                    >
                      {text}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (!currentSessionId) return;
                        const popped = useChatStore
                          .getState()
                          .cancelQueuedMessageAtIndex(currentSessionId, idx);
                        if (popped) {
                          window.dispatchEvent(
                            new CustomEvent('restore-input-text', { detail: popped }),
                          );
                        }
                      }}
                      className="shrink-0 p-1 rounded hover:bg-primary-500/20 text-primary-300 hover:text-primary-200 transition-colors opacity-70 group-hover:opacity-100"
                      title="입력창으로 가져오기"
                      aria-label="입력창으로 가져오기"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!currentSessionId) return;
                        useChatStore.getState().cancelQueuedMessageAtIndex(currentSessionId, idx);
                      }}
                      className="shrink-0 p-1 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-300 transition-colors opacity-70 group-hover:opacity-100"
                      title="대기열에서 삭제"
                      aria-label="대기열에서 삭제"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div
        className={`rounded-2xl shadow-2xl shadow-black/40 ring-1 bg-surface-800/80 backdrop-blur-2xl transition-[box-shadow,ring-color] duration-200 relative ${
          isDragOver
            ? 'ring-2 ring-primary-500/50 bg-primary-900/10'
            : 'ring-white/10'
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Drop overlay */}
        {isDragOver && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-primary-900/20 backdrop-blur-sm z-10 pointer-events-none">
            <span className="text-[13px] text-primary-300 font-medium">Drop here</span>
          </div>
        )}

        {/* Slash command picker */}
        {showCommands && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-surface-800/90 backdrop-blur-xl border border-surface-700/50 rounded-xl max-h-72 overflow-y-auto shadow-xl">
            {filteredCommands.map((cmd, idx) => (
              <button
                key={cmd.name}
                className={`w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-surface-700/50 hover:text-white transition-colors group ${
                  idx === selectedIndex ? 'bg-surface-700/50 text-white' : ''
                }`}
                onClick={() => selectCommand(cmd.name)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-primary-500/70 group-hover:text-primary-400 font-mono shrink-0">/</span>
                  <span className="font-medium truncate">{cmd.name}</span>
                  {cmd.scope && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                      cmd.scope === 'personal'
                        ? 'bg-blue-900/30 text-blue-400 border border-blue-500/20'
                        : cmd.scope === 'project'
                          ? 'bg-green-900/30 text-green-400 border border-green-500/20'
                          : 'bg-amber-900/30 text-amber-400 border border-amber-500/20'
                    }`}>
                      {cmd.scope === 'personal' ? 'my' : cmd.scope === 'project' ? 'proj' : 'co'}
                    </span>
                  )}
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ml-auto shrink-0 ${
                    cmd.source === 'commands'
                      ? 'bg-blue-900/30 text-blue-400 border border-blue-500/20'
                      : cmd.source === 'skills'
                        ? 'bg-violet-900/30 text-violet-400 border border-violet-500/20'
                        : 'bg-surface-700/50 text-gray-500 border border-surface-600/30'
                  }`}>
                    {cmd.source === 'commands' ? 'cmd' : cmd.source === 'skills' ? 'skill' : 'sdk'}
                  </span>
                </div>
                {cmd.description && (
                  <div className="text-[11px] text-gray-500 mt-0.5 pl-5 truncate">{cmd.description}</div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5 pb-0.5">
            {attachments.map((att) => (
              <AttachmentChip
                key={att.id}
                attachment={att}
                onRemove={(id) => {
                  const att = useChatStore.getState().attachments.find(a => a.id === id);
                  // Delete temp file on server when user removes a file attachment
                  if (att?.type === 'file' && att.tempPath) {
                    const token = localStorage.getItem('token');
                    const headers: Record<string, string> = {};
                    if (token) headers['Authorization'] = `Bearer ${token}`;
                    fetch(`/api/files/temp-upload?path=${encodeURIComponent(att.tempPath)}`, {
                      method: 'DELETE', headers,
                    }).catch(() => {});  // fire-and-forget
                  }
                  useChatStore.getState().removeAttachment(id);
                }}
              />
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 p-2 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              activeTurn.phase === 'awaiting_user'
                ? '질문에 답변을 입력하세요…'
                : isStreaming
                  ? 'Type a message to send on the next turn...'
                  : attachments.length > 0
                    ? '메시지를 덧붙이거나 바로 전송하세요…'
                    : 'Type a message...'
            }
            rows={1}
            aria-label="메시지 입력"
            className="flex-1 bg-transparent border-none px-4 py-3 text-input-size text-gray-100 placeholder-gray-500 resize-none focus:outline-none focus:ring-0 min-h-[48px] max-h-[200px]"
          />

          <div className="absolute top-3 right-[60px] text-[11px] text-surface-700 font-medium pointer-events-none tracking-wide select-none">
            {input.length === 0 && !isStreaming && attachments.length === 0 ? '(/ for commands)' : ''}
          </div>

          {/* Stop button — always visible during streaming */}
          {isStreaming && (
            <button
              onClick={() => {
                // Stop streaming AND restore queued messages to input
                const sid = useChatStore.getState().sessionId;
                if (sid) {
                  const queue = useChatStore.getState().messageQueue[sid];
                  if (queue && queue.length > 0) {
                    const restored = [input, ...queue].filter(Boolean).join('\n\n');
                    setInput(restored);
                    saveDraft(sid, restored);
                    useChatStore.getState().clearSessionQueue(sid);
                    if (textareaRef.current) {
                      const el = textareaRef.current;
                      requestAnimationFrame(() => {
                        el.style.height = 'auto';
                        el.style.height = Math.min(el.scrollHeight, 200) + 'px';
                      });
                    }
                  }
                }
                onAbort();
              }}
              className="p-2 m-1 bg-surface-700 hover:bg-surface-600 rounded-xl transition-all shrink-0 text-red-400 hover:shadow-lg shadow-surface-900"
              title="Stop"
              aria-label="응답 중단"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="7" y="7" width="10" height="10" rx="2" />
              </svg>
            </button>
          )}
          {/* Send/Queue button — hidden when streaming with empty input (Stop takes its place) */}
          {!(isStreaming && !input.trim() && attachments.length === 0) && (
            <button
              onClick={handleSubmit}
              disabled={!input.trim() && attachments.length === 0}
              className={`p-2 m-1 rounded-xl transition-all disabled:cursor-not-allowed shrink-0 active:scale-95 group ${
                isStreaming && (input.trim() || attachments.length > 0)
                  ? 'bg-primary-900/40 hover:bg-primary-800/50 text-primary-300 border border-primary-500/30 shadow-lg shadow-primary-900/10'
                  : 'bg-primary-600 hover:bg-primary-500 disabled:bg-surface-700 disabled:text-surface-600 disabled:shadow-none text-white shadow-lg shadow-primary-900/20'
              }`}
              title={isStreaming ? 'Add to queue' : 'Send'}
              aria-label={isStreaming ? '대기열에 추가' : '메시지 전송'}
            >
              {isStreaming && (input.trim() || attachments.length > 0) ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              ) : (
                <svg className="w-5 h-5 transform group-active:translate-x-[1px] group-active:translate-y-[-1px] group-hover:translate-x-[1px] group-hover:translate-y-[-1px] transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
