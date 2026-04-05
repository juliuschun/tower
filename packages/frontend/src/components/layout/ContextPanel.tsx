import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import { useFileStore } from '../../stores/file-store';
import { CodeEditor } from '../editor/CodeEditor';
import { MermaidBlock } from '../chat/MermaidBlock';
import { TabBar } from '../files/TabBar';

// Lazy-loaded Office preview components
const DocxPreview = React.lazy(() => import('../files/DocxPreview').then(m => ({ default: m.DocxPreview })));
const XlsxPreview = React.lazy(() => import('../files/XlsxPreview').then(m => ({ default: m.XlsxPreview })));
const PptxPreview = React.lazy(() => import('../files/PptxPreview').then(m => ({ default: m.PptxPreview })));
const OFFICE_FORMATS = new Set(['docx', 'xlsx', 'pptx']);

function HtmlPreview({ content }: { content: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [content]);

  if (!blobUrl) return null;
  return (
    <div className="absolute inset-0">
      <iframe
        src={blobUrl}
        className="w-full h-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin"
        title="html-preview"
      />
    </div>
  );
}

function PdfPreview({ filePath }: { filePath: string }) {
  const token = localStorage.getItem('token') || '';
  const src = `/api/files/serve?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const fileName = filePath.split('/').pop() || 'document.pdf';

  if (isMobile) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-4">
        <svg className="w-16 h-16 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        <p className="text-sm text-gray-400 text-center">{fileName}</p>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
        >
          Open PDF
        </a>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <iframe
        src={src}
        className="w-full h-full border-0 bg-white"
        title="pdf-preview"
      />
    </div>
  );
}

function ImagePreview({ filePath }: { filePath: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    const token = localStorage.getItem('token') || '';
    fetch(`/api/files/serve?path=${encodeURIComponent(filePath)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setStatus('loaded');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[ImagePreview] load failed:', filePath, err.message);
        setStatus('error');
      });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [filePath]);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-900 p-4 overflow-auto">
      {status === 'loading' && (
        <span className="absolute text-gray-500 text-sm">Loading image…</span>
      )}
      {status === 'error' && (
        <span className="text-red-400 text-sm">Failed to load image</span>
      )}
      {blobUrl && (
        <img
          src={blobUrl}
          alt={filePath.split('/').pop()}
          className="max-w-full max-h-full object-contain"
        />
      )}
    </div>
  );
}

function VideoPreview({ filePath }: { filePath: string }) {
  const token = localStorage.getItem('token') || '';
  const src = `/api/files/serve?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black">
      <video src={src} controls className="max-w-full max-h-full" />
    </div>
  );
}

// Split mermaid blocks out so rehypeRaw doesn't corrupt <br/> inside mermaid code
function MarkdownWithMermaid({ content, components }: { content: string; components: any }) {
  const segments = useMemo(() => {
    const result: { type: 'md' | 'mermaid'; text: string }[] = [];
    const regex = /```mermaid\s*\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: 'md', text: content.slice(lastIndex, match.index) });
      }
      result.push({ type: 'mermaid', text: match[1].trimEnd() });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      result.push({ type: 'md', text: content.slice(lastIndex) });
    }
    return result;
  }, [content]);

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'mermaid' ? (
          <MermaidBlock key={i} code={seg.text} />
        ) : (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeHighlight]} components={components}>
            {seg.text}
          </ReactMarkdown>
        )
      )}
    </>
  );
}

interface ContextPanelProps {
  onSave?: (path: string, content: string) => void;
  onReload?: (path: string) => void;
  onMobileClose?: () => void;
  /** When true, hides expand/collapse button (already full-screen in files view) */
  fullScreen?: boolean;
}

