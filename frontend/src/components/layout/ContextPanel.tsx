import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import { useFileStore } from '../../stores/file-store';
import { CodeEditor } from '../editor/CodeEditor';

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

interface ContextPanelProps {
  onSave?: (path: string, content: string) => void;
  onReload?: (path: string) => void;
  onMobileClose?: () => void;
}

export function ContextPanel({ onSave, onReload, onMobileClose }: ContextPanelProps) {
  const openFile = useFileStore((s) => s.openFile);
  const contextPanelTab = useFileStore((s) => s.contextPanelTab);
  const setContextPanelTab = useFileStore((s) => s.setContextPanelTab);
  const setOpenFile = useFileStore((s) => s.setOpenFile);
  const updateContent = useFileStore((s) => s.updateOpenFileContent);
  const externalChange = useFileStore((s) => s.externalChange);
  const reloadFromDisk = useFileStore((s) => s.reloadFromDisk);
  const keepLocalEdits = useFileStore((s) => s.keepLocalEdits);
  const contextPanelExpanded = useFileStore((s) => s.contextPanelExpanded);
  const setContextPanelExpanded = useFileStore((s) => s.setContextPanelExpanded);

  useEffect(() => {
    if (openFile && (openFile.language === 'html' || openFile.language === 'markdown' || openFile.language === 'pdf')) {
      setContextPanelTab('preview');
    }
  }, [openFile?.path]);

  const handleClose = useCallback(() => {
    if (openFile?.modified) {
      if (!window.confirm('You have unsaved changes. Close anyway?')) return;
    }
    setOpenFile(null);
  }, [openFile, setOpenFile]);

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

  // Resolve image src relative to the open file's directory
  const mdComponents = useMemo(() => {
    const fileDir = openFile.path.substring(0, openFile.path.lastIndexOf('/'));
    const token = localStorage.getItem('token') || '';
    return {
      img({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
        if (!src) return null;
        // If already absolute URL, use as-is
        if (/^https?:\/\//.test(src)) {
          return <img src={src} alt={alt} {...props} style={{ maxWidth: '100%' }} />;
        }
        // Resolve relative path against the file's directory
        let resolvedPath: string;
        if (src.startsWith('/')) {
          resolvedPath = src;
        } else {
          resolvedPath = fileDir + '/' + src;
        }
        // Normalize /../ and /./
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
  }, [openFile.path]);

  const isMarkdown = openFile.language === 'markdown';
  const isHtml = openFile.language === 'html';
  const isPdf = openFile.language === 'pdf';
  const hasPreview = isMarkdown || isHtml || isPdf;
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

        {hasPreview && (
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

        {!onMobileClose && (
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
          className="p-0.5 hover:text-red-400 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
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
      {(isHtml || isPdf) && contextPanelTab === 'preview' ? (
        <div className="flex-1 min-h-0 relative">
          {isPdf ? (
            <PdfPreview filePath={openFile.path} />
          ) : (
            <HtmlPreview content={openFile.content} />
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          {isMarkdown && contextPanelTab === 'preview' ? (
            <div className="prose prose-invert prose-sm max-w-none p-4">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, rehypeHighlight]}
                components={mdComponents}
              >
                {openFile.content}
              </ReactMarkdown>
            </div>
          ) : isPdf ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm p-4">
              Use the Preview tab to view PDF files
            </div>
          ) : (
            <CodeEditor
              value={openFile.content}
              language={openFile.language}
              onChange={updateContent}
              onSave={handleSave}
            />
          )}
        </div>
      )}
    </div>
  );
}
