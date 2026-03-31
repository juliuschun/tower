import React from 'react';
import { RichContent } from '../shared/RichContent';
import type { RoomMessage } from '../../stores/room-store';

/** Render text with @mentions highlighted */
function MentionHighlightedText({ text }: { text: string }) {
  const parts = text.split(/(@\w+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^@\w+$/.test(part) ? (
          <span key={i} className="text-primary-400 font-semibold bg-primary-400/10 rounded px-0.5 cursor-default">
            {part}
          </span>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

interface RoomMessageBubbleProps {
  message: RoomMessage;
  isOwnMessage: boolean;
  parentMessage?: RoomMessage | null;
  onReply?: (message: RoomMessage) => void;
  onOpenThread?: (message: RoomMessage) => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Action buttons shown on hover */
function MessageActions({ onReply, onThread }: { onReply?: () => void; onThread?: () => void }) {
  return (
    <div className="opacity-0 group-hover:opacity-100 absolute -top-2 right-2 flex items-center gap-0.5 bg-surface-700 border border-surface-600 rounded-md shadow-sm">
      {onThread && (
        <button
          onClick={onThread}
          className="p-1 text-gray-400 hover:text-gray-200 hover:bg-surface-600 rounded-md transition-all"
          title="Open Thread"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
        </button>
      )}
      {onReply && (
        <button
          onClick={onReply}
          className="p-1 text-gray-400 hover:text-gray-200 hover:bg-surface-600 rounded-md transition-all"
          title="Reply"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v3M3 10l6-6M3 10l6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** Shows the parent message being replied to */
function ParentPreview({ parent }: { parent: RoomMessage }) {
  const name = parent.senderName || (parent.msgType === 'ai_reply' || parent.msgType === 'ai_summary' ? 'AI' : 'Unknown');
  const preview = parent.content.length > 80 ? parent.content.slice(0, 80) + '...' : parent.content;
  return (
    <div className="flex items-center gap-1.5 mb-1 pl-2 border-l-2 border-surface-600">
      <span className="text-[11px] font-semibold text-gray-500">{name}</span>
      <span className="text-[11px] text-gray-600 truncate">{preview}</span>
    </div>
  );
}

export function RoomMessageBubble({ message, isOwnMessage, parentMessage, onReply, onOpenThread }: RoomMessageBubbleProps) {
  const canReply = onReply && message.msgType !== 'system';
  const canThread = onOpenThread && message.msgType !== 'system';

  // System message — centered gray text (no reply)
  if (message.msgType === 'system') {
    return (
      <div className="flex justify-center py-1.5">
        <span className="text-[11px] text-gray-500 italic">{message.content}</span>
      </div>
    );
  }

  // AI summary — green accent
  if (message.msgType === 'ai_summary') {
    return (
      <div className="group relative flex gap-2.5 px-4 py-2 hover:bg-surface-900/30">
        {(canReply || canThread) && <MessageActions onReply={canReply ? () => onReply(message) : undefined} onThread={canThread ? () => onOpenThread(message) : undefined} />}
        <div className="w-7 h-7 rounded-full bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-[11px] font-bold text-emerald-400">AI</span>
        </div>
        <div className="flex-1 min-w-0">
          {parentMessage && <ParentPreview parent={parentMessage} />}
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-[12px] font-semibold text-emerald-400">
              {message.metadata?.shared_from_panel
                ? `Shared from AI${message.senderName ? ` by ${message.senderName}` : ''}`
                : 'AI Summary'}
            </span>
            <span className="text-[10px] text-gray-600">{formatTime(message.createdAt)}</span>
          </div>
          <div className="text-[13px] text-gray-300 leading-relaxed bg-emerald-950/20 border border-emerald-900/30 rounded-lg px-3 py-2">
            <RichContent text={message.content} />
          </div>
        </div>
      </div>
    );
  }

  // AI error — red accent
  if (message.msgType === 'ai_error') {
    return (
      <div className="group relative flex gap-2.5 px-4 py-2 hover:bg-surface-900/30">
        {(canReply || canThread) && <MessageActions onReply={canReply ? () => onReply(message) : undefined} onThread={canThread ? () => onOpenThread(message) : undefined} />}
        <div className="w-7 h-7 rounded-full bg-red-600/20 border border-red-500/30 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-[11px] font-bold text-red-400">!</span>
        </div>
        <div className="flex-1 min-w-0">
          {parentMessage && <ParentPreview parent={parentMessage} />}
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-[12px] font-semibold text-red-400">Error</span>
            <span className="text-[10px] text-gray-600">{formatTime(message.createdAt)}</span>
          </div>
          <div className="text-[13px] text-red-300 leading-relaxed bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2 whitespace-pre-wrap">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  // AI quick reply — blue accent
  if (message.msgType === 'ai_reply') {
    return (
      <div className="group relative flex gap-2.5 px-4 py-2 hover:bg-surface-900/30">
        {(canReply || canThread) && <MessageActions onReply={canReply ? () => onReply(message) : undefined} onThread={canThread ? () => onOpenThread(message) : undefined} />}
        <div className="w-7 h-7 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-[11px] font-bold text-blue-400">AI</span>
        </div>
        <div className="flex-1 min-w-0">
          {parentMessage && <ParentPreview parent={parentMessage} />}
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-[12px] font-semibold text-blue-400">AI</span>
            <span className="text-[10px] text-gray-600">{formatTime(message.createdAt)}</span>
          </div>
          <div className="text-[13px] text-gray-300 leading-relaxed bg-blue-950/20 border border-blue-900/30 rounded-lg px-3 py-2">
            {message.content && typeof message.content === 'string'
              ? <RichContent text={message.content} />
              : <span className="text-gray-500 italic">typing...</span>
            }
          </div>
        </div>
      </div>
    );
  }

  // AI task reference — mini task card
  if (message.msgType === 'ai_task_ref') {
    const meta = message.metadata || {};
    const taskTitle = (meta.taskTitle as string) || 'AI Task';
    const taskStatus = (meta.taskStatus as string) || 'pending';
    const statusColor = taskStatus === 'done' ? 'text-emerald-400' :
      taskStatus === 'running' ? 'text-blue-400' :
      taskStatus === 'failed' ? 'text-red-400' : 'text-gray-400';

    return (
      <div className="group relative flex gap-2.5 px-4 py-2 hover:bg-surface-900/30">
        {(canReply || canThread) && <MessageActions onReply={canReply ? () => onReply(message) : undefined} onThread={canThread ? () => onOpenThread(message) : undefined} />}
        <div className="w-7 h-7 rounded-full bg-primary-600/20 border border-primary-500/30 flex items-center justify-center shrink-0 mt-0.5">
          <svg className="w-3.5 h-3.5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          {parentMessage && <ParentPreview parent={parentMessage} />}
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-[12px] font-semibold text-primary-400">AI Task</span>
            <span className="text-[10px] text-gray-600">{formatTime(message.createdAt)}</span>
          </div>
          <div className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-gray-200 font-medium">{taskTitle}</span>
              <span className={`text-[10px] font-semibold uppercase ${statusColor}`}>{taskStatus}</span>
            </div>
            {message.content && (
              <p className="text-[12px] text-gray-400 mt-1">{message.content}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Human message
  const initial = (message.senderName || '?')[0].toUpperCase();
  const isPending = message.pending;
  const isFailed = message.failed;

  return (
    <div className={`group relative flex gap-2.5 px-4 py-2 hover:bg-surface-900/30 ${isPending ? 'opacity-60' : ''}`}>
      {(canReply || canThread) && !isPending && !isFailed && <MessageActions onReply={canReply ? () => onReply(message) : undefined} onThread={canThread ? () => onOpenThread(message) : undefined} />}
      <div className="w-7 h-7 rounded-full bg-surface-700 border border-surface-600 flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-[11px] font-bold text-gray-300">{initial}</span>
      </div>
      <div className="flex-1 min-w-0">
        {parentMessage && <ParentPreview parent={parentMessage} />}
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-[12px] font-semibold text-gray-200">{message.senderName || 'Unknown'}</span>
          <span className="text-[10px] text-gray-600">{formatTime(message.createdAt)}</span>
          {isPending && <span className="text-[10px] text-gray-500 italic">Sending...</span>}
          {isFailed && <span className="text-[10px] text-red-400 font-medium">Failed to send</span>}
        </div>
        <div className={`text-[13px] leading-relaxed whitespace-pre-wrap break-words ${isFailed ? 'text-red-300' : 'text-gray-300'}`}>
          <MentionHighlightedText text={message.content} />
        </div>
      </div>
    </div>
  );
}
