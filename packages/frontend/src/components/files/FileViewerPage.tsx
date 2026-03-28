import React, { useEffect, useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import { CodeEditor } from '../editor/CodeEditor';
import { MermaidBlock } from '../chat/MermaidBlock';
import { toastSuccess, toastError } from '../../utils/toast';
import { Toaster } from 'sonner';

// ─── Helpers ───
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', json: 'json', md: 'markdown', html: 'html', css: 'css',
    sh: 'shell', sql: 'sql', yaml: 'yaml', yml: 'yaml',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image',
    pdf: 'pdf', mp4: 'video', webm: 'video',
    docx: 'docx', doc: 'docx',
    xlsx: 'xlsx', xls: 'xlsx',
    pptx: 'pptx', ppt: 'pptx',
  };
  return map[ext] || 'plaintext';
}

// Lazy-loaded Office preview components
const DocxPreview = React.lazy(() => import('./DocxPreview').then(m => ({ default: m.DocxPreview })));
const XlsxPreview = React.lazy(() => import('./XlsxPreview').then(m => ({ default: m.XlsxPreview })));
const PptxPreview = React.lazy(() => import('./PptxPreview').then(m => ({ default: m.PptxPreview })));

const OFFICE_FORMATS = new Set(['docx', 'xlsx', 'pptx']);

function decodeName(raw: string): string {
  try {
    if (/[\u00c0-\u00ff][\u0080-\u00bf]/.test(raw)) {
      const bytes = new Uint8Array([...raw].map(c => c.charCodeAt(0)));
      return new TextDecoder('utf-8').decode(bytes).normalize('NFC');
    }
    return raw.normalize('NFC');
  } catch {
    return raw.normalize('NFC');
  }
}

// ─── Preview components ───
function ImagePreview({ filePath }: { filePath: string }) {
  const token = localStorage.getItem('token') || '';
  const src = `/api/files/serve?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`;
  return (
    <div className="flex-1 flex items-center justify-center bg-surface-900 p-4 overflow-auto">
      <img src={src} alt={filePath.split('/').pop()} className="max-w-full max-h-full object-contain" />
    </div>
  );
}

function PdfPreview({ filePath }: { filePath: string }) {
  const token = localStorage.getItem('token') || '';
  const src = `/api/files/serve?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`;
  return (
    <div className="flex-1">
      <iframe src={src} className="w-full h-full border-0 bg-white" title="pdf-preview" />
    </div>
  );
}

function VideoPreview({ filePath }: { filePath: string }) {
  const token = localStorage.getItem('token') || '';
  const src = `/api/files/serve?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`;
  return (
    <div className="flex-1 flex items-center justify-center bg-black">
      <video src={src} controls className="max-w-full max-h-full" />
    </div>
  );
}

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
    <div className="flex-1">
      <iframe src={blobUrl} className="w-full h-full border-0 bg-white" sandbox="allow-scripts allow-same-origin" title="html-preview" />
    </div>
  );
}

// ─── Markdown with Mermaid ───
// Split content into markdown segments and mermaid code blocks,
// so rehypeRaw doesn't corrupt <br/> etc. inside mermaid definitions.
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

