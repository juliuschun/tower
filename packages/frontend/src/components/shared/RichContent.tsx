import React, { useMemo, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { MermaidBlock } from '../chat/MermaidBlock';
import { splitDynamicBlocks, type DynamicBlock } from './split-dynamic-blocks';
import { useActiveSessionStreaming } from '../../hooks/useActiveSessionStreaming';

// remark-math: disable inline $ to avoid $100 / $USD conflicts
const remarkMathOptions = { singleDollarTextMath: false };

// Lazy-loaded visual blocks
const ChartBlock = React.lazy(() => import('../chat/ChartBlock'));
const SecureInputBlock = React.lazy(() => import('../chat/SecureInputBlock'));
const DataTableBlock = React.lazy(() => import('../chat/DataTableBlock'));
const HtmlSandboxBlock = React.lazy(() => import('../chat/HtmlSandboxBlock'));
const TimelineBlock = React.lazy(() => import('../chat/TimelineBlock'));
const MapBlock = React.lazy(() => import('../chat/MapBlock'));
const StepsBlock = React.lazy(() => import('../chat/StepsBlock'));
const DiffBlock = React.lazy(() => import('../chat/DiffBlock'));
const FormBlock = React.lazy(() => import('../chat/FormBlock'));
const KanbanBlock = React.lazy(() => import('../chat/KanbanBlock'));
const TerminalBlock = React.lazy(() => import('../chat/TerminalBlock'));
const ComparisonBlock = React.lazy(() => import('../chat/ComparisonBlock'));
const ApprovalBlock = React.lazy(() => import('../chat/ApprovalBlock'));
const TreemapBlock = React.lazy(() => import('../chat/TreemapBlock'));
const GalleryBlock = React.lazy(() => import('../chat/GalleryBlock'));
const AudioBlock = React.lazy(() => import('../chat/AudioBlock'));
const BrowserPopupBlock = React.lazy(() => import('../chat/BrowserPopupBlock'));
const BrowserLiveBlock = React.lazy(() => import('../chat/BrowserLiveBlock'));

/* ── Skeleton / Fallback ── */

function BlockSkeleton({ type }: { type: string }) {
  return (
    <div className="my-2 rounded-lg border border-surface-700/40 bg-surface-900/60 p-4 animate-pulse">
      <div className="h-4 w-24 bg-surface-700/50 rounded mb-2" />
      <div className="h-32 bg-surface-700/30 rounded" />
      <span className="text-[10px] text-gray-600 mt-1 block">{type} loading…</span>
    </div>
  );
}

export function BlockFallback({ raw, error }: { raw: string; error?: string }) {
  return (
    <pre className="my-2 bg-surface-900/60 border border-surface-700/40 rounded-lg p-4 overflow-x-auto text-sm">
      {error && <code className="text-xs text-red-400 block mb-2">{error}</code>}
      <code>{raw}</code>
    </pre>
  );
}

/* ── File path detection ── */

const PREVIEWABLE_EXTS = new Set([
  'pdf', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp',
  'html', 'htm', 'md', 'txt', 'json', 'yaml', 'yml',
  'ts', 'tsx', 'js', 'jsx', 'py', 'sh', 'sql', 'css',
  'mp4', 'webm',
]);

// Match absolute paths like /home/user/file.ext, ~/file.ext, ./file.ext
// Must have a file extension to avoid false positives
const FILE_PATH_REGEX = /(?:^|\s)((?:\/[\w.@-]+)+\/[\w.@-]+\.[\w]+|~\/[\w.@/-]+\.[\w]+|\.\/[\w.@/-]+\.[\w]+)/g;

function hasPreviewableExt(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? PREVIEWABLE_EXTS.has(ext) : false;
}

/** Split text into segments: plain text and file path links */
function splitFilePathsInText(text: string, onFileClick: (path: string) => void): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const regex = new RegExp(FILE_PATH_REGEX.source, 'g');

  for (const match of text.matchAll(regex)) {
    const fullMatch = match[0];
    const filePath = match[1];
    // Calculate position — the match may include leading whitespace
    const pathStart = match.index! + fullMatch.indexOf(filePath);

    if (!hasPreviewableExt(filePath)) {
      continue;
    }

    if (pathStart > lastIndex) {
      parts.push(text.slice(lastIndex, pathStart));
    }

    parts.push(
      <span
        key={pathStart}
        className="text-primary-400 hover:text-primary-300 cursor-pointer underline decoration-primary-400/40 hover:decoration-primary-300/60 transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onFileClick(filePath);
        }}
        title={`Open ${filePath}`}
      >
        {filePath}
      </span>
    );
    lastIndex = pathStart + filePath.length;
  }

  if (lastIndex === 0) return []; // No file paths found
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

