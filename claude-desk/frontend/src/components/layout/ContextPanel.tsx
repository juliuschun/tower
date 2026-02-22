import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useFileStore } from '../../stores/file-store';
import { CodeEditor } from '../editor/CodeEditor';

interface ContextPanelProps {
  onSave?: (path: string, content: string) => void;
}

export function ContextPanel({ onSave }: ContextPanelProps) {
  const openFile = useFileStore((s) => s.openFile);
  const contextPanelTab = useFileStore((s) => s.contextPanelTab);
  const setContextPanelTab = useFileStore((s) => s.setContextPanelTab);
  const setOpenFile = useFileStore((s) => s.setOpenFile);
  const updateContent = useFileStore((s) => s.updateOpenFileContent);

  if (!openFile) {
    return (
      <div className="h-full flex items-center justify-center text-gray-600 text-sm">
        파일을 선택하면 여기에 표시됩니다
      </div>
    );
  }

  const isMarkdown = openFile.language === 'markdown';
  const isHtml = openFile.language === 'html';
  const hasPreview = isMarkdown || isHtml;
  const fileName = openFile.path.split('/').pop() || '';

  return (
    <div className="h-full flex flex-col bg-surface-900">
      {/* File header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-700 text-sm">
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
            onClick={() => onSave(openFile.path, openFile.content)}
            className="text-xs px-2 py-0.5 bg-primary-600 hover:bg-primary-700 rounded transition-colors"
          >
            저장
          </button>
        )}

        <button
          onClick={() => setOpenFile(null)}
          className="p-0.5 hover:text-red-400 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isHtml && contextPanelTab === 'preview' ? (
          <iframe
            src={`/api/files/serve?path=${encodeURIComponent(openFile.path)}`}
            className="w-full h-full border-0 bg-white"
            sandbox="allow-scripts"
            title={fileName}
          />
        ) : isMarkdown && contextPanelTab === 'preview' ? (
          <div className="prose prose-invert prose-sm max-w-none p-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {openFile.content}
            </ReactMarkdown>
          </div>
        ) : (
          <CodeEditor
            value={openFile.content}
            language={openFile.language}
            onChange={updateContent}
          />
        )}
      </div>
    </div>
  );
}
