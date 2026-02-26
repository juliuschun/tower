import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';

const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'sh', 'sql', 'json', 'yaml', 'yml', 'css', 'html']);

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
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-sm">불러오는 중...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="text-5xl">🔗</div>
          <p className="text-gray-300 text-sm">{error || '파일을 불러올 수 없습니다.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-3 flex items-center justify-between sticky top-0 bg-gray-950/90 backdrop-blur">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <span className="text-sm font-medium text-white">{data.fileName}</span>
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

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {data.ext === 'md' ? (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
              {data.content}
            </ReactMarkdown>
          </div>
        ) : CODE_EXTS.has(data.ext) ? (
          <pre className="bg-gray-900 rounded-xl p-4 overflow-x-auto text-sm text-gray-200 leading-relaxed">
            <code>{data.content}</code>
          </pre>
        ) : (
          <pre className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{data.content}</pre>
        )}
      </div>
    </div>
  );
}