/* ── Shared markdown custom components ── */

interface MdComponentsOptions {
  onFileClick?: (path: string) => void;
}

function buildMdComponents({ onFileClick }: MdComponentsOptions = {}) {
  return {
    img({ src, alt, ...props }: Record<string, any>) {
      let imgSrc = src || '';
      if (imgSrc.startsWith('/home/') || imgSrc.startsWith('/tmp/') || imgSrc.startsWith('/workspace/')) {
        const token = localStorage.getItem('token') || '';
        imgSrc = `/api/files/serve?path=${encodeURIComponent(imgSrc)}&token=${encodeURIComponent(token)}`;
      } else if (imgSrc.startsWith('/api/files/serve') && !imgSrc.includes('token=')) {
        const token = localStorage.getItem('token') || '';
        const sep = imgSrc.includes('?') ? '&' : '?';
        imgSrc = `${imgSrc}${sep}token=${encodeURIComponent(token)}`;
      }
      return (
        <img
          src={imgSrc}
          alt={alt || ''}
          loading="lazy"
          className="max-w-full rounded-lg border border-surface-700/40 cursor-pointer hover:opacity-90 transition-opacity"
          onClick={() => window.open(imgSrc, '_blank')}
          {...props}
        />
      );
    },
    code({ children, className, ...props }: Record<string, any>) {
      const isInline = !className;
      const text = String(children).trim();
      if (isInline && text.startsWith('/') && onFileClick) {
        return (
          <code
            {...props}
            className="cursor-pointer hover:text-primary-400 transition-colors"
            onClick={() => onFileClick(text)}
          >
            {children}
          </code>
        );
      }
      return <code className={className} {...props}>{children}</code>;
    },
    // Detect file paths in plain text paragraphs
    p({ children, ...props }: Record<string, any>) {
      if (!onFileClick) {
        return <p {...props}>{children}</p>;
      }
      // Process string children to find file paths
      const processed = React.Children.map(children, (child) => {
        if (typeof child !== 'string') return child;
        const parts = splitFilePathsInText(child, onFileClick);
        return parts.length > 0 ? <>{parts}</> : child;
      });
      return <p {...props}>{processed}</p>;
    },
    pre({ children }: { children?: React.ReactNode }) {
      const codeText = extractCodeText(children);
      return (
        <pre className="relative group/code">
          {children}
          {codeText && (
            <CopyBtn
              text={codeText}
              className="absolute top-2 right-2 opacity-60 hover:opacity-100 transition-opacity"
            />
          )}
        </pre>
      );
    },
  };
}

function extractCodeText(children: React.ReactNode): string {
  let text = '';
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.props) {
      const props = child.props as Record<string, unknown>;
      if (props.children) text += String(props.children);
    }
  });
  return text.trim();
}

