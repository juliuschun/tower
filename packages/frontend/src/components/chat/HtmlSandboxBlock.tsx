import { useMemo, useRef, useState, useEffect } from 'react';

interface Props {
  raw: string;
  fallbackCode: string;
}

interface ParsedInput {
  html: string;
  /** Explicit fixed iframe height in px. Overrides aspect/auto. */
  height?: number;
  /** Override the default max clamp (default 600 collapsed / 1200 expanded). */
  maxHeight?: number;
  /** Width-to-height ratio. Height = containerWidth / aspect. */
  aspect?: number;
}

const DEFAULT_MAX = 600;
const EXPANDED_MAX = 1200;
const MIN_H = 100;
const BODY_MARGIN = 24; // matches the 12px body margin × 2

/**
 * Parse raw input. Supports three input shapes:
 *   1. JSON: { html: "...", height?, maxHeight?, aspect? }
 *   2. Raw SVG starting with <svg ... viewBox="..."> → aspect auto-detected
 *   3. Any other raw HTML fragment → measured by body.scrollHeight
 */
function parseInput(raw: string): ParsedInput {
  const trimmed = raw.trim();

  // JSON mode — only treat as JSON if it parses AND has an `html` string field.
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && typeof parsed.html === 'string') {
        return {
          html: parsed.html,
          height: typeof parsed.height === 'number' ? parsed.height : undefined,
          maxHeight: typeof parsed.maxHeight === 'number' ? parsed.maxHeight : undefined,
          aspect: typeof parsed.aspect === 'number' && parsed.aspect > 0 ? parsed.aspect : undefined,
        };
      }
    } catch {
      /* not JSON — fall through to raw HTML path */
    }
  }

  // Auto-detect SVG aspect-ratio from root <svg viewBox="min-x min-y w h">
  if (trimmed.startsWith('<svg')) {
    const m = trimmed.match(/<svg[^>]*\bviewBox\s*=\s*["']([^"']+)["']/i);
    if (m) {
      const parts = m[1].trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        return { html: raw, aspect: parts[2] / parts[3] };
      }
    }
  }

  return { html: raw };
}

export default function HtmlSandboxBlock({ raw, fallbackCode: _fallbackCode }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const [expanded, setExpanded] = useState(false);

  const { html, height: fixedH, maxHeight: customMax, aspect } = useMemo(() => parseInput(raw), [raw]);

  const srcDoc = useMemo(() => {
    // Wrap in minimal HTML if no <html> tag
    if (html.trim().startsWith('<!') || html.trim().startsWith('<html')) return html;
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { margin: 12px; font-family: system-ui, sans-serif; color: #e0e0e0; background: transparent; }
  * { box-sizing: border-box; }
  svg { display: block; max-width: 100%; height: auto; }
</style></head><body>${html}</body></html>`;
  }, [html]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const maxH = customMax ?? (expanded ? EXPANDED_MAX : DEFAULT_MAX);

    const compute = () => {
      let h: number;

      if (fixedH !== undefined) {
        // Explicit height → use verbatim
        h = fixedH;
      } else if (aspect !== undefined) {
        // Aspect-ratio mode: height = width / aspect + body margin
        const w = iframe.clientWidth || 600;
        h = w / aspect + BODY_MARGIN;
      } else {
        // Measure actual content
        try {
          const body = iframe.contentDocument?.body;
          h = body ? body.scrollHeight + BODY_MARGIN : 200;
        } catch {
          return; // cross-origin, keep default
        }
      }

      setHeight(Math.min(Math.max(h, MIN_H), maxH));
    };

    const handleLoad = () => compute();
    iframe.addEventListener('load', handleLoad);

    // For aspect/fixed modes we can compute before the iframe fires `load`.
    if (aspect !== undefined || fixedH !== undefined) {
      compute();
    }

    // Width changes re-trigger aspect-ratio computation
    const ro = aspect !== undefined && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => compute())
      : null;
    if (ro) ro.observe(iframe);

    return () => {
      iframe.removeEventListener('load', handleLoad);
      ro?.disconnect();
    };
  }, [expanded, fixedH, customMax, aspect]);

  return (
    <div className="my-3 rounded-lg border border-surface-700/40 bg-surface-900/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-800/40 border-b border-surface-700/30">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">HTML Sandbox</span>
        <div className="flex gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] px-2 py-0.5 rounded bg-surface-700/40 hover:bg-surface-700/60 text-gray-400 hover:text-gray-200 transition-colors"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
          <button
            onClick={() => {
              const w = window.open('', '_blank');
              if (w) { w.document.write(srcDoc); w.document.close(); }
            }}
            className="text-[10px] px-2 py-0.5 rounded bg-surface-700/40 hover:bg-surface-700/60 text-gray-400 hover:text-gray-200 transition-colors"
          >
            Open
          </button>
        </div>
      </div>
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        style={{ width: '100%', height, border: 'none', background: 'transparent' }}
        title="HTML Sandbox"
      />
    </div>
  );
}
