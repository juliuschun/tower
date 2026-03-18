import React, { useMemo, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { MermaidBlock } from '../chat/MermaidBlock';
import { splitDynamicBlocks, type DynamicBlock } from './split-dynamic-blocks';

// remark-math: disable inline $ to avoid $100 / $USD conflicts
const remarkMathOptions = { singleDollarTextMath: false };

// Lazy-loaded visual blocks
const ChartBlock = React.lazy(() => import('../chat/ChartBlock'));
const SecureInputBlock = React.lazy(() => import('../chat/SecureInputBlock'));

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

function MarkdownSegment({ content, mdComponents }: { content: string; mdComponents: Record<string, any> }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none overflow-hidden">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, remarkMathOptions]]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={mdComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/* ── RichContent entry point ── */

export interface RichContentProps {
  text: string;
  onFileClick?: (path: string) => void;
}

export function RichContent({ text, onFileClick }: RichContentProps) {
  // Defensive: ensure text is always a string (streaming may pass non-string)
  const safeText = typeof text === 'string' ? text : String(text ?? '');
  const segments = useMemo(() => splitDynamicBlocks(safeText), [safeText]);
  const mdComponents = useMemo(() => buildMdComponents({ onFileClick }), [onFileClick]);

  return (
    <>
      {segments.map((seg, i) => (
        <RichSegment key={i} seg={seg} mdComponents={mdComponents} />
      ))}
    </>
  );
}

function RichSegment({ seg, mdComponents }: { seg: DynamicBlock; mdComponents: Record<string, any> }) {
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
  // Future phases: datatable, html-sandbox, timeline, map
  return <BlockFallback raw={seg.raw} error={`${seg.type} renderer not yet available`} />;
}

export { BlockSkeleton };
