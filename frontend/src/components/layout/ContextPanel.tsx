import React, { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
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

function PdfPreview({ base64Content }: { base64Content: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const binary = atob(base64Content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [base64Content]);

  if (!blobUrl) return null;
  return (
    <div className="absolute inset-0">
      <iframe
        src={blobUrl}
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
      if (!window.confirm('저장하지 않은 변경사항이 있습니다. 닫으시겠습니까?')) return;
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
            <span className="text-sm font-medium text-gray-400">파일 없음</span>
            <button onClick={onMobileClose} className="p-1.5 text-gray-400 hover:text-gray-200">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          파일을 선택하면 여기에 표시됩니다
        </div>
      </div>
    );
  }

  const isMarkdown = openFile.language === 'markdown';
  const isHtml = openFile.language === 'html';
  const isPdf = openFile.language === 'pdf';
  const hasPreview = isMarkdown || isHtml || isPdf;
  const fileName = openFile.path.split('/').pop() || '';

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
          <span className="text-primary-400 text-xs">수정됨</span>
        )}

        {hasPreview && (
          <div className="flex bg-surface-800 rounded-md p-0.5">
            <button
              className={`px-2 py-0.5 text-xs rounded ${contextPanelTab === 'preview' ? 'bg-surface-700 text-white' : 'text-gray-400'}`}
              onClick={() => setContextPanelTab('preview')}
            >
              미리보기
            </button>
            <button
              className={`px-2 py-0.5 text-xs rounded ${contextPanelTab === 'editor' ? 'bg-surface-700 text-white' : 'text-gray-400'}`}
              onClick={() => setContextPanelTab('editor')}
            >
              편집
            </button>
          </div>
        )}

        {openFile.modified && onSave && (
          <button
            onClick={handleSave}
            className="text-xs px-2 py-0.5 bg-primary-600 hover:bg-primary-700 rounded transition-colors"
          >
            저장
          </button>
        )}

        {!onMobileClose && (
          <button
            onClick={() => setContextPanelExpanded(!contextPanelExpanded)}
            className="p-0.5 hover:text-primary-400 transition-colors text-gray-400"
            title={contextPanelExpanded ? '사이드 패널로' : '확장'}
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
          <span className="text-amber-300 text-xs flex-1">이 파일이 외부에서 수정되었습니다</span>
          <button
            onClick={handleReload}
            className="text-xs px-2 py-0.5 bg-amber-600 hover:bg-amber-700 rounded transition-colors text-white"
          >
            다시 불러오기
          </button>
          <button
            onClick={keepLocalEdits}
            className="text-xs px-2 py-0.5 bg-surface-700 hover:bg-surface-600 rounded transition-colors text-gray-300"
          >
            내 편집 유지
          </button>
        </div>
      )}

      {/* Content */}
      {(isHtml || isPdf) && contextPanelTab === 'preview' ? (
        <div className="flex-1 min-h-0 relative">
          {isPdf ? (
            <PdfPreview base64Content={openFile.content} />
          ) : (
            <HtmlPreview content={openFile.content} />
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          {isMarkdown && contextPanelTab === 'preview' ? (
            <div className="prose prose-invert prose-sm max-w-none p-4">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {openFile.content}
              </ReactMarkdown>
            </div>
          ) : isPdf ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm p-4">
              PDF 파일은 미리보기 탭에서 확인하세요
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
