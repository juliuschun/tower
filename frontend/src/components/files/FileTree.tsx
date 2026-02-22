import React, { useState, useEffect, useRef } from 'react';
import type { FileEntry } from '../../stores/file-store';
import { toastSuccess, toastError } from '../../utils/toast';

interface FileTreeProps {
  entries: FileEntry[];
  onFileClick: (path: string) => void;
  onDirectoryClick: (path: string) => void;
  onPinFile?: (path: string) => void;
  onNewSessionInFolder?: (path: string) => void;
  depth?: number;
}

// SVG icon components
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg className={`w-3 h-3 text-gray-500 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
      fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="w-4 h-4 text-yellow-400/80" fill="currentColor" viewBox="0 0 20 20">
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v1H2V6z" />
      <path fillRule="evenodd" d="M2 9h16l-1.5 6H3.5L2 9z" clipRule="evenodd" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-yellow-400/60" fill="currentColor" viewBox="0 0 20 20">
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  );
}

const fileIconColors: Record<string, string> = {
  ts: 'text-blue-400', tsx: 'text-blue-400',
  js: 'text-yellow-300', jsx: 'text-yellow-300',
  py: 'text-green-400',
  md: 'text-gray-400',
  json: 'text-yellow-500',
  yaml: 'text-orange-400', yml: 'text-orange-400',
  html: 'text-orange-300',
  css: 'text-blue-300',
  sh: 'text-green-300',
  sql: 'text-purple-300',
};

function FileIcon({ extension }: { extension?: string }) {
  const colorClass = fileIconColors[extension || ''] || 'text-gray-500';
  return (
    <svg className={`w-4 h-4 ${colorClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg className="w-3 h-3 text-primary-400 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

const pinnableExtensions = new Set(['md', 'html', 'htm', 'txt', 'py', 'ts', 'tsx', 'js', 'jsx', 'json']);

function DirectoryDropWrapper({ entry, children }: { entry: FileEntry; children: React.ReactNode }) {
  const [dragOver, setDragOver] = useState(false);

  if (!entry.isDirectory) return <>{children}</>;

  const handleDirDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    // Skip internal drags
    if (e.dataTransfer.getData('application/x-attachment')) return;

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    const formData = new FormData();
    formData.append('targetDir', entry.path);
    for (const file of Array.from(files)) {
      formData.append('files', file);
    }

    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/files/upload', { method: 'POST', headers, body: formData });
      const data = await res.json();
      if (!res.ok) { toastError(data.error || 'Upload failed'); return; }
      const ok = data.results.filter((r: any) => !r.error);
      const fail = data.results.filter((r: any) => r.error);
      if (ok.length > 0) toastSuccess(`${ok.length}개 파일 업로드 완료`);
      if (fail.length > 0) toastError(`${fail.length}개 파일 실패: ${fail.map((f: any) => f.error).join(', ')}`);
    } catch {
      toastError('업로드 실패');
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
      onDrop={handleDirDrop}
      className={dragOver ? 'bg-primary-900/20 ring-1 ring-primary-500/30 rounded' : ''}
    >
      {children}
    </div>
  );
}

function ContextMenu({ x, y, path, onNewSession, onClose }: {
  x: number; y: number; path: string;
  onNewSession: (path: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const displayPath = path.replace(/^\/home\/[^/]+/, '~');
  return (
    <div ref={ref} className="fixed z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 min-w-[180px]"
      style={{ left: x, top: y }}>
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-primary-600/30 hover:text-white transition-colors"
        onClick={() => { onNewSession(path); onClose(); }}
      >
        <svg className="w-3.5 h-3.5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        여기서 새 세션
      </button>
      <div className="px-3 py-1 text-[10px] text-gray-500 truncate border-t border-surface-700/50 mt-1 pt-1">{displayPath}</div>
    </div>
  );
}

export function FileTree({ entries, onFileClick, onDirectoryClick, onPinFile, onNewSessionInFolder, depth = 0 }: FileTreeProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  return (
    <div className={depth > 0 ? 'ml-3' : ''}>
      {entries.map((entry) => (
        <DirectoryDropWrapper key={entry.path + '-dw'} entry={entry}>
        <div key={entry.path}>
          <div className="group flex items-center">
            <button
              className="flex-1 flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:bg-surface-800 rounded transition-colors"
              onClick={() => {
                if (entry.isDirectory) {
                  onDirectoryClick(entry.path);
                } else {
                  onFileClick(entry.path);
                }
              }}
              onContextMenu={(e) => {
                if (entry.isDirectory && onNewSessionInFolder) {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, path: entry.path });
                }
              }}
              draggable={!entry.isDirectory}
              onDragStart={(e) => {
                if (entry.isDirectory) { e.preventDefault(); return; }
                const data = {
                  type: 'file',
                  label: entry.name,
                  content: entry.path,
                };
                e.dataTransfer.setData('application/x-attachment', JSON.stringify(data));
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              {entry.isDirectory ? (
                <>
                  {entry.isLoading ? <LoadingSpinner /> : <ChevronIcon expanded={!!entry.isExpanded} />}
                  <FolderIcon open={!!entry.isExpanded} />
                </>
              ) : (
                <>
                  <span className="w-3" />
                  <FileIcon extension={entry.extension} />
                </>
              )}
              <span className="truncate">{entry.name}</span>
              {entry.size !== undefined && !entry.isDirectory && (
                <span className="ml-auto text-[10px] text-gray-500">
                  {entry.size < 1024 ? `${entry.size}B` : `${(entry.size / 1024).toFixed(1)}K`}
                </span>
              )}
            </button>
            {!entry.isDirectory && onPinFile && pinnableExtensions.has(entry.extension || '') && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPinFile(entry.path);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 text-surface-600 hover:text-primary-400 transition-all shrink-0"
                title="핀 추가"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              </button>
            )}
          </div>
          {entry.isDirectory && entry.isExpanded && entry.children && (
            <FileTree
              entries={entry.children}
              onFileClick={onFileClick}
              onDirectoryClick={onDirectoryClick}
              onPinFile={onPinFile}
              onNewSessionInFolder={onNewSessionInFolder}
              depth={depth + 1}
            />
          )}
        </div>
        </DirectoryDropWrapper>
      ))}
      {contextMenu && onNewSessionInFolder && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y} path={contextMenu.path}
          onNewSession={onNewSessionInFolder}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
