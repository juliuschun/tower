import React, { useState, useEffect, useRef } from 'react';
import type { FileEntry } from '../../stores/file-store';
import { toastSuccess, toastError } from '../../utils/toast';

interface FileTreeProps {
  entries: FileEntry[];
  onFileClick: (path: string) => void;
  onDirectoryClick: (path: string) => void;
  onPinFile?: (path: string) => void;
  onNewSessionInFolder?: (path: string) => void;
  onRefreshTree?: () => void;
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

// ─── API helpers ───
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function apiPost(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

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

// ─── Context Menu ───
type MenuAction = 'newFile' | 'newFolder' | 'rename' | 'delete' | 'newSession';

function ContextMenu({ x, y, entry, showNewSession, onAction, onClose }: {
  x: number; y: number; entry: FileEntry;
  showNewSession: boolean;
  onAction: (action: MenuAction, entry: FileEntry) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Position adjustment to prevent off-screen
  const style: React.CSSProperties = { left: x, top: y };

  const menuItems: { action: MenuAction; label: string; icon: React.ReactNode; show: boolean; danger?: boolean }[] = [
    {
      action: 'newFile', label: '새 파일', show: entry.isDirectory,
      icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
    },
    {
      action: 'newFolder', label: '새 폴더', show: entry.isDirectory,
      icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>,
    },
    {
      action: 'newSession', label: '여기서 새 세션', show: entry.isDirectory && showNewSession,
      icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>,
    },
    {
      action: 'rename', label: '이름 변경', show: true,
      icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>,
    },
    {
      action: 'delete', label: '삭제', show: true, danger: true,
      icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>,
    },
  ];

  return (
    <div ref={ref} className="fixed z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 min-w-[160px]" style={style}>
      {menuItems.filter(m => m.show).map((item, i) => (
        <React.Fragment key={item.action}>
          {item.danger && i > 0 && <div className="border-t border-surface-700/50 my-0.5" />}
          <button
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] transition-colors ${
              item.danger
                ? 'text-red-400 hover:bg-red-600/20 hover:text-red-300'
                : 'text-gray-300 hover:bg-primary-600/30 hover:text-white'
            }`}
            onClick={() => { onAction(item.action, entry); onClose(); }}
          >
            <span className={item.danger ? 'text-red-400' : 'text-primary-400'}>{item.icon}</span>
            {item.label}
          </button>
        </React.Fragment>
      ))}
      <div className="px-3 py-1 text-[10px] text-gray-500 truncate border-t border-surface-700/50 mt-0.5 pt-1">
        {entry.name}
      </div>
    </div>
  );
}

// ─── Inline name input ───
function InlineInput({ defaultValue, placeholder, onSubmit, onCancel }: {
  defaultValue?: string; placeholder: string;
  onSubmit: (value: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue || '');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    if (defaultValue) ref.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const trimmed = value.trim();
      if (trimmed) onSubmit(trimmed);
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={onCancel}
      placeholder={placeholder}
      className="w-full bg-surface-950 border border-primary-500/50 rounded px-2 py-0.5 text-[12px] text-gray-200 outline-none"
    />
  );
}

export function FileTree({ entries, onFileClick, onDirectoryClick, onPinFile, onNewSessionInFolder, onRefreshTree, depth = 0 }: FileTreeProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  const [inlineInput, setInlineInput] = useState<{ type: 'newFile' | 'newFolder' | 'rename'; parentPath?: string; entry?: FileEntry } | null>(null);

  const handleContextAction = async (action: MenuAction, entry: FileEntry) => {
    if (action === 'newSession' && onNewSessionInFolder) {
      onNewSessionInFolder(entry.path);
      return;
    }

    if (action === 'newFile') {
      setInlineInput({ type: 'newFile', parentPath: entry.path });
      return;
    }

    if (action === 'newFolder') {
      setInlineInput({ type: 'newFolder', parentPath: entry.path });
      return;
    }

    if (action === 'rename') {
      setInlineInput({ type: 'rename', entry });
      return;
    }

    if (action === 'delete') {
      const displayName = entry.name;
      const isDir = entry.isDirectory;
      if (!confirm(`"${displayName}"${isDir ? ' 폴더와 모든 내용을' : '을(를)'} 삭제하시겠습니까?`)) return;
      try {
        await apiPost('/api/files/delete', { path: entry.path });
        toastSuccess(`${displayName} 삭제 완료`);
        onRefreshTree?.();
      } catch (err: any) {
        toastError(err.message || '삭제 실패');
      }
    }
  };

  const handleInlineSubmit = async (value: string) => {
    if (!inlineInput) return;

    try {
      if (inlineInput.type === 'newFile' && inlineInput.parentPath) {
        const filePath = `${inlineInput.parentPath}/${value}`;
        await apiPost('/api/files/create', { path: filePath, content: '' });
        toastSuccess(`${value} 생성 완료`);
      } else if (inlineInput.type === 'newFolder' && inlineInput.parentPath) {
        const dirPath = `${inlineInput.parentPath}/${value}`;
        await apiPost('/api/files/mkdir', { path: dirPath });
        toastSuccess(`${value} 폴더 생성 완료`);
      } else if (inlineInput.type === 'rename' && inlineInput.entry) {
        const oldPath = inlineInput.entry.path;
        const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/'));
        const newPath = `${parentDir}/${value}`;
        await apiPost('/api/files/rename', { oldPath, newPath });
        toastSuccess(`이름 변경 완료`);
      }
      onRefreshTree?.();
    } catch (err: any) {
      toastError(err.message || '작업 실패');
    }
    setInlineInput(null);
  };

  return (
    <div className={depth > 0 ? 'ml-3' : ''}>
      {entries.map((entry) => (
        <DirectoryDropWrapper key={entry.path + '-dw'} entry={entry}>
        <div key={entry.path}>
          {/* Rename inline input */}
          {inlineInput?.type === 'rename' && inlineInput.entry?.path === entry.path ? (
            <div className="px-2 py-0.5">
              <InlineInput
                defaultValue={entry.name}
                placeholder="새 이름"
                onSubmit={handleInlineSubmit}
                onCancel={() => setInlineInput(null)}
              />
            </div>
          ) : (
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
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, entry });
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
          )}
          {/* Children + inline new file/folder inputs inside expanded dir */}
          {entry.isDirectory && entry.isExpanded && (
            <div className="ml-3">
              {/* Inline new file / new folder input */}
              {inlineInput && (inlineInput.type === 'newFile' || inlineInput.type === 'newFolder') && inlineInput.parentPath === entry.path && (
                <div className="flex items-center gap-1.5 px-2 py-0.5">
                  {inlineInput.type === 'newFolder' ? (
                    <FolderIcon open={false} />
                  ) : (
                    <FileIcon />
                  )}
                  <InlineInput
                    placeholder={inlineInput.type === 'newFile' ? '파일명' : '폴더명'}
                    onSubmit={handleInlineSubmit}
                    onCancel={() => setInlineInput(null)}
                  />
                </div>
              )}
              {entry.children && (
                <FileTree
                  entries={entry.children}
                  onFileClick={onFileClick}
                  onDirectoryClick={onDirectoryClick}
                  onPinFile={onPinFile}
                  onNewSessionInFolder={onNewSessionInFolder}
                  onRefreshTree={onRefreshTree}
                  depth={depth + 1}
                />
              )}
            </div>
          )}
        </div>
        </DirectoryDropWrapper>
      ))}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y} entry={contextMenu.entry}
          showNewSession={!!onNewSessionInFolder}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