function CopyBtn({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={`p-1.5 rounded-md bg-surface-800/80 border border-surface-700/50 text-gray-400 hover:text-gray-200 hover:bg-surface-700/80 transition-all ${className}`}
      title="Copy"
    >
      {copied ? (
        <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

/* ── Markdown renderer ── */

/**
 * MarkdownSegment is memoized: re-renders only when `content` changes.
 * Without React.memo, every parent re-render (e.g. each streaming token)
 * forces ReactMarkdown + remark/rehype plugin chain to re-execute on
 * already-finalized text segments — the dominant cost during streaming.
 */
const MarkdownSegment = React.memo(function MarkdownSegment({
  content,
  mdComponents,
}: { content: string; mdComponents: Record<string, any> }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none overflow-hidden break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, remarkMathOptions]]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={mdComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}, (prev, next) => prev.content === next.content && prev.mdComponents === next.mdComponents);

/* ── RichContent entry point ── */

export interface RichContentProps {
  text: string;
  onFileClick?: (path: string) => void;
}

/**
 * Heavy visual blocks that are expensive to mount/render.
 * While streaming, these are deferred behind a skeleton until either
 * (a) streaming ends, or (b) the block is no longer the trailing segment
 * (= the closing fence has been seen → block is "complete").
 */
const HEAVY_BLOCKS: ReadonlySet<DynamicBlock['type']> = new Set([
  'mermaid', 'chart', 'treemap', 'gallery', 'map', 'html-sandbox',
  'browser-popup', 'browser-live',
]);

/**
 * Build a stable key for a segment based on its type + content signature.
 * Index-based keys (`key={i}`) cause React to re-mount blocks whenever
 * splitDynamicBlocks returns a different number of segments mid-stream
 * (e.g. ```chart fence appears → text becomes [text, chart]).
 * A content-derived key keeps DOM identity stable across those updates.
 */
function segmentKey(seg: DynamicBlock, i: number): string {
  const head = seg.content.length > 0 ? seg.content.slice(0, 24) : '';
  return `${i}:${seg.type}:${seg.content.length}:${head}`;
}

export function RichContent({ text, onFileClick }: RichContentProps) {
  // Defensive: ensure text is always a string (streaming may pass non-string)
  const safeText = typeof text === 'string' ? text : String(text ?? '');
  const segments = useMemo(() => splitDynamicBlocks(safeText), [safeText]);
  const mdComponents = useMemo(() => buildMdComponents({ onFileClick }), [onFileClick]);
  const isStreaming = useActiveSessionStreaming();

  return (
    <>
      {segments.map((seg, i) => {
        // Heavy blocks: defer mounting if this is the LAST segment AND streaming is on.
        // Once a closing fence appears, splitDynamicBlocks pushes a new trailing
        // text segment after the heavy block — at that point the heavy block
        // is "frozen" and safe to render immediately.
        const isLast = i === segments.length - 1;
        const deferHeavy = isStreaming && isLast && HEAVY_BLOCKS.has(seg.type);
        return (
          <RichSegment
            key={segmentKey(seg, i)}
            seg={seg}
            mdComponents={mdComponents}
            deferHeavy={deferHeavy}
          />
        );
      })}
    </>
  );
}

const RichSegment = React.memo(function RichSegment({
  seg,
  mdComponents,
  deferHeavy,
}: { seg: DynamicBlock; mdComponents: Record<string, any>; deferHeavy?: boolean }) {
  if (deferHeavy && HEAVY_BLOCKS.has(seg.type)) {
    return <BlockSkeleton type={seg.type} />;
  }
  return <RichSegmentInner seg={seg} mdComponents={mdComponents} />;
}, (prev, next) =>
  prev.deferHeavy === next.deferHeavy &&
  prev.mdComponents === next.mdComponents &&
  prev.seg.type === next.seg.type &&
  prev.seg.content === next.seg.content
);

function RichSegmentInner({ seg, mdComponents }: { seg: DynamicBlock; mdComponents: Record<string, any> }) {
  if (seg.type === 'text') {
    return <MarkdownSegment content={seg.content} mdComponents={mdComponents} />;
  }
  if (seg.type === 'mermaid') {
    return <MermaidBlock code={seg.content} />;
  }
  if (seg.type === 'chart') {
    return (
      <Suspense fallback={<BlockSkeleton type="chart" />}>
        <ChartBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'secure-input') {
    return (
      <Suspense fallback={<BlockSkeleton type="secure-input" />}>
        <SecureInputBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'datatable') {
    return (
      <Suspense fallback={<BlockSkeleton type="datatable" />}>
        <DataTableBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'html-sandbox') {
    return (
      <Suspense fallback={<BlockSkeleton type="html-sandbox" />}>
        <HtmlSandboxBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'timeline') {
    return (
      <Suspense fallback={<BlockSkeleton type="timeline" />}>
        <TimelineBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'map') {
    return (
      <Suspense fallback={<BlockSkeleton type="map" />}>
        <MapBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'steps') {
    return (
      <Suspense fallback={<BlockSkeleton type="steps" />}>
        <StepsBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'diff') {
    return (
      <Suspense fallback={<BlockSkeleton type="diff" />}>
        <DiffBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'form') {
    return (
      <Suspense fallback={<BlockSkeleton type="form" />}>
        <FormBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'kanban') {
    return (
      <Suspense fallback={<BlockSkeleton type="kanban" />}>
        <KanbanBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'terminal') {
    return (
      <Suspense fallback={<BlockSkeleton type="terminal" />}>
        <TerminalBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'comparison') {
    return (
      <Suspense fallback={<BlockSkeleton type="comparison" />}>
        <ComparisonBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'approval') {
    return (
      <Suspense fallback={<BlockSkeleton type="approval" />}>
        <ApprovalBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'treemap') {
    return (
      <Suspense fallback={<BlockSkeleton type="treemap" />}>
        <TreemapBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'gallery') {
    return (
      <Suspense fallback={<BlockSkeleton type="gallery" />}>
        <GalleryBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'audio') {
    return (
      <Suspense fallback={<BlockSkeleton type="audio" />}>
        <AudioBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'browser-popup') {
    return (
      <Suspense fallback={<BlockSkeleton type="browser-popup" />}>
        <BrowserPopupBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  if (seg.type === 'browser-live') {
    return (
      <Suspense fallback={<BlockSkeleton type="browser-live" />}>
        <BrowserLiveBlock raw={seg.content} fallbackCode={seg.raw} />
      </Suspense>
    );
  }
  return <BlockFallback raw={seg.raw} error={`${seg.type} renderer not yet available`} />;
}

export { BlockSkeleton };
