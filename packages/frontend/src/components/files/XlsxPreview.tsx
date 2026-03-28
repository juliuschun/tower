import { useEffect, useState, useMemo } from 'react';

/**
 * XLSX/XLS Preview using SheetJS.
 * Renders Excel spreadsheets as interactive HTML tables with sheet tabs.
 * Full Korean/CJK Unicode support.
 */
export function XlsxPreview({ filePath }: { filePath: string }) {
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState('');
  const [sheetsHtml, setSheetsHtml] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError('');

        // Fetch binary
        const token = localStorage.getItem('token') || '';
        const res = await fetch(
          `/api/files/serve?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`
        );
        if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
        const arrayBuffer = await res.arrayBuffer();

        if (cancelled) return;

        // Dynamically import SheetJS (code-split)
        const XLSX = await import('xlsx');

        if (cancelled) return;

        const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', codepage: 65001 });
        const names = workbook.SheetNames;
        setSheetNames(names);
        setActiveSheet(names[0] || '');

        // Pre-render all sheets to HTML
        const htmlMap: Record<string, string> = {};
        for (const name of names) {
          const sheet = workbook.Sheets[name];
          htmlMap[name] = XLSX.utils.sheet_to_html(sheet, { editable: false });
        }
        setSheetsHtml(htmlMap);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to render spreadsheet');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [filePath]);

  const currentHtml = useMemo(() => sheetsHtml[activeSheet] || '', [sheetsHtml, activeSheet]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading spreadsheet...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sheet tabs */}
      {sheetNames.length > 1 && (
        <div className="flex items-center gap-0.5 px-3 py-1.5 bg-surface-850 border-b border-surface-700 overflow-x-auto shrink-0">
          {sheetNames.map((name) => (
            <button
              key={name}
              onClick={() => setActiveSheet(name)}
              className={`px-3 py-1 text-xs rounded-md transition-colors whitespace-nowrap ${
                activeSheet === name
                  ? 'bg-green-600/30 text-green-300 font-medium'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-surface-700'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Table content */}
      <div className="flex-1 overflow-auto bg-white">
        <div
          dangerouslySetInnerHTML={{ __html: currentHtml }}
        />
      </div>

      <style>{`
        .flex-1.overflow-auto table {
          border-collapse: collapse;
          width: max-content;
          min-width: 100%;
          font-family: 'Noto Sans KR', 'Malgun Gothic', -apple-system, sans-serif;
          font-size: 13px;
          color: #1f2937;
        }
        .flex-1.overflow-auto td,
        .flex-1.overflow-auto th {
          border: 1px solid #e5e7eb;
          padding: 4px 8px;
          white-space: nowrap;
          max-width: 300px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .flex-1.overflow-auto th {
          background: #f3f4f6;
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 1;
        }
        .flex-1.overflow-auto tr:hover td {
          background: #f0f9ff;
        }
      `}</style>
    </div>
  );
}
