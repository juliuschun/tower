import React, { useState, useEffect } from 'react';
import { getToolLabel, getToolSummary } from '../../utils/message-parser';
import { useChatStore } from '../../stores/chat-store';

interface ToolUseCardProps {
  name: string;
  input: Record<string, any>;
  result?: string;
  onFileClick?: (path: string) => void;
  compact?: boolean;
}

const toolMeta: Record<string, { icon: React.ReactNode; color: string; bg: string; border: string }> = {
  Bash: {
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />,
    color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20',
  },
  Read: {
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />,
    color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20',
  },
  Write: {
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />,
    color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20',
  },
  Edit: {
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />,
    color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20',
  },
  Glob: {
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />,
    color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20',
  },
  Grep: {
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 21h7a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v11m0 5l4.879-4.879m0 0a3 3 0 104.243-4.242 3 3 0 00-4.243 4.242z" />,
    color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20',
  },
  Task: {
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />,
    color: 'text-pink-400', bg: 'bg-pink-500/10', border: 'border-pink-500/20',
  },
  WebSearch: {
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />,
    color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/20',
  },
  WebFetch: {
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />,
    color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/20',
  },
};

const defaultMeta = {
  icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />,
  color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/20',
};

export function ToolUseCard({ name, input, result, onFileClick, compact }: ToolUseCardProps) {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const isRunning = !result && isStreaming;

  // Collapsed by default — click to expand
  const [expanded, setExpanded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(true);

  const meta = toolMeta[name] || defaultMeta;
  const label = getToolLabel(name);
  const summary = getToolSummary(name, input);
  const filePath = input.file_path || input.path;

  // Collapse after result arrives and a new tool starts
  useEffect(() => {
    if (result) {
      // Keep expanded briefly then allow manual collapse
    }
  }, [result]);

  return (
    <div className={`rounded-xl overflow-hidden border ${meta.border} ${meta.bg} backdrop-blur-sm transition-all duration-200`}>
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-3 hover:bg-white/[0.03] transition-colors ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}
      >
        {/* Icon */}
        <div className={`${compact ? 'w-5 h-5 rounded-md' : 'w-7 h-7 rounded-lg'} ${meta.bg} border ${meta.border} flex items-center justify-center shrink-0`}>
          <svg className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} ${meta.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {meta.icon}
          </svg>
        </div>

        {/* Label + Summary */}
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[13px] font-semibold ${meta.color}`}>{label}</span>
            {isRunning && (
              <span className="flex items-center gap-1 text-[11px] text-primary-400 font-medium">
                <span className="w-1 h-1 rounded-full bg-primary-400 thinking-indicator" />
                실행 중
              </span>
            )}
            {result && !isRunning && (
              <span className="text-[11px] text-emerald-400/80 font-medium flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                완료
              </span>
            )}
          </div>
          {!compact && <div className="text-[12px] text-gray-500 truncate mt-0.5">{summary}</div>}
        </div>

        {/* Expand chevron */}
        <svg
          className={`w-4 h-4 text-gray-600 transition-transform duration-200 shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-2">
          {/* === Bash === */}
          {name === 'Bash' && input.command && (
            <div className="bg-surface-950/60 rounded-lg p-3 font-mono text-[12px] overflow-x-auto">
              <span className="text-emerald-500/60 select-none">$ </span>
              <span className="text-emerald-300">{input.command}</span>
            </div>
          )}

          {/* === Read / Write / Edit — file path === */}
          {(name === 'Read' || name === 'Write' || name === 'Edit') && filePath && (
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-gray-500">파일</span>
              <button
                className={`${meta.color} hover:underline font-mono truncate`}
                onClick={(e) => { e.stopPropagation(); onFileClick?.(filePath); }}
              >
                {filePath}
              </button>
            </div>
          )}

          {/* === Edit — diff view === */}
          {name === 'Edit' && input.old_string && (
            <div className="space-y-1.5 mt-1">
              <div className="bg-red-950/20 border-l-2 border-red-500/50 rounded-r-lg p-2.5 font-mono text-[11px] text-red-300/90 whitespace-pre-wrap overflow-x-auto max-h-32 overflow-y-auto">
                {input.old_string}
              </div>
              <div className="bg-emerald-950/20 border-l-2 border-emerald-500/50 rounded-r-lg p-2.5 font-mono text-[11px] text-emerald-300/90 whitespace-pre-wrap overflow-x-auto max-h-32 overflow-y-auto">
                {input.new_string}
              </div>
            </div>
          )}

          {/* === Write — content preview === */}
          {name === 'Write' && input.content && (
            <div className="bg-surface-950/60 rounded-lg p-3 font-mono text-[11px] text-gray-400 overflow-x-auto max-h-32 overflow-y-auto">
              {input.content.slice(0, 500)}{input.content.length > 500 ? '\n...' : ''}
            </div>
          )}

          {/* === Grep === */}
          {name === 'Grep' && (
            <div className="text-[12px] text-gray-400 flex items-center gap-2">
              <span className="text-gray-500">패턴</span>
              <code className={`${meta.color} bg-surface-950/60 px-2 py-0.5 rounded font-mono`}>{input.pattern}</code>
              {input.path && <><span className="text-gray-600">|</span> <span className="text-gray-500">{input.path}</span></>}
            </div>
          )}

          {/* === Glob === */}
          {name === 'Glob' && (
            <div className="text-[12px] text-gray-400 flex items-center gap-2">
              <span className="text-gray-500">패턴</span>
              <code className={`${meta.color} bg-surface-950/60 px-2 py-0.5 rounded font-mono`}>{input.pattern}</code>
            </div>
          )}

          {/* === Task (subagent) === */}
          {name === 'Task' && (
            <div className="text-[12px] space-y-1">
              {input.description && <div className="text-gray-300 font-medium">{input.description}</div>}
              {input.prompt && (
                <div className="bg-surface-950/60 rounded-lg p-3 text-gray-400 text-[11px] max-h-24 overflow-y-auto">
                  {input.prompt.slice(0, 300)}{input.prompt.length > 300 ? '...' : ''}
                </div>
              )}
            </div>
          )}

          {/* === Generic fallback === */}
          {!['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Task'].includes(name) && Object.keys(input).length > 0 && (
            <div className="bg-surface-950/60 rounded-lg p-3 font-mono text-[11px] text-gray-400 overflow-x-auto max-h-32 overflow-y-auto">
              {JSON.stringify(input, null, 2)}
            </div>
          )}

          {/* === Result === */}
          {result && (
            <div className="mt-2">
              <button
                onClick={(e) => { e.stopPropagation(); setResultExpanded(!resultExpanded); }}
                className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors mb-1.5"
              >
                <svg className={`w-3 h-3 transition-transform ${resultExpanded ? 'rotate-90' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                결과
                <span className="text-gray-600">({result.length.toLocaleString()} 글자)</span>
              </button>
              {resultExpanded && (
                <div className="bg-surface-950/60 rounded-lg p-3 font-mono text-[11px] text-gray-300 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {result.slice(0, 2000)}{result.length > 2000 ? '\n\n... (truncated)' : ''}
                </div>
              )}
            </div>
          )}

          {/* Running indicator */}
          {isRunning && !result && (
            <div className="flex items-center gap-2 text-[11px] text-primary-400/70 pt-1">
              <div className="w-3 h-3 border-2 border-primary-500/30 border-t-primary-400 rounded-full animate-spin" />
              실행 중...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
