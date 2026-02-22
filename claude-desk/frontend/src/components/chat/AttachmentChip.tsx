import React from 'react';
import type { Attachment } from '../../stores/chat-store';

interface AttachmentChipProps {
  attachment: Attachment;
  onRemove: (id: string) => void;
}

const chipStyles: Record<Attachment['type'], { icon: string; bg: string; text: string; border: string }> = {
  prompt: {
    icon: '\u26A1',
    bg: 'bg-amber-900/30',
    text: 'text-amber-300',
    border: 'border-amber-500/30',
  },
  command: {
    icon: '/',
    bg: 'bg-primary-900/30',
    text: 'text-primary-300',
    border: 'border-primary-500/30',
  },
  file: {
    icon: '\uD83D\uDCC4',
    bg: 'bg-blue-900/30',
    text: 'text-blue-300',
    border: 'border-blue-500/30',
  },
  upload: {
    icon: '\uD83D\uDCCE',
    bg: 'bg-emerald-900/30',
    text: 'text-emerald-300',
    border: 'border-emerald-500/30',
  },
};

export function AttachmentChip({ attachment, onRemove }: AttachmentChipProps) {
  const style = chipStyles[attachment.type];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium border ${style.bg} ${style.text} ${style.border} max-w-[200px] group`}
    >
      <span className="shrink-0 text-[11px]">{style.icon}</span>
      <span className="truncate">{attachment.label}</span>
      <button
        onClick={() => onRemove(attachment.id)}
        className="shrink-0 ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
        title="제거"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}
