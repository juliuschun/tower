import { useMemo, useRef, useState, useEffect } from 'react';

interface Props {
  raw: string;
  fallbackCode: string;
}

export default function HtmlSandboxBlock({ raw, fallbackCode }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const [expanded, setExpanded] = useState(false);

  // raw is the HTML content directly (not JSON)
  const srcDoc = useMemo(() => {
    // Wrap in minimal HTML if no <html> tag
    if (raw.trim().startsWith('<!') || raw.trim().startsWith('<html')) return raw;
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { margin: 12px; font-family: system-ui, sans-serif; color: #e0e0e0; background: transparent; }
  * { box-sizing: border-box; }
</style></head><body>${raw}</body></html>`;
  }, [raw]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const handleLoad = () => {
      try {
        const body = iframe.contentDocument?.body;
        if (body) {
          const h = body.scrollHeight;
          setHeight(Math.min(Math.max(h + 24, 100), expanded ? 800 : 400));
        }
      } catch { /* cross-origin, keep default */ }
    };
    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [expanded]);

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
