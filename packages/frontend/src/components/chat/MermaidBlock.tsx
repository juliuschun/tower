import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import mermaid from 'mermaid';
import { useSettingsStore } from '../../stores/settings-store';

let currentTheme: string | null = null;

/**
 * Theme-aware color palettes for Mermaid diagrams.
 * - Dark modes: soft pastel backgrounds + dark text → readable on dark surfaces
 * - Light mode: standard Mermaid defaults (already fine)
 */
const darkThemeVariables = {
  // Node colors — soft pastels that stay readable with dark text
  primaryColor: '#dbeafe',        // blue-100 — main nodes
  primaryTextColor: '#1e293b',    // slate-800
  primaryBorderColor: '#93c5fd',  // blue-300
  secondaryColor: '#ede9fe',      // violet-100 — alt nodes
  secondaryTextColor: '#1e293b',
  secondaryBorderColor: '#c4b5fd',// violet-300
  tertiaryColor: '#d1fae5',       // emerald-100 — tertiary
  tertiaryTextColor: '#1e293b',
  tertiaryBorderColor: '#6ee7b7', // emerald-300

  // Lines & labels
  lineColor: '#94a3b8',           // slate-400
  textColor: '#e2e8f0',           // slate-200 — general text (outside nodes)

  // Background — transparent so it inherits chat bubble bg
  background: 'transparent',
  mainBkg: '#dbeafe',
  nodeBorder: '#93c5fd',
  nodeTextColor: '#1e293b',

  // Flowchart specifics
  clusterBkg: '#1e293b',          // slate-800
  clusterBorder: '#475569',       // slate-600
  defaultLinkColor: '#94a3b8',
  titleColor: '#e2e8f0',
  edgeLabelBackground: '#1e293b',

  // Sequence diagram
  actorBkg: '#dbeafe',
  actorTextColor: '#1e293b',
  actorBorder: '#93c5fd',
  actorLineColor: '#94a3b8',
  signalColor: '#e2e8f0',
  signalTextColor: '#e2e8f0',
  labelBoxBkgColor: '#1e293b',
  labelBoxBorderColor: '#475569',
  labelTextColor: '#e2e8f0',
  loopTextColor: '#e2e8f0',
  noteBkgColor: '#fef3c7',        // amber-100
  noteTextColor: '#1e293b',
  noteBorderColor: '#fcd34d',     // amber-300

  // State / class diagrams
  labelColor: '#e2e8f0',
  altBackground: '#334155',       // slate-700
};

function ensureInit(theme: string) {
  const mermaidTheme = theme !== 'light' ? 'dark' : 'default';
  if (currentTheme !== mermaidTheme) {
    mermaid.initialize({
      startOnLoad: false,
      theme: mermaidTheme,
      securityLevel: 'loose',
      fontFamily: 'inherit',
      ...(mermaidTheme === 'dark' ? { themeVariables: darkThemeVariables } : {}),
      flowchart: { padding: 24, nodeSpacing: 40, rankSpacing: 50, htmlLabels: true, wrappingWidth: 200 },
      sequence: { boxMargin: 10, noteMargin: 12 },
    });
    currentTheme = mermaidTheme;
  }
}