export function ContextPanel({ onSave, onReload, onMobileClose, fullScreen }: ContextPanelProps) {
  const openFile = useFileStore((s) => s.openFile);
  const contextPanelTab = useFileStore((s) => s.contextPanelTab);
  const setContextPanelTab = useFileStore((s) => s.setContextPanelTab);
  const updateContent = useFileStore((s) => s.updateOpenFileContent);
  const externalChange = useFileStore((s) => s.externalChange);
  const keepLocalEdits = useFileStore((s) => s.keepLocalEdits);
  const contextPanelExpanded = useFileStore((s) => s.contextPanelExpanded);
  const setContextPanelExpanded = useFileStore((s) => s.setContextPanelExpanded);
  const tabs = useFileStore((s) => s.tabs);

  useEffect(() => {
    if (openFile && ['html', 'markdown', 'pdf', 'image', 'video', 'docx', 'xlsx', 'pptx'].includes(openFile.language)) {
      setContextPanelTab('preview');
    }
  }, [openFile?.path]);

  // Keyboard shortcuts: Ctrl+W close tab, Ctrl+Tab/Ctrl+Shift+Tab switch tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const state = useFileStore.getState();
      if (state.tabs.length === 0) return;

      // Ctrl+W: close current tab
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        if (state.activeTabId) {
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (tab?.modified) {
            if (!window.confirm('저장하지 않은 변경사항이 있습니다. 닫을까요?')) return;
          }
          state.closeTab(state.activeTabId);
        }
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab: next/prev tab
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
        if (idx === -1) return;
        const nextIdx = e.shiftKey
          ? (idx - 1 + state.tabs.length) % state.tabs.length
          : (idx + 1) % state.tabs.length;
        state.setActiveTab(state.tabs[nextIdx].id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleClose = useCallback(() => {
    if (fullScreen) {
      // Files view: close the tab
      const { activeTabId, closeTab, tabs: currentTabs } = useFileStore.getState();
      if (activeTabId) {
        const tab = currentTabs.find(t => t.id === activeTabId);
        if (tab?.modified) {
          if (!window.confirm('저장하지 않은 변경사항이 있습니다. 닫을까요?')) return;
        }
        closeTab(activeTabId);
      }
    } else {
      // Side panel (chat view): just hide the panel, keep tabs alive
      useFileStore.getState().setContextPanelOpen(false);
    }
  }, [fullScreen]);

  const handleSave = useCallback(() => {
    if (openFile && onSave) {
      onSave(openFile.path, openFile.content);
    }
  }, [openFile, onSave]);

  const handleReload = useCallback(() => {
    if (openFile && onReload) {
      onReload(openFile.path);
    }
  }, [openFile, onReload]);

  // Resolve image src relative to the open file's directory
  // Must be before early return to keep hooks order stable
  const mdComponents = useMemo(() => {
    if (!openFile) return {};
    const fileDir = openFile.path.substring(0, openFile.path.lastIndexOf('/'));
    const token = localStorage.getItem('token') || '';
    return {
      img({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
        if (!src) return null;
        if (/^https?:\/\//.test(src)) {
          return <img src={src} alt={alt} {...props} style={{ maxWidth: '100%' }} />;
        }
        let resolvedPath: string;
        if (src.startsWith('/')) {
          resolvedPath = src;
        } else {
          resolvedPath = fileDir + '/' + src;
        }
        const parts = resolvedPath.split('/');
        const normalized: string[] = [];
        for (const p of parts) {
          if (p === '..') normalized.pop();
          else if (p !== '.') normalized.push(p);
        }
        resolvedPath = normalized.join('/');
        const apiUrl = `/api/files/serve?path=${encodeURIComponent(resolvedPath)}&token=${encodeURIComponent(token)}`;
        return <img src={apiUrl} alt={alt} {...props} style={{ maxWidth: '100%' }} />;
      },
    };
  }, [openFile?.path]);

  if (!openFile) {
    return (
      <div className="h-full flex flex-col bg-surface-900">
        {onMobileClose && (
          <div className="flex items-center justify-between px-4 h-12 border-b border-surface-800 shrink-0">
            <span className="text-sm font-medium text-gray-400">No file</span>
            <button onClick={onMobileClose} className="p-1.5 text-gray-400 hover:text-gray-200">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          Select a file to view it here
        </div>
      </div>
    );
  }

  const PREVIEW_ONLY = new Set(['image', 'pdf', 'video', 'docx', 'xlsx', 'pptx']);
  const PREVIEWABLE = new Set(['image', 'pdf', 'video', 'html', 'markdown', 'docx', 'xlsx', 'pptx']);
  const hasPreview = PREVIEWABLE.has(openFile.language);
  const isPreviewOnly = PREVIEW_ONLY.has(openFile.language);
  const rawName = openFile.path.split('/').pop() || '';
  // Fix double-encoded Korean filenames (latin1→utf8 + NFD→NFC)
  let fileName = rawName;
  try {
    if (/[\u00c0-\u00ff][\u0080-\u00bf]/.test(rawName)) {
      const bytes = new Uint8Array([...rawName].map(c => c.charCodeAt(0)));
      fileName = new TextDecoder('utf-8').decode(bytes).normalize('NFC');
    } else {
      fileName = rawName.normalize('NFC');
    }
  } catch {
    fileName = rawName.normalize('NFC');
  }

  return (
    <div className="h-full flex flex-col bg-surface-900">
      {/* Tab bar — always shown when tabs exist */}
      {tabs.length > 0 && <TabBar />}

      {/* File header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-700 text-sm">
        {onMobileClose && (
          <button onClick={onMobileClose} className="p-0.5 text-gray-400 hover:text-gray-200 shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <span className="text-gray-400 truncate flex-1" title={openFile.path}>
          {fileName}
        </span>
        {openFile.modified && (
          <span className="text-primary-400 text-xs">Modified</span>
        )}

        {hasPreview && !isPreviewOnly && (
          <div className="flex bg-surface-800 rounded-md p-0.5">
            <button
              className={`px-2 py-0.5 text-xs rounded ${contextPanelTab === 'preview' ? 'bg-surface-700 text-white' : 'text-gray-400'}`}
              onClick={() => setContextPanelTab('preview')}
            >
              Preview
            </button>
            <button
              className={`px-2 py-0.5 text-xs rounded ${contextPanelTab === 'editor' ? 'bg-surface-700 text-white' : 'text-gray-400'}`}
              onClick={() => setContextPanelTab('editor')}
            >
              Edit
            </button>
          </div>
        )}

        {openFile.modified && onSave && (
          <button
            onClick={handleSave}
            className="text-xs px-2 py-0.5 bg-primary-600 hover:bg-primary-700 rounded transition-colors"
          >
            Save
          </button>
        )}

        {!onMobileClose && !fullScreen && (
          <button
            onClick={() => setContextPanelExpanded(!contextPanelExpanded)}
            className="p-0.5 hover:text-primary-400 transition-colors text-gray-400"
            title={contextPanelExpanded ? 'Side panel' : 'Expand'}
          >
            {contextPanelExpanded ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            )}
          </button>
        )}

        <button
          onClick={handleClose}
          className={`p-1 rounded-md transition-colors text-gray-400 ${
            fullScreen
              ? 'hover:text-red-400 hover:bg-red-400/10'
              : 'hover:text-gray-200 hover:bg-surface-700'
          }`}
          title={fullScreen ? 'Close tab' : 'Collapse panel'}
        >
          {fullScreen ? (
            /* × for files view — actually closes the tab */
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            /* › arrow for side panel — collapse/fold */
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </button>
      </div>

      {/* Conflict banner */}
      {externalChange && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-900/40 border-b border-amber-700/50 text-sm">
          <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span className="text-amber-300 text-xs flex-1">This file was modified externally</span>
          <button
            onClick={handleReload}
            className="text-xs px-2 py-0.5 bg-amber-600 hover:bg-amber-700 rounded transition-colors text-white"
          >
            Reload
          </button>
          <button
            onClick={keepLocalEdits}
            className="text-xs px-2 py-0.5 bg-surface-700 hover:bg-surface-600 rounded transition-colors text-gray-300"
          >
            Keep my edits
          </button>
        </div>
      )}

      {/* Content */}
      {isPreviewOnly || (hasPreview && contextPanelTab === 'preview') ? (
        <div className="flex-1 min-h-0 relative">
          {openFile.language === 'image' ? (
            <ImagePreview filePath={openFile.path} />
          ) : openFile.language === 'video' ? (
            <VideoPreview filePath={openFile.path} />
          ) : openFile.language === 'pdf' ? (
            <PdfPreview filePath={openFile.path} />
          ) : openFile.language === 'html' ? (
            <HtmlPreview content={openFile.content} />
          ) : openFile.language === 'markdown' ? (
            <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
              <div className="prose prose-invert prose-sm max-w-none p-4">
                <MarkdownWithMermaid content={openFile.content} components={mdComponents} />
              </div>
            </div>
          ) : OFFICE_FORMATS.has(openFile.language) ? (
            <div className="absolute inset-0 flex flex-col">
              <React.Suspense fallback={
                <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                  <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Loading viewer...
                </div>
              }>
                {openFile.language === 'docx' && <DocxPreview filePath={openFile.path} />}
                {openFile.language === 'xlsx' && <XlsxPreview filePath={openFile.path} />}
                {openFile.language === 'pptx' && <PptxPreview filePath={openFile.path} />}
              </React.Suspense>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          <CodeEditor
            value={openFile.content}
            language={openFile.language}
            onChange={updateContent}
            onSave={handleSave}
          />
        </div>
      )}
    </div>
  );
}
