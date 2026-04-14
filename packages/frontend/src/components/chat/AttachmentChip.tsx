import type { Attachment } from '../../stores/chat-store';

interface AttachmentChipProps {
  attachment: Attachment;
  onRemove: (id: string) => void;
}

/* ── Helpers ── */

function stripTimestampPrefix(name: string): string {
  return name.replace(/^\d{10,}-/, '');
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    pdf: '📄', doc: '📄', docx: '📄',
    xls: '📊', xlsx: '📊', csv: '📊',
    ppt: '📊', pptx: '📊',
    zip: '📦', tar: '📦', gz: '📦', rar: '📦', '7z': '📦',
    mp3: '🎵', wav: '🎵', ogg: '🎵',
    mp4: '🎬', mov: '🎬', avi: '🎬', webm: '🎬',
    svg: '🎨',
  };
  return map[ext] || '📁';
}

function getServeUrl(filePath: string): string {
  const token = localStorage.getItem('token') || '';
  return `/api/files/serve?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`;
}

/* ── Styles for non-file types ── */

const chipStyles: Record<string, { icon: string; bg: string; text: string; border: string }> = {
  prompt: { icon: '⚡', bg: 'bg-amber-900/30', text: 'text-amber-300', border: 'border-amber-500/30' },
  command: { icon: '/', bg: 'bg-primary-900/30', text: 'text-primary-300', border: 'border-primary-500/30' },
  upload: { icon: '📎', bg: 'bg-emerald-900/30', text: 'text-emerald-300', border: 'border-emerald-500/30' },
};

/* ── Remove button ── */

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
      title="Remove"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

/* ── Main component ── */

export function AttachmentChip({ attachment, onRemove }: AttachmentChipProps) {
  const isFile = attachment.type === 'file';
  const isImage = isFile && attachment.mimeType?.startsWith('image/');

  // ── Image thumbnail ──
  if (isFile && isImage) {
    return (
      <span
        className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-lg text-[12px] font-medium border bg-blue-900/30 text-blue-300 border-blue-500/30 max-w-[220px] group"
        data-path={attachment.content}
      >
        <img
          src={getServeUrl(attachment.tempPath || attachment.content)}
          alt={attachment.label}
          className="h-12 max-w-[80px] rounded object-cover"
          loading="lazy"
        />
        <span className="flex flex-col min-w-0 gap-0.5">
          <span className="truncate text-[11px]">{stripTimestampPrefix(attachment.label)}</span>
          {attachment.size && (
            <span className="text-[10px] text-blue-400/60">{formatFileSize(attachment.size)}</span>
          )}
        </span>
        <RemoveBtn onClick={() => onRemove(attachment.id)} />
      </span>
    );
  }

  // ── Non-image file ──
  if (isFile) {
    const icon = getFileIcon(attachment.label);
    const sizeStr = formatFileSize(attachment.size);
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium border bg-blue-900/30 text-blue-300 border-blue-500/30 max-w-[220px] group"
        data-path={attachment.content}
      >
        <span className="shrink-0 text-[14px]">{icon}</span>
        <span className="truncate">{stripTimestampPrefix(attachment.label)}</span>
        {sizeStr && <span className="shrink-0 text-[10px] text-blue-400/60">{sizeStr}</span>}
        <RemoveBtn onClick={() => onRemove(attachment.id)} />
      </span>
    );
  }

  // ── Default: prompt / command / upload ──
  const style = chipStyles[attachment.type] || chipStyles.upload;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium border ${style.bg} ${style.text} ${style.border} max-w-[200px] group`}
    >
      <span className="shrink-0 text-[11px]">{style.icon}</span>
      <span className="truncate">{attachment.label}</span>
      <RemoveBtn onClick={() => onRemove(attachment.id)} />
    </span>
  );
}