/** djb2 hash — stable ID for mermaid render targets */
function hashCode(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Post-process SVG: set width=100%, preserve viewBox, prevent text clipping */
function patchSvgForFullWidth(svg: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return svg;

  // Ensure viewBox exists (use width/height as fallback)
  if (!svgEl.getAttribute('viewBox')) {
    const w = parseFloat(svgEl.getAttribute('width') || '800');
    const h = parseFloat(svgEl.getAttribute('height') || '600');
    svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }

  // Expand viewBox slightly for padding (prevents edge clipping)
  const vb = svgEl.getAttribute('viewBox')!.split(' ').map(Number);
  const pad = 16;
  svgEl.setAttribute('viewBox', `${vb[0] - pad} ${vb[1] - pad} ${vb[2] + pad * 2} ${vb[3] + pad * 2}`);

  // Set responsive sizing
  svgEl.setAttribute('width', '100%');
  svgEl.removeAttribute('height');

  // Add overflow visible to prevent text clipping in nodes
  svgEl.style.overflow = 'visible';

  return new XMLSerializer().serializeToString(svgEl);
}

function downloadSvg(svg: string) {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'diagram.svg';
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadJpg(svgContent: string, theme?: string) {
  // Parse to get real dimensions from viewBox / width / height
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, 'image/svg+xml');
  const svgEl = doc.querySelector('svg')!;

  let width = parseFloat(svgEl.getAttribute('width') || '0');
  let height = parseFloat(svgEl.getAttribute('height') || '0');
  const viewBox = svgEl.getAttribute('viewBox');
  if ((!width || !height) && viewBox) {
    const [, , vw, vh] = viewBox.split(' ').map(Number);
    width = vw || 800;
    height = vh || 600;
  }
  width = width || 800;
  height = height || 600;
  svgEl.setAttribute('width', String(width));
  svgEl.setAttribute('height', String(height));

  const blob = new Blob([new XMLSerializer().serializeToString(svgEl)], {
    type: 'image/svg+xml;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.src = url;
  await new Promise<void>((resolve) => { img.onload = () => resolve(); });

  const scale = 2; // 2× for crisp JPG
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = theme === 'light' ? '#ffffff' : '#1e1e2e';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);

  canvas.toBlob((b) => {
    if (!b) return;
    const jpgUrl = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = jpgUrl;
    a.download = 'diagram.jpg';
    a.click();
    URL.revokeObjectURL(jpgUrl);
  }, 'image/jpeg', 0.95);
}

/* ── Zoomable Lightbox ── */

function MermaidLightbox({ svgContent, onClose }: { svgContent: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const posAtDragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const clampScale = (s: number) => Math.min(Math.max(s, 0.25), 5);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Zoom toward cursor position
    const cursorX = e.clientX - rect.left - rect.width / 2;
    const cursorY = e.clientY - rect.top - rect.height / 2;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = clampScale(scale * factor);
    const ratio = 1 - newScale / scale;

    setScale(newScale);
    setPos(p => ({ x: p.x + (cursorX - p.x) * ratio, y: p.y + (cursorY - p.y) * ratio }));
  }, [scale]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    posAtDragStart.current = { ...pos };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    setPos({
      x: posAtDragStart.current.x + (e.clientX - dragStart.current.x),
      y: posAtDragStart.current.y + (e.clientY - dragStart.current.y),
    });
  }, []);

  const handlePointerUp = useCallback(() => { dragging.current = false; }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cursorX = e.clientX - rect.left - rect.width / 2;
    const cursorY = e.clientY - rect.top - rect.height / 2;
    const newScale = clampScale(scale * 1.8);
    const ratio = 1 - newScale / scale;
    setScale(newScale);
    setPos(p => ({ x: p.x + (cursorX - p.x) * ratio, y: p.y + (cursorY - p.y) * ratio }));
  }, [scale]);

  const resetView = useCallback(() => { setScale(1); setPos({ x: 0, y: 0 }); }, []);

  const btnClass = "p-1.5 rounded-md bg-surface-800/90 border border-surface-700/50 text-gray-400 hover:text-gray-200 hover:bg-surface-700/80 transition-all";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-[96vw] h-[90vh] md:w-[90vw] md:h-[88vh] bg-surface-900 rounded-xl border border-surface-700/50 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Top toolbar */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
          <button onClick={() => setScale(s => clampScale(s * 1.3))} className={btnClass} title="Zoom in">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
            </svg>
          </button>
          <span className="text-[11px] text-gray-500 tabular-nums min-w-[3.5rem] text-center select-none">
            {Math.round(scale * 100)}%
          </span>
          <button onClick={() => setScale(s => clampScale(s / 1.3))} className={btnClass} title="Zoom out">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM7 10h6" />
            </svg>
          </button>
          <button onClick={resetView} className={btnClass} title="Reset zoom">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <div className="w-px h-5 bg-surface-700/50 mx-0.5" />
          <button onClick={onClose} className={btnClass} title="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Zoom hint */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 text-[11px] text-gray-600 select-none pointer-events-none">
          Scroll: zoom · Drag: pan · Double-click: zoom in
        </div>

        {/* Pannable + zoomable area */}
        <div
          ref={containerRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          style={{ touchAction: 'none' }}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        >
          <div
            className="w-full h-full flex items-center justify-center [&_svg]:overflow-visible"
            style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, transformOrigin: 'center center', transition: dragging.current ? 'none' : 'transform 0.1s ease-out' }}
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface MermaidBlockProps {
  code: string;
}

