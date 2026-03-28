import { useEffect, useRef, useState } from 'react';

/**
 * DOCX Preview using docx-preview library.
 * Renders Word documents with accurate layout, images, and Korean text.
 */
export function DocxPreview({ filePath }: { filePath: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!filePath || !containerRef.current) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError('');

        // Fetch the binary file
        const token = localStorage.getItem('token') || '';
        const res = await fetch(
          `/api/files/serve?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`
        );
        if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
        const blob = await res.blob();

        if (cancelled) return;

        // Dynamically import docx-preview (code-split)
        const { renderAsync } = await import('docx-preview');

        if (cancelled || !containerRef.current) return;

        // Clear previous content
        containerRef.current.innerHTML = '';

        await renderAsync(blob, containerRef.current, undefined, {
          className: 'docx-container',
          inWrapper: true,
          ignoreWidth: false,
          ignoreFonts: false,
          breakPages: true,
          useBase64URL: true,
        });
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to render DOCX');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [filePath]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {loading && (
        <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
          <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading document...
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center py-8 text-red-400 text-sm">
          {error}
        </div>
      )}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-100"
        style={{
          /* docx-preview renders white pages — give them breathing room */
          padding: '16px',
        }}
      />
      <style>{`
        .docx-container {
          font-family: 'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
        }
        .docx-container .docx-wrapper {
          background: #f3f4f6;
          padding: 16px;
        }
        .docx-container .docx-wrapper > section.docx {
          background: white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          margin: 0 auto 16px;
          padding: 40px;
        }
      `}</style>
    </div>
  );
}
