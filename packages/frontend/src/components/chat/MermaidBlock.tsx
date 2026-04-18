import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import mermaid from 'mermaid';
import { useSettingsStore } from '../../stores/settings-store';

let currentTheme: string | null = null;

/**
 * Tower Mermaid Theme — beautiful-mermaid 원칙 이식 (절제의 미학)
 *
 * 핵심:
 *   1. 2-color API — bg + fg + accent 3개로 전체 팔레트 자동 유도
 *   2. theme: 'base' — themeVariables 완전 제어
 *   3. 그림자/그라디언트/과한 효과 ❌  (색상 조화 + 선 굵기만)
 *   4. Pretendard + 정교한 spacing
 *
 * 참고: github.com/lukilabs/beautiful-mermaid (Craft.do)
 */

/** hex 두 색을 혼합. bgWeight 1.0 = 전부 bg, 0.0 = 전부 fg */
function mix(bg: string, fg: string, bgWeight: number): string {
  const parse = (hex: string): [number, number, number] => {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  };
  const [br, bgG, bb] = parse(bg);
  const [fr, fgG, fb] = parse(fg);
  const blend = (a: number, b: number) =>
    Math.round(a * bgWeight + b * (1 - bgWeight));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return '#' + toHex(blend(br, fr)) + toHex(blend(bgG, fgG)) + toHex(blend(bb, fb));
}

