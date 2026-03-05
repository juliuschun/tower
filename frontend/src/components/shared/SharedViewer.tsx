import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'sh', 'sql', 'json', 'yaml', 'yml', 'css']);
const PREVIEWABLE_EXTS = new Set(['md', 'ts', 'tsx', 'js', 'jsx', 'py', 'sh', 'sql', 'json', 'yaml', 'yml', 'css', 'html', 'htm', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm']);
// 브라우저가 직접 렌더링하는 파일 — iframe으로 표시
const IFRAME_EXTS = new Set(['pdf', 'html', 'htm', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm']);

interface FileData {
  content: string;
  fileName: string;
  ext: string;
}

export function SharedViewer() {
  const token = window.location.pathname.split('/shared/')[1];
  const [data, setData] = useState<FileData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview');

  useEffect(() => {
    if (!token) { setError('잘못된 링크입니다.'); setLoading(false); return; }
    fetch(`/api/shared/${token}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError('이 링크는 만료되었거나 취소되었습니다.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleDownload = () => {
    window.location.href = `/api/shared/${token}?download=1`;
  };

  if (loading) {
    return (
      <div className="bg-gray-950 flex items-center justify-center" style={{ height: '100dvh' }}>
        <div className="text-gray-400 text-sm">불러오는 중...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-gray-950 flex items-center justify-center" style={{ height: '100dvh' }}>
        <div className="text-center space-y-3">
          <div className="text-5xl">🔗</div>
          <p className="text-gray-300 text-sm">{error || '파일을 불러올 수 없습니다.'}</p>
        </div>
      </div>
    );
  }

  const canPreview = PREVIEWABLE_EXTS.has(data.ext);
  const useIframe = IFRAME_EXTS.has(data.ext);

  return (
    <div className="flex flex-col bg-gray-950 text-gray-100" style={{ height: '100dvh' }}>
      {/* Header */}
      <div className="shrink-0 border-b border-gray-800 px-6 py-3 flex items-center justify-between bg-gray-950/90 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <span className="text-sm font-medium text-white">{data.fileName}</span>
          </div>
          {/* Preview / Raw 탭 — previewable 파일에만 표시 */}
          {canPreview && (
            <div className="flex items-center bg-gray-900 rounded-lg p-0.5 border border-gray-800">
              <button
                onClick={() => setViewMode('preview')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  viewMode === 'preview'
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                미리보기
              </button>
              <button
                onClick={() => setViewMode('raw')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  viewMode === 'raw'
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                원본
              </button>
            </div>
          )}
        </div>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          다운로드
        </button>
      </div>

      {/* Content — flex-1 + overflow-y-auto so body scroll is not needed */}
      <div className={`flex-1 overflow-y-auto ${useIframe && viewMode === 'preview' ? '' : 'max-w-4xl mx-auto w-full px-6 py-8'}`}>
        {viewMode === 'raw' ? (
          /* 원본 — 항상 plain text */
          <pre className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed font-mono">{data.content}</pre>
        ) : useIframe && data.ext === 'pdf' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? (
          /* 모바일 PDF — iframe 대신 직접 열기 */
          <div className="flex flex-col items-center justify-center h-full gap-4 p-4">
            <svg className="w-16 h-16 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <p className="text-sm text-gray-400">{data.fileName}</p>
            <a
              href={`/api/shared/${token}?render=1`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
            >
              Open PDF
            </a>
          </div>
        ) : useIframe ? (
          /* 미리보기 — PDF / HTML / 이미지 / 영상: 브라우저 네이티브 렌더링 */
          <iframe
            src={`/api/shared/${token}?render=1`}
            className="w-full h-full border-0"
            title={data.fileName}
            sandbox="allow-scripts allow-same-origin allow-popups"
            referrerPolicy="no-referrer"
          />
        ) : data.ext === 'md' ? (
          /* 미리보기 — 마크다운 렌더링 */
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {data.content}
            </ReactMarkdown>
          </div>
        ) : CODE_EXTS.has(data.ext) ? (
          /* 미리보기 — 코드 syntax highlight */
          <pre className="bg-gray-900 rounded-xl p-4 overflow-x-auto text-sm text-gray-200 leading-relaxed">
            <code>{data.content}</code>
          </pre>
        ) : (
          /* 미리보기 — 일반 텍스트 */
          <pre className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{data.content}</pre>
        )}
      </div>
    </div>
  );
}
