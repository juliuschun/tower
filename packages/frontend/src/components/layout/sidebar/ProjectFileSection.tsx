import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useFileStore, type FileEntry } from '../../../stores/file-store';
import { FileTree } from '../../files/FileTree';
import { toastError, toastSuccess } from '../../../utils/toast';

export function ProjectFileSection({ project, onFileClick, onPinFile, onNewSessionInFolder }: {
  project: { id: string; name: string; rootPath?: string | null; color?: string; [key: string]: any };
  onFileClick: (path: string) => void;
  onPinFile?: (path: string) => void;
  onNewSessionInFolder?: (path: string) => void;
}) {
  // Persisted collapsed state via zustand store
  const isExpanded = useFileStore((s) => s.expandedProjects.has(project.id));
  const toggleProjectExpanded = useFileStore((s) => s.toggleProjectExpanded);
  const refreshTrigger = useFileStore((s) => s.refreshTrigger);
  const bumpRefreshTrigger = useFileStore((s) => s.bumpRefreshTrigger);
  const showHidden = useFileStore((s) => s.showHidden);

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const loaded = useRef(false);
  const prevTrigger = useRef(refreshTrigger);

  // Quick-action state for project header buttons
  const [headerAction, setHeaderAction] = useState<'file' | 'folder' | null>(null);
  const [headerInputValue, setHeaderInputValue] = useState('');
  const headerInputRef = useRef<HTMLInputElement>(null);
  const headerUploadRef = useRef<HTMLInputElement>(null);
  const [headerDragOver, setHeaderDragOver] = useState(false);

  const rootPath = project.rootPath;

  // Debug: log mount state
  useEffect(() => {
    console.log(`[ProjectFileSection] mount: id=${project.id}, name=${project.name}, isExpanded=${isExpanded}, rootPath=${rootPath}`);
  }, []);

  const fetchDir = useCallback(async (dirPath: string): Promise<FileEntry[]> => {
    try {
      const tk = localStorage.getItem('token');
      const hdrs: Record<string, string> = {};
      if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
      const url = `/api/files/tree?path=${encodeURIComponent(dirPath)}${showHidden ? '&showHidden=true' : ''}`;
      const res = await fetch(url, { headers: hdrs });
      if (res.ok) {
        const data = await res.json();
        return data.entries || [];
      }
    } catch {}
    return [];
  }, [showHidden]);

  const loadTree = useCallback(async (force?: boolean) => {
    if (!rootPath || (loaded.current && !force)) return;
    setLoading(true);
    const result = await fetchDir(rootPath);
    setEntries(result);
    loaded.current = true;
    setLoading(false);
  }, [rootPath, fetchDir]);

  // Stable stagger delay per project (based on project id hash)
  const staggerDelay = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < project.id.length; i++) hash = ((hash << 5) - hash + project.id.charCodeAt(i)) | 0;
    return Math.abs(hash) % 400; // 0-400ms spread
  }, [project.id]);

  // Auto-load on mount if project was previously expanded (staggered)
  useEffect(() => {
    if (isExpanded && !loaded.current) {
      const timer = setTimeout(() => loadTree(), staggerDelay);
      return () => clearTimeout(timer);
    }
  }, [isExpanded, loadTree, staggerDelay]);

  // Auto-refresh when refreshTrigger changes (new files created/deleted)
  useEffect(() => {
    if (refreshTrigger !== prevTrigger.current) {
      prevTrigger.current = refreshTrigger;
      if (isExpanded && loaded.current && rootPath) {
        // Staggered debounce to avoid thundering herd
        const timer = setTimeout(() => {
          loadTree(true);
        }, 300 + staggerDelay);
        return () => clearTimeout(timer);
      }
    }
  }, [refreshTrigger, isExpanded, rootPath, loadTree, staggerDelay]);

  // Toggle or expand a directory within the local tree
  const handleDirectoryClick = useCallback(async (dirPath: string) => {
    const findAndToggle = (items: FileEntry[]): FileEntry[] =>
      items.map(e => {
        if (e.path === dirPath) {
          if (e.isExpanded) {
            // Collapse
            return { ...e, isExpanded: false };
          }
          // Expand — will load children
          return { ...e, isExpanded: true, isLoading: true };
        }
        if (e.children) return { ...e, children: findAndToggle(e.children) };
        return e;
      });

    setEntries(prev => findAndToggle(prev));

    // Check if already has children loaded
    const findEntry = (items: FileEntry[]): FileEntry | null => {
      for (const e of items) {
        if (e.path === dirPath) return e;
        if (e.children) { const found = findEntry(e.children); if (found) return found; }
      }
      return null;
    };
    const entry = findEntry(entries);
    if (entry?.isExpanded) {
      // Was already expanded → we just collapsed, no fetch needed
      return;
    }

    // Fetch children
    const children = await fetchDir(dirPath);
    const setChildren = (items: FileEntry[]): FileEntry[] =>
      items.map(e => {
        if (e.path === dirPath) return { ...e, children, isExpanded: true, isLoading: false };
        if (e.children) return { ...e, children: setChildren(e.children) };
        return e;
      });
    setEntries(prev => setChildren(prev));
  }, [entries, fetchDir]);

  const handleToggle = () => {
    toggleProjectExpanded(project.id);
    if (!isExpanded) loadTree(); // expanding → load
  };

  // Header quick-action: create file/folder at project root
  const handleHeaderNewSubmit = async () => {
    const name = headerInputValue.trim();
    if (!name || !rootPath) { setHeaderAction(null); return; }
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const fullPath = `${rootPath}/${name}`;
      const endpoint = headerAction === 'folder' ? '/api/files/mkdir' : '/api/files/create';
      const body = headerAction === 'folder' ? { path: fullPath } : { path: fullPath, content: '' };
      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      toastSuccess(`${name} created`);
      bumpRefreshTrigger();
      // Ensure project is expanded to show new item
      if (!isExpanded) { toggleProjectExpanded(project.id); loadTree(true); }
      else { loaded.current = false; loadTree(); }
    } catch (err: any) {
      toastError(err.message || 'Create failed');
    }
    setHeaderAction(null);
    setHeaderInputValue('');
  };

  // Header upload via file input
  const handleHeaderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !rootPath) return;
    const formData = new FormData();
    formData.append('targetDir', rootPath);
    for (const file of Array.from(files)) formData.append('files', file);
    try {
      const token = localStorage.getItem('token');
      const hdrs: Record<string, string> = {};
      if (token) hdrs['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/files/upload', { method: 'POST', headers: hdrs, body: formData });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) { toastError(`Upload failed (${res.status}): server returned non-JSON response`); return; }
      const data = await res.json();
      if (!res.ok) { toastError(data.error || 'Upload failed'); return; }
      const ok = data.results.filter((r: any) => !r.error);
      const fail = data.results.filter((r: any) => r.error);
      if (ok.length > 0) toastSuccess(`${ok.length} file(s) uploaded to ${project.name}`);
      if (fail.length > 0) toastError(`${fail.length} failed`);
      bumpRefreshTrigger();
      if (!isExpanded) { toggleProjectExpanded(project.id); loadTree(true); }
      else { loaded.current = false; loadTree(); }
    } catch (err) {
      toastError(`Upload failed: ${err instanceof Error ? err.message : 'Network error'}`);
    }
    e.target.value = '';
  };

  // Header drag-and-drop upload
  const handleHeaderDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setHeaderDragOver(false);
    if (e.dataTransfer.getData('application/x-attachment')) return;
    const files = e.dataTransfer.files;
    if (files.length === 0 || !rootPath) return;
    const formData = new FormData();
    formData.append('targetDir', rootPath);
    for (const file of Array.from(files)) formData.append('files', file);
    try {
      const token = localStorage.getItem('token');
      const hdrs: Record<string, string> = {};
      if (token) hdrs['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/files/upload', { method: 'POST', headers: hdrs, body: formData });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) { toastError(`Upload failed (${res.status}): server returned non-JSON response`); return; }
      const data = await res.json();
      if (!res.ok) { toastError(data.error || 'Upload failed'); return; }
      const ok = data.results.filter((r: any) => !r.error);
      if (ok.length > 0) toastSuccess(`${ok.length} file(s) uploaded to ${project.name}`);
      bumpRefreshTrigger();
      if (!isExpanded) { toggleProjectExpanded(project.id); loadTree(true); }
      else { loaded.current = false; loadTree(); }
    } catch (err) {
      toastError(`Upload failed: ${err instanceof Error ? err.message : 'Network error'}`);
    }
  };

  // Auto-focus header input
  useEffect(() => {
    if (headerAction) headerInputRef.current?.focus();
  }, [headerAction]);

  if (!rootPath) return null;

  const headerActionBtnClass = 'opacity-0 group-hover/proj:opacity-100 p-0.5 rounded text-surface-600 hover:text-primary-400 hover:bg-surface-700/50 transition-all';

  return (
    <div className="mb-1">
      <div
        className={`flex items-center gap-1.5 px-1 py-1.5 rounded-md cursor-pointer transition-colors group/proj hover:bg-surface-850 ${headerDragOver ? 'bg-primary-900/20 ring-1 ring-primary-500/40' : ''}`}
        onClick={handleToggle}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setHeaderDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setHeaderDragOver(false); }}
        onDrop={handleHeaderDrop}
      >
        <svg className={`w-3.5 h-3.5 text-surface-600 transition-transform shrink-0 ${!isExpanded ? '-rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        <svg className="w-4 h-4 text-surface-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
        </svg>
        <span className="text-[13px] font-bold text-gray-300 truncate flex-1">{project.name}</span>

        {/* Quick action buttons — visible on hover */}
        <button
          className={headerActionBtnClass}
          title="New file"
          onClick={(e) => { e.stopPropagation(); setHeaderAction('file'); setHeaderInputValue(''); if (!isExpanded) { toggleProjectExpanded(project.id); loadTree(); } }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </button>
        <button
          className={headerActionBtnClass}
          title="New folder"
          onClick={(e) => { e.stopPropagation(); setHeaderAction('folder'); setHeaderInputValue(''); if (!isExpanded) { toggleProjectExpanded(project.id); loadTree(); } }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
        </button>
        <button
          className={`${headerActionBtnClass} hover:!text-green-400`}
          title="Upload to this project"
          onClick={(e) => { e.stopPropagation(); headerUploadRef.current?.click(); }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </button>
        <input ref={headerUploadRef} type="file" multiple hidden onChange={handleHeaderUpload} />
      </div>

      {/* Inline input for header new file/folder action */}
      {headerAction && (
        <div className="flex items-center gap-1.5 px-2 py-1 ml-5 bg-surface-850 rounded-md mt-0.5">
          {headerAction === 'folder' ? (
            <svg className="w-3.5 h-3.5 text-yellow-400/70 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-primary-400/70 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          )}
          <input
            ref={headerInputRef}
            type="text"
            value={headerInputValue}
            onChange={(e) => setHeaderInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleHeaderNewSubmit();
              if (e.key === 'Escape') setHeaderAction(null);
            }}
            onBlur={() => setHeaderAction(null)}
            placeholder={headerAction === 'folder' ? 'Folder name' : 'File name'}
            className="flex-1 bg-transparent border border-primary-500/50 rounded px-2 py-0.5 text-[12px] text-gray-200 outline-none placeholder-gray-600"
          />
        </div>
      )}

      {isExpanded && (
        <div className="pl-5">
          {loading && entries.length === 0 && (
            <p className="text-[12px] text-gray-500 py-2">Loading...</p>
          )}
          {entries.length > 0 && (
            <FileTree
              entries={entries}
              onFileClick={onFileClick}
              onDirectoryClick={handleDirectoryClick}
              onPinFile={onPinFile}
              onNewSessionInFolder={onNewSessionInFolder}
              onRefreshTree={() => { loaded.current = false; loadTree(); }}
            />
          )}
          {!loading && loaded.current && entries.length === 0 && (
            <p className="text-[12px] text-surface-600 py-2">Empty</p>
          )}
        </div>
      )}
    </div>
  );
}
