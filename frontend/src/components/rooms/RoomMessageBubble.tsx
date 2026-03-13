import type { RoomMessage } from '../../stores/room-store';

interface RoomMessageBubbleProps {
  message: RoomMessage;
  isOwnMessage: boolean;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function RoomMessageBubble({ message, isOwnMessage }: RoomMessageBubbleProps) {
  // System message — centered gray text
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
      <div className="flex gap-2.5 px-4 py-2">
        <div className="w-7 h-7 rounded-full bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-[11px] font-bold text-emerald-400">AI</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-[12px] font-semibold text-emerald-400">AI Summary</span>
            <span className="text-[10px] text-gray-600">{formatTime(message.createdAt)}</span>
          </div>
          <div className="text-[13px] text-gray-300 leading-relaxed bg-emerald-950/20 border border-emerald-900/30 rounded-lg px-3 py-2 whitespace-pre-wrap">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  // AI error — red accent
  if (message.msgType === 'ai_error') {
    return (
      <div className="flex gap-2.5 px-4 py-2">
        <div className="w-7 h-7 rounded-full bg-red-600/20 border border-red-500/30 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-[11px] font-bold text-red-400">!</span>
        </div>
        <div className="flex-1 min-w-0">
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

  // AI task reference — mini task card
  if (message.msgType === 'ai_task_ref') {
    const meta = message.metadata || {};
    const taskTitle = (meta.taskTitle as string) || 'AI Task';
    const taskStatus = (meta.taskStatus as string) || 'pending';
    const statusColor = taskStatus === 'done' ? 'text-emerald-400' :
      taskStatus === 'running' ? 'text-blue-400' :
      taskStatus === 'failed' ? 'text-red-400' : 'text-gray-400';

    return (
      <div className="flex gap-2.5 px-4 py-2">
        <div className="w-7 h-7 rounded-full bg-primary-600/20 border border-primary-500/30 flex items-center justify-center shrink-0 mt-0.5">
          <svg className="w-3.5 h-3.5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
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

  return (
    <div className={`flex gap-2.5 px-4 py-2 ${isOwnMessage ? '' : ''}`}>
      <div className="w-7 h-7 rounded-full bg-surface-700 border border-surface-600 flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-[11px] font-bold text-gray-300">{initial}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-[12px] font-semibold text-gray-200">{message.senderName || 'Unknown'}</span>
          <span className="text-[10px] text-gray-600">{formatTime(message.createdAt)}</span>
        </div>
        <div className="text-[13px] text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    </div>
  );
}
