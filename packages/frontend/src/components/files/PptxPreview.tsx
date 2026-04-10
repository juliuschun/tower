import { useState } from 'react';

/**
 * PPTX Preview via server-side LibreOffice PDF conversion.
 * Renders PowerPoint presentations with near-perfect layout including
 * shapes, charts, images, and Korean text — mirrors DocxPreview's approach.
 *
 * First load triggers LibreOffice Impress conversion (1~3s), subsequent
 * loads hit the on-disk cache (~/tmp/tower-pptx-cache) and are instant.
 */
export function PptxPreview({ filePath }: { filePath: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const token = localStorage.getItem('token') || '';
  const pdfUrl = `/api/files/pptx-pdf?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {loading && !error && (
        <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
          <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Converting presentation...
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center py-8 text-red-400 text-sm">
          {error}
        </div>
      )}
      <iframe
        src={pdfUrl}
        className="flex-1 border-0 bg-white"
        style={{ display: error ? 'none' : 'block' }}
        title="pptx-preview"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError('Failed to load presentation preview');
        }}
      />
    </div>
  );
}
