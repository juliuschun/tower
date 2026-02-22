import React, { useState, useRef, useEffect } from 'react';
import { useChatStore, type SlashCommandInfo } from '../../stores/chat-store';
import { AttachmentChip } from './AttachmentChip';

interface InputBoxProps {
  onSend: (message: string) => void;
  onAbort: () => void;
}

export function InputBox({ onSend, onAbort }: InputBoxProps) {
  const [input, setInput] = useState('');
  const [queued, setQueued] = useState<{ message: string; sessionId: string } | null>(null);
  const [showCommands, setShowCommands] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const currentSessionId = useChatStore((s) => s.sessionId);
  const slashCommands = useChatStore((s) => s.slashCommands);
  const attachments = useChatStore((s) => s.attachments);

  // Clear queued message when session changes
  useEffect(() => {
    setQueued(null);
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

  // Auto-send queued message when streaming stops (only if session matches)
  useEffect(() => {
    if (!isStreaming && queued) {
      const nowSid = useChatStore.getState().sessionId;
      if (nowSid === queued.sessionId) {
        onSend(queued.message);
      }
      setQueued(null);
    }
  }, [isStreaming, queued, onSend]);

  const buildMessage = (text: string): string => {
    if (attachments.length === 0) return text;

    const parts: string[] = [];
    for (const att of attachments) {
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
    const hasCommand = attachments.some((a) => a.type === 'command');
    if (hasCommand) {
      const cmdParts = attachments.filter((a) => a.type === 'command').map((a) => a.content);
      const otherParts = attachments.filter((a) => a.type !== 'command');
      const prefix = cmdParts.join(' ');
      const otherContent = otherParts.map((a) => a.type === 'file' ? `[file: ${a.content}]` : a.content).join('\n\n');
      const combined = otherContent ? `${otherContent}\n\n${text}` : text;
      return `${prefix} ${combined}`.trim();
    }

    // Prompt/file: join with double newlines before user text
    return `${parts.join('\n\n')}\n\n${text}`.trim();
  };

  const handleSubmit = () => {
    const trimmed = input.trim();
    const hasContent = trimmed || attachments.length > 0;
    if (!hasContent) return;

    const message = buildMessage(trimmed);

    if (isStreaming) {
      setQueued({ message, sessionId: useChatStore.getState().sessionId || '' });
    } else {
      onSend(message);
    }

    setInput('');
    setShowCommands(false);
    useChatStore.getState().clearAttachments();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleCancelQueue = () => {
    setQueued(null);
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
      if (queued) {
        handleCancelQueue();
      } else if (showCommands) {
        setShowCommands(false);
      }
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
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

    // Handle OS file drops
    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    for (const file of Array.from(files)) {
      // Skip large files (>1MB for text reading)
      if (file.size > 1024 * 1024) {
        useChatStore.getState().addAttachment({
          id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'upload',
          label: `${file.name} (too large)`,
          content: `[File "${file.name}" is too large for inline reading (${(file.size / 1024 / 1024).toFixed(1)}MB). Use file tree upload instead.]`,
        });
        continue;
      }
      try {
        const text = await file.text();
        useChatStore.getState().addAttachment({
          id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'upload',
          label: file.name,
          content: text,
        });
      } catch {
        // Binary file — just note it
        useChatStore.getState().addAttachment({
          id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'upload',
          label: file.name,
          content: `[Binary file: ${file.name} (${(file.size / 1024).toFixed(1)}KB)]`,
        });
      }
    }
    textareaRef.current?.focus();
  };

  return (
    <div className="max-w-3xl mx-auto relative">
      {/* Queued message indicator */}
      {queued && (
        <div className="mb-2 flex items-center gap-2 px-4 py-2 bg-primary-900/20 border border-primary-500/20 rounded-xl text-[13px] text-primary-300 backdrop-blur-sm">
          <div className="w-4 h-4 border-2 border-primary-500/30 border-t-primary-400 rounded-full animate-spin shrink-0" />
          <span className="truncate flex-1">대기 중: {queued.message}</span>
          <button
            onClick={handleCancelQueue}
            className="text-primary-400/60 hover:text-primary-300 p-0.5 transition-colors shrink-0"
            title="대기 취소 (Esc)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div
        className={`rounded-2xl shadow-2xl shadow-black/40 ring-1 bg-surface-800/80 backdrop-blur-2xl transition-all relative ${
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
            <span className="text-[13px] text-primary-300 font-medium">여기에 놓으세요</span>
          </div>
        )}

        {/* Slash command picker */}
        {showCommands && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-surface-800/90 backdrop-blur-xl border border-surface-700/50 rounded-xl max-h-48 overflow-y-auto shadow-xl">
            {filteredCommands.map((cmd, idx) => (
              <button
                key={cmd.name}
                className={`w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-surface-700/50 hover:text-white transition-colors flex items-center gap-2 group ${
                  idx === selectedIndex ? 'bg-surface-700/50 text-white' : ''
                }`}
                onClick={() => selectCommand(cmd.name)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span className="text-primary-500/70 group-hover:text-primary-400 font-mono shrink-0">/</span>
                <span className="font-medium truncate">{cmd.name}</span>
                {cmd.description && (
                  <span className="text-[11px] text-gray-500 truncate ml-1">{cmd.description}</span>
                )}
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ml-auto shrink-0 ${
                  cmd.source === 'commands'
                    ? 'bg-blue-900/30 text-blue-400 border border-blue-500/20'
                    : 'bg-surface-700/50 text-gray-500 border border-surface-600/30'
                }`}>
                  {cmd.source === 'commands' ? 'cmd' : 'sdk'}
                </span>
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
                onRemove={(id) => useChatStore.getState().removeAttachment(id)}
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
            placeholder={
              queued
                ? '추가 메시지를 대기열에 넣을 수 있습니다...'
                : isStreaming
                  ? '메시지를 입력하면 다음 턴에 전송됩니다...'
                  : attachments.length > 0
                    ? '추가 메시지를 입력하거나 바로 전송하세요...'
                    : '메시지를 입력하세요...'
            }
            rows={1}
            className="flex-1 bg-transparent border-none px-4 py-3 text-[15px] text-gray-100 placeholder-gray-500 resize-none focus:outline-none focus:ring-0 min-h-[48px] max-h-[200px]"
          />

          <div className="absolute top-3 right-[60px] text-[11px] text-surface-700 font-medium pointer-events-none tracking-wide select-none">
            {input.length === 0 && !isStreaming && attachments.length === 0 ? '(/로 명령어)' : ''}
          </div>

          {isStreaming && !input.trim() && attachments.length === 0 ? (
            <button
              onClick={onAbort}
              className="p-2 m-1 bg-surface-700 hover:bg-surface-600 rounded-xl transition-all shrink-0 text-red-400 hover:shadow-lg shadow-surface-900"
              title="중단"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="7" y="7" width="10" height="10" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim() && attachments.length === 0}
              className={`p-2 m-1 rounded-xl transition-all disabled:cursor-not-allowed shrink-0 active:scale-95 group ${
                isStreaming && (input.trim() || attachments.length > 0)
                  ? 'bg-primary-900/40 hover:bg-primary-800/50 text-primary-300 border border-primary-500/30 shadow-lg shadow-primary-900/10'
                  : 'bg-primary-600 hover:bg-primary-500 disabled:bg-surface-700 disabled:text-surface-600 disabled:shadow-none text-white shadow-lg shadow-primary-900/20'
              }`}
              title={isStreaming ? '대기열에 추가' : '전송'}
            >
              {isStreaming && (input.trim() || attachments.length > 0) ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              ) : (
                <svg className="w-5 h-5 transform group-active:translate-y-[-1px] group-hover:translate-x-[1px] group-hover:translate-y-[-1px] transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m-7 7l7-7 7 7" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
