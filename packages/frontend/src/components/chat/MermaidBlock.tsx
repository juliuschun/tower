import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import mermaid from 'mermaid';
import { useSettingsStore } from '../../stores/settings-store';

let currentTheme: string | null = null;

/**
 * Tower Mermaid Theme — Linear-inspired minimalism
 *
 * 원칙 (한 비전, 전 다이어그램 공유):
 *   1. 3색 팔레트 — bg / fg / accent 1개. 끝.
 *      (crit 빨강만 간트 critical task에 예외)
 *   2. 아웃라인 우선 — 노드는 투명에 가까운 액센트 틴트 + 테두리가 주인공
 *   3. 시퀀스만 예외 — inverse-actor (fg 배경 + bg 글씨)로 시각적 포인트
 *   4. 파이/마인드맵 "무지개 금지" — 단일 accent의 명도 단계만 사용
 *   5. Pretendard 500 + letter-spacing -0.01em (타이포그래피가 주인공)
 *
 * 참고 미감: Linear / Stripe docs / Vercel docs
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

/** Linear-inspired: bg + fg + 1 accent. That's it. */
function buildMermaidTheme(mode: 'dark' | 'light') {
  const p = mode === 'dark'
    ? {
        bg:     '#0a0f1e',  // 채팅 배경보다 살짝 깊은 다크
        fg:     '#e2e8f0',  // 거의 흰색, 살짝 쿨
        accent: '#60a5fa',  // blue-400 — Tower 브랜드
        crit:   '#f87171',  // red-400 — gantt critical만
      }
    : {
        bg:     '#ffffff',
        fg:     '#0f172a',
        accent: '#2563eb',  // blue-600
        crit:   '#dc2626',  // red-600
      };

  const { bg, fg, accent, crit } = p;

  // 파생 — 모두 accent 또는 fg 한쪽으로만 밀기
  const nodeFill    = mix(bg, accent, 0.94);  // 아주 옅은 액센트 틴트
  const nodeFill2   = mix(bg, accent, 0.90);
  const nodeFill3   = mix(bg, accent, 0.86);
  const nodeStroke  = mix(bg, accent, 0.45);  // 중간 강도 블루 (테두리 주인공)
  const subtle      = mix(bg, fg, 0.82);      // 클러스터 테두리 — 거의 안 보일 정도
  const muted       = mix(bg, fg, 0.60);      // 중간 회색 (sequence 보조)
  const edge        = mix(bg, fg, 0.70);      // 엣지 — 뚜렷하지만 조용하게

  return {
    theme: 'base' as const,
    themeVariables: {
      // ── Core ──
      primaryColor: nodeFill,
      primaryBorderColor: nodeStroke,
      primaryTextColor: fg,
      secondaryColor: nodeFill2,
      secondaryBorderColor: nodeStroke,
      secondaryTextColor: fg,
      tertiaryColor: nodeFill3,
      tertiaryBorderColor: nodeStroke,
      tertiaryTextColor: fg,

      // ── Flowchart / general ──
      // background는 실제 bg로 (ER attribute 파생 계산 안정화, CSS에서 시각적 투명 처리)
      background: bg,
      mainBkg: nodeFill,
      nodeBorder: nodeStroke,
      nodeTextColor: fg,
      clusterBkg: bg,          // cluster는 CSS에서 완전 투명 + dashed outline
      clusterBorder: subtle,
      defaultLinkColor: edge,
      lineColor: edge,
      edgeLabelBackground: bg,
      titleColor: fg,
      textColor: fg,
      labelColor: fg,
      altBackground: bg,

      // ── Sequence — inverse-actor (유일한 시각적 포인트) ──
      actorBkg: fg,
      actorBorder: fg,
      actorTextColor: bg,
      actorLineColor: muted,
      signalColor: fg,
      signalTextColor: fg,
      labelBoxBkgColor: bg,    // alt/opt/loop — 투명하게 CSS에서 처리
      labelBoxBorderColor: muted,
      labelTextColor: fg,
      loopTextColor: fg,
      noteBkgColor: bg,        // note — 투명 + 뉴트럴 테두리만
      noteTextColor: fg,
      noteBorderColor: muted,

      // ── ER — 행 배경 통일 (교차 컬러 없음) ──
      // 최신 mermaid는 rowOdd/rowEven 토큰을 사용. 구 attributeBackgroundColor* 도 호환용으로 유지.
      rowOdd: bg,
      rowEven: bg,
      attributeBackgroundColorOdd: bg,
      attributeBackgroundColorEven: bg,

      // ── Gantt — accent 1색 + opacity 단계 (crit만 빨강) ──
      sectionBkgColor: mix(bg, fg, 0.96),   // 섹션 배경 살짝 가시
      altSectionBkgColor: bg,
      sectionBkgColor2: mix(bg, fg, 0.96),
      taskBkgColor: mix(bg, accent, 0.70),  // pending — 더 진한 액센트 틴트
      taskBorderColor: accent,
      doneTaskBkgColor: mix(bg, fg, 0.85),  // done — 살짝 대비 있는 회색
      doneTaskBorderColor: mix(bg, fg, 0.65),
      activeTaskBkgColor: accent,           // active — 풀 액센트
      activeTaskBorderColor: accent,
      critBkgColor: mix(bg, crit, 0.80),    // crit — 유일 예외
      critBorderColor: crit,
      gridColor: mix(bg, fg, 0.88),
      todayLineColor: mix(bg, fg, 0.50),    // today 선 — 뉴트럴 중간 회색 (빨강 금지)
      taskTextColor: fg,
      taskTextLightColor: fg,
      taskTextDarkColor: bg,
      taskTextOutsideColor: fg,

      // ── Pie — 단일 accent의 명도 단계 + 뉴트럴 보조 (무지개 금지) ──
      pie1: accent,                         // 100% accent
      pie2: mix(bg, accent, 0.40),          // 60%
      pie3: mix(bg, accent, 0.60),          // 40%
      pie4: mix(bg, accent, 0.78),          // 22%
      pie5: mix(bg, fg, 0.55),              // 중립 회색 시작
      pie6: mix(bg, fg, 0.70),
      pie7: mix(bg, fg, 0.82),
      pie8: mix(bg, fg, 0.90),
      pie9: accent,                         // 반복
      pie10: mix(bg, accent, 0.60),
      pie11: mix(bg, fg, 0.70),
      pie12: mix(bg, fg, 0.88),
      pieStrokeColor: bg,                   // 슬라이스 사이 = bg 동색 → 갭
      pieStrokeWidth: '2px',
      pieOuterStrokeWidth: '0px',           // outer ring 제거
      pieOpacity: '1',
      pieSectionTextColor: mode === 'dark' ? bg : fg,  // accent 배경 위 대비
      pieSectionTextSize: '13px',
      pieTitleTextColor: fg,
      pieTitleTextSize: '16px',
      pieLegendTextColor: fg,
      pieLegendTextSize: '12px',

      // ── Mindmap — 루트만 accent, 가지는 전부 뉴트럴 ──
      cScale0: accent,                      // 루트 = 유일한 포인트
      cScale1: mix(bg, fg, 0.78),
      cScale2: mix(bg, fg, 0.84),
      cScale3: mix(bg, fg, 0.90),
      cScale4: mix(bg, fg, 0.93),
      cScale5: mix(bg, fg, 0.78),
      cScale6: mix(bg, fg, 0.84),
      cScale7: mix(bg, fg, 0.90),
      cScale8: mix(bg, fg, 0.93),
      cScale9: mix(bg, fg, 0.84),
      cScale10: mix(bg, fg, 0.90),
      cScale11: mix(bg, fg, 0.93),
      cScalePeer0: accent,
      cScalePeer1: muted,
      cScalePeer2: muted,
      cScalePeer3: muted,
      cScalePeer4: muted,
      cScalePeer5: muted,
      cScalePeer6: muted,
      cScalePeer7: muted,
      cScaleLabel0: mode === 'dark' ? bg : '#ffffff',  // 루트는 흰/검 텍스트
      cScaleLabel1: fg, cScaleLabel2: fg, cScaleLabel3: fg,
      cScaleLabel4: fg, cScaleLabel5: fg, cScaleLabel6: fg, cScaleLabel7: fg,

      // ── Typography ──
      fontFamily: '"Pretendard Variable", Pretendard, Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: '14px',
    },
    flowchart: {
      padding: 24,
      nodeSpacing: 54,
      rankSpacing: 68,
      htmlLabels: true,
      wrappingWidth: 220,
      curve: 'basis' as const,
    },
    sequence: {
      boxMargin: 14,
      noteMargin: 14,
      messageMargin: 42,
    },
    gantt: {
      barHeight: 28,           // 18 → 28 — 읽기 편한 높이
      barGap: 8,               // 4 → 8 — 행 사이 숨쉴 여백
      topPadding: 60,
      leftPadding: 90,
      sidePadding: 40,
      fontSize: 13,            // 12 → 13
      sectionFontSize: 14,     // 13 → 14
      gridLineStartPadding: 35,
      titleTopMargin: 24,
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
        // 폰트 로딩 대기 — mermaid는 측정(DOM)과 렌더(SVG) 시점의 폰트가 다르면 노드 폭을 잘못 계산해 텍스트가 박스 밖으로 튀어나감.
        // Pretendard가 늦게 로드되면 시스템 fallback으로 측정 → Pretendard로 렌더 → 오버플로 발생.
        // 이미 로드됐으면 즉시 resolved 프로미스라 비용 없음.
        if (typeof document !== 'undefined' && 'fonts' in document) {
          await document.fonts.ready;
        }
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