/** 2-color API → 완성된 mermaid 설정 */
function buildMermaidTheme(mode: 'dark' | 'light') {
  const palette = mode === 'dark'
    ? {
        bg: '#0f172a', fg: '#e2e8f0', accent: '#60a5fa',
        // 8색 순환 팔레트 — Tailwind 400 시리즈 (동일 채도·명도)
        // blue, violet, emerald, amber, rose, cyan, pink, lime
        accents: [
          '#60a5fa', '#a78bfa', '#34d399', '#fbbf24',
          '#fb7185', '#22d3ee', '#f472b6', '#a3e635',
        ],
        crit: '#fb7185', // rose-400 for critical gantt tasks
      }
    : {
        bg: '#ffffff', fg: '#1e293b', accent: '#2563eb',
        // Tailwind 600 시리즈 (흰 배경에서 대비 ↑)
        accents: [
          '#2563eb', '#7c3aed', '#059669', '#d97706',
          '#e11d48', '#0891b2', '#db2777', '#65a30d',
        ],
        crit: '#e11d48', // rose-600
      };

  const { bg, fg, accent, accents, crit } = palette;

  // 파생 토큰 — color-mix 대신 JS hex interpolation (mermaid는 hex를 선호)
  const surface   = mix(bg, fg, 0.88); // 노드 채우기
  const surface2  = mix(bg, fg, 0.82); // 보조 노드
  const surface3  = mix(bg, fg, 0.78); // 3차 노드
  const cluster   = mix(bg, fg, 0.94); // 클러스터 배경
  const clusterBr = mix(bg, fg, 0.70); // 클러스터 테두리
  const line      = mix(bg, fg, 0.55); // 기본 선

  return {
    theme: 'base' as const,
    themeVariables: {
      // Core
      primaryColor: surface,
      primaryBorderColor: accent,
      primaryTextColor: fg,
      secondaryColor: surface2,
      secondaryBorderColor: mix(bg, fg, 0.68),
      secondaryTextColor: fg,
      tertiaryColor: surface3,
      tertiaryBorderColor: mix(bg, fg, 0.62),
      tertiaryTextColor: fg,

      // Flowchart / general
      // background는 실제 bg 색을 주입해야 mermaid의 파생 계산(attribute 행 배경 등)이 정상 동작
      // 'transparent'로 두면 ER diagram attribute 배경이 흰색 fallback으로 터짐
      // 실제 SVG 바깥 배경 투명 처리는 mermaid-wrapper CSS에서 담당
      background: bg,
      mainBkg: surface,
      nodeBorder: accent,
      nodeTextColor: fg,
      clusterBkg: cluster,
      clusterBorder: clusterBr,
      defaultLinkColor: line,
      lineColor: line,
      edgeLabelBackground: bg,
      titleColor: fg,
      textColor: fg,
      labelColor: fg,
      altBackground: cluster,

      // Sequence — beautiful-mermaid "inverse actor" 시그니처
      // actor 박스는 역방향 대비: 다크모드에선 흰 박스 + 검은 글씨 / 라이트에선 반대
      actorBkg: fg,
      actorBorder: fg,
      actorTextColor: bg,
      actorLineColor: mix(bg, fg, 0.45), // lifeline — dashed로 CSS에서 처리
      signalColor: fg,
      signalTextColor: fg,
      // alt/opt/loop label — subtle 서피스
      labelBoxBkgColor: cluster,
      labelBoxBorderColor: mix(bg, fg, 0.55),
      labelTextColor: fg,
      loopTextColor: fg,
      // note — 노란색 제거, 모노톤
      noteBkgColor: cluster,
      noteTextColor: fg,
      noteBorderColor: mix(bg, fg, 0.55),

      // ER diagram — 기본값이 밝은 배경이라 다크 모드에서 텍스트 안 보이는 문제 해결
      attributeBackgroundColorOdd: surface,
      attributeBackgroundColorEven: surface2,

      // Gantt — 단정한 팔레트 (과한 채도 금지, 섹션별 톤 다르게)
      // 섹션 행 배경 — 교차, 거의 안 보일 정도로 subtle
      sectionBkgColor: mix(bg, fg, 0.97),
      altSectionBkgColor: bg,
      sectionBkgColor2: mix(bg, fg, 0.97),
      // 태스크 바 — 기본(pending): accent 40% 틴트
      taskBkgColor: mix(bg, accent, 0.55),
      taskBorderColor: accent,
      // 완료 태스크: 가장 조용하게 — 회색 톤
      doneTaskBkgColor: mix(bg, fg, 0.85),
      doneTaskBorderColor: mix(bg, fg, 0.65),
      // 진행 중: accent 풀 강도
      activeTaskBkgColor: accent,
      activeTaskBorderColor: accent,
      // 크리티컬: rose 계열 — 눈에 띄되 과하지 않게
      critBkgColor: mix(bg, crit, 0.55),
      critBorderColor: crit,
      // 그리드·텍스트 (titleColor는 Flowchart 섹션에서 이미 선언됨)
      gridColor: mix(bg, fg, 0.85),
      taskTextColor: fg,
      taskTextLightColor: fg,
      taskTextDarkColor: bg,
      taskTextOutsideColor: fg,

      // Pie — 8색 팔레트 + 얇은 bg 갭 (현대적 donut 스타일)
      pie1: accents[0],
      pie2: accents[1],
      pie3: accents[2],
      pie4: accents[3],
      pie5: accents[4],
      pie6: accents[5],
      pie7: accents[6],
      pie8: accents[7],
      pie9: mix(bg, accents[0], 0.5),
      pie10: mix(bg, accents[1], 0.5),
      pie11: mix(bg, accents[2], 0.5),
      pie12: mix(bg, accents[3], 0.5),
      pieStrokeColor: bg, // 슬라이스 사이 = bg 동색 → 갭 효과
      pieStrokeWidth: '2px',
      pieOuterStrokeColor: mix(bg, fg, 0.7),
      pieOuterStrokeWidth: '1px',
      pieOpacity: '0.95',
      pieSectionTextColor: fg,
      pieSectionTextSize: '13px',
      pieTitleTextColor: fg,
      pieTitleTextSize: '16px',
      pieLegendTextColor: fg,
      pieLegendTextSize: '12px',

      // Mindmap — 각 계층이 서로 다른 accent 사용
      // cScale0-11: 각 레벨 배경 (tinted, fg 텍스트가 읽히게)
      cScale0: mix(bg, accents[0], 0.72),
      cScale1: mix(bg, accents[1], 0.72),
      cScale2: mix(bg, accents[2], 0.72),
      cScale3: mix(bg, accents[3], 0.72),
      cScale4: mix(bg, accents[4], 0.72),
      cScale5: mix(bg, accents[5], 0.72),
      cScale6: mix(bg, accents[6], 0.72),
      cScale7: mix(bg, accents[7], 0.72),
      cScale8: mix(bg, accents[0], 0.58),
      cScale9: mix(bg, accents[1], 0.58),
      cScale10: mix(bg, accents[2], 0.58),
      cScale11: mix(bg, accents[3], 0.58),
      // cScalePeer*: 해당 계층의 강조 border 색
      cScalePeer0: accents[0],
      cScalePeer1: accents[1],
      cScalePeer2: accents[2],
      cScalePeer3: accents[3],
      cScalePeer4: accents[4],
      cScalePeer5: accents[5],
      cScalePeer6: accents[6],
      cScalePeer7: accents[7],
      // Mindmap 텍스트 — 틴트 위에서도 가독성 확보
      cScaleLabel0: fg, cScaleLabel1: fg, cScaleLabel2: fg, cScaleLabel3: fg,
      cScaleLabel4: fg, cScaleLabel5: fg, cScaleLabel6: fg, cScaleLabel7: fg,

      // Typography
      fontFamily: '"Pretendard Variable", Pretendard, Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: '14px',
    },
    flowchart: {
      padding: 20,
      nodeSpacing: 48,
      rankSpacing: 64,
      htmlLabels: true,
      wrappingWidth: 200,
      curve: 'basis' as const,
    },
    sequence: {
      boxMargin: 12,
      noteMargin: 14,
      messageMargin: 40,
    },
    gantt: {
      // 단정한 비율 — 바 얇게, 간격 여유롭게
      barHeight: 18,
      barGap: 4,
      topPadding: 50,
      leftPadding: 80,
      sidePadding: 40,
      fontSize: 12,
      sectionFontSize: 13,
      gridLineStartPadding: 35,
      titleTopMargin: 20,
      numberSectionStyles: 4,
    },
    pie: {
      textPosition: 0.6,
    },
  };
}

function ensureInit(theme: string) {
  const mode: 'dark' | 'light' = theme !== 'light' ? 'dark' : 'light';
  if (currentTheme !== mode) {
    const config = buildMermaidTheme(mode);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      ...config,
    });
    currentTheme = mode;
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
            className="mermaid-wrapper w-full h-full flex items-center justify-center [&_svg]:overflow-visible"
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
          className="mermaid-wrapper w-full overflow-x-auto [&_svg]:max-w-none [&_svg]:overflow-visible"
          style={{ animation: 'fade-in-block 0.3s ease-out' }}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </div>

      {/* Zoomable Lightbox */}
      {expanded && <MermaidLightbox svgContent={svgContent} onClose={() => setExpanded(false)} />}
    </>
  );
});