export const MermaidBlock = React.memo(function MermaidBlock({ code }: MermaidBlockProps) {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const theme = useSettingsStore((s) => s.theme);
  const idRef = useRef(`mermaid-${hashCode(code)}-${Date.now()}`);
  const rawSvgRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Generate a fresh ID for each render to avoid mermaid ID conflicts
    const renderId = `mermaid-${hashCode(code)}-${Date.now()}`;
    idRef.current = renderId;

    async function render() {
      ensureInit(theme);
      try {
        const { svg } = await mermaid.render(idRef.current, code);
        if (!cancelled) {
          rawSvgRef.current = svg; // Keep original for downloads
          const processed = patchSvgForFullWidth(svg);
          setSvgContent(processed);
          if (error !== null) setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? (e.message || 'Render failed') : (String(e) || 'Mermaid render error');
          console.error('[Mermaid] render error:', msg, e);
          setError(msg);
          document.getElementById('d' + idRef.current)?.remove();
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [code, theme]);

  const handleDownloadSvg = useCallback(() => {
    const raw = rawSvgRef.current;
    if (raw) downloadSvg(raw);
  }, []);

  const handleDownloadJpg = useCallback(() => {
    const raw = rawSvgRef.current;
    if (raw) downloadJpg(raw, theme);
  }, [theme]);

  if (error) {
    return (
      <pre className="bg-surface-900/60 border border-surface-700/40 rounded-lg p-4 overflow-x-auto text-sm">
        <code className="text-xs text-red-400 block mb-2">⚠ {error}</code>
        <code>{code}</code>
      </pre>
    );
  }

  if (!svgContent) {
    return (
      <div className="my-2 rounded-lg border border-surface-700/40 bg-surface-900/60 p-4 min-h-[120px] flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Rendering diagram…
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="my-2 relative group/mermaid">
        {/* Toolbar — hover on desktop, always visible on touch */}
        <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover/mermaid:opacity-100 transition-opacity">
          <button
            onClick={() => setExpanded(true)}
            className="p-1.5 rounded-md bg-surface-800/90 border border-surface-700/50 text-gray-400 hover:text-gray-200 hover:bg-surface-700/80 transition-all"
            title="Expand"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
          <button
            onClick={handleDownloadSvg}
            className="p-1.5 rounded-md bg-surface-800/90 border border-surface-700/50 text-gray-400 hover:text-gray-200 hover:bg-surface-700/80 transition-all"
            title="Download SVG"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="sr-only">SVG</span>
          </button>
          <button
            onClick={handleDownloadJpg}
            className="p-1.5 rounded-md bg-surface-800/90 border border-surface-700/50 text-gray-400 hover:text-gray-200 hover:bg-surface-700/80 transition-all"
            title="Download JPG"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="sr-only">JPG</span>
          </button>
        </div>

        {/* Diagram — full width, horizontal scroll on mobile, fade-in on first render */}
        <div
          className="w-full overflow-x-auto [&_svg]:max-w-none [&_svg]:overflow-visible"
          style={{ animation: 'fade-in-block 0.3s ease-out' }}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </div>

      {/* Zoomable Lightbox */}
      {expanded && <MermaidLightbox svgContent={svgContent} onClose={() => setExpanded(false)} />}
    </>
  );
});