// ─── Main ───
export function FileViewerPage() {
  const params = new URLSearchParams(window.location.search);
  const filePath = params.get('path') || '';
  const language = detectLanguage(filePath);
  const PREVIEWABLE = new Set(['markdown', 'html', 'image', 'pdf', 'video', 'docx', 'xlsx', 'pptx']);
  const explicitMode = params.get('mode') as 'preview' | 'edit' | null;
  const defaultMode = PREVIEWABLE.has(language) ? 'preview' : 'edit';
  const initialMode = explicitMode || defaultMode;

  const [mode, setMode] = useState<'preview' | 'edit'>(initialMode);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fileName = decodeName(filePath.split('/').pop() || '');
  const BINARY = new Set(['image', 'pdf', 'video', 'docx', 'xlsx', 'pptx']);
  const isBinary = BINARY.has(language);
  const modified = content !== originalContent;

  // Force preview for binary files
  useEffect(() => {
    if (isBinary) setMode('preview');
  }, [isBinary]);

  // Fetch file content (skip for binary)
  useEffect(() => {
    if (!filePath) { setError('No file path'); setLoading(false); return; }
    if (isBinary) { setLoading(false); return; }

    const headers = getAuthHeaders();
    delete headers['Content-Type'];
    fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`, { headers })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to load');
        const data = await res.json();
        setContent(data.content);
        setOriginalContent(data.content);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filePath, isBinary]);

  // Set page title
  useEffect(() => {
    document.title = fileName ? `${fileName} — Tower` : 'File Viewer — Tower';
  }, [fileName]);

  const handleSave = useCallback(async () => {
    try {
      const res = await fetch('/api/files/write', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ path: filePath, content }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      setOriginalContent(content);
      toastSuccess('Saved');
    } catch (err: any) {
      toastError(err.message || 'Save failed');
    }
  }, [filePath, content]);

  // Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (mode === 'edit' && modified) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, modified, handleSave]);

  // Markdown image resolver
  const mdComponents = useMemo(() => {
    const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
    const token = localStorage.getItem('token') || '';
    return {
      img({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
        if (!src) return null;
        if (/^https?:\/\//.test(src)) return <img src={src} alt={alt} {...props} style={{ maxWidth: '100%' }} />;
        let resolvedPath = src.startsWith('/') ? src : fileDir + '/' + src;
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
      code({ className, children, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
        const match = /language-(\w+)/.exec(className || '');
        const lang = match?.[1];
        if (lang === 'mermaid') {
          const code = String(children).replace(/\n$/, '');
          return <MermaidBlock code={code} />;
        }
        return <code className={className} {...props}>{children}</code>;
      },
      pre({ children, ...props }: React.HTMLAttributes<HTMLPreElement> & { children?: React.ReactNode }) {
        // If the child is a MermaidBlock (rendered by code component), skip the <pre> wrapper
        const child = React.Children.toArray(children)[0];
        if (React.isValidElement(child) && child.type === MermaidBlock) {
          return <>{children}</>;
        }
        return <pre {...props}>{children}</pre>;
      },
    };
  }, [filePath]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-900 text-gray-400">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-900 text-red-400">
        {error}
      </div>
    );
  }

  const hasPreview = PREVIEWABLE.has(language);

  return (
    <div className="h-screen flex flex-col bg-surface-900 text-gray-200">
      <Toaster position="top-center" theme="dark" />

      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-11 border-b border-surface-700 shrink-0">
        <span className="text-sm text-gray-300 truncate flex-1" title={filePath}>
          {fileName}
        </span>

        {modified && <span className="text-primary-400 text-xs">Modified</span>}

        {/* Mode toggle */}
        {hasPreview && !isBinary && (
          <div className="flex bg-surface-800 rounded-md p-0.5">
            <button
              className={`px-2.5 py-1 text-xs rounded transition-colors ${mode === 'preview' ? 'bg-surface-700 text-white' : 'text-gray-400 hover:text-gray-300'}`}
              onClick={() => setMode('preview')}
            >
              Preview
            </button>
            <button
              className={`px-2.5 py-1 text-xs rounded transition-colors ${mode === 'edit' ? 'bg-surface-700 text-white' : 'text-gray-400 hover:text-gray-300'}`}
              onClick={() => setMode('edit')}
            >
              Edit
            </button>
          </div>
        )}
        {!hasPreview && !isBinary && (
          <span className="text-xs text-gray-500">{language}</span>
        )}

        {modified && (
          <button
            onClick={handleSave}
            className="text-xs px-3 py-1 bg-primary-600 hover:bg-primary-700 rounded transition-colors text-white"
          >
            Save
          </button>
        )}
      </div>

      {/* Content */}
      {mode === 'preview' && language === 'image' && <ImagePreview filePath={filePath} />}
      {mode === 'preview' && language === 'pdf' && <PdfPreview filePath={filePath} />}
      {mode === 'preview' && language === 'video' && <VideoPreview filePath={filePath} />}
      {mode === 'preview' && language === 'html' && <HtmlPreview content={content} />}
      {mode === 'preview' && language === 'markdown' && (
        <div className="flex-1 overflow-y-auto">
          <div className="prose prose-invert prose-sm max-w-none p-6">
            <MarkdownWithMermaid content={content} components={mdComponents} />
          </div>
        </div>
      )}
      {/* Office document previews (lazy-loaded) */}
      {mode === 'preview' && OFFICE_FORMATS.has(language) && (
        <React.Suspense fallback={
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading viewer...
          </div>
        }>
          {language === 'docx' && <DocxPreview filePath={filePath} />}
          {language === 'xlsx' && <XlsxPreview filePath={filePath} />}
          {language === 'pptx' && <PptxPreview filePath={filePath} />}
        </React.Suspense>
      )}
      {(mode === 'edit' || (!hasPreview && !isBinary)) && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <CodeEditor
            value={content}
            language={language}
            onChange={setContent}
            onSave={handleSave}
          />
        </div>
      )}
    </div>
  );
}
