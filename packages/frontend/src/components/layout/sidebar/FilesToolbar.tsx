import React, { useState, useEffect, useRef } from 'react';
import { useFileStore } from '../../../stores/file-store';
import { toastError, toastSuccess } from '../../../utils/toast';
import { useTranslation } from 'react-i18next';

/** Toggle button for multi-select mode */
function SelectModeToggle() {
  const selectMode = useFileStore((s) => s.selectMode);
  const toggleSelectMode = useFileStore((s) => s.toggleSelectMode);
  return (
    <button
      onClick={() => toggleSelectMode()}
      className={`p-1 rounded transition-colors ${
        selectMode
          ? 'text-primary-400 bg-primary-600/20'
          : 'text-surface-600 hover:text-primary-400 hover:bg-surface-800'
      }`}
      title={selectMode ? 'Exit select mode' : 'Select files (Ctrl+Click)'}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    </button>
  );
}

export function FilesToolbar({ onRefresh, projects }: { onRefresh: (path?: string) => void; projects: { id: string; name: string; rootPath?: string | null; color?: string }[] }) {
  const { t } = useTranslation('layout');
  const showHidden = useFileStore((s) => s.showHidden);
  const toggleShowHidden = useFileStore((s) => s.toggleShowHidden);
  const bumpRefreshTrigger = useFileStore((s) => s.bumpRefreshTrigger);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newType, setNewType] = useState<'file' | 'folder' | null>(null);
  const [targetProject, setTargetProject] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleToggleHidden = () => {
    toggleShowHidden();
    setTimeout(() => onRefresh(), 50);
  };

  // Close new-menu on outside click
  useEffect(() => {
    if (!newMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setNewMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [newMenuOpen]);

  // Auto-focus inline input
  useEffect(() => {
    if (newType) inputRef.current?.focus();
  }, [newType]);

  const projectsWithPath = projects.filter(p => p.rootPath);

  const handleNewAction = (type: 'file' | 'folder', projectRootPath: string) => {
    setNewType(type);
    setTargetProject(projectRootPath);
    setInputValue('');
    setNewMenuOpen(false);
  };

  const handleNewSubmit = async () => {
    const name = inputValue.trim();
    if (!name || !targetProject) { setNewType(null); return; }
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const fullPath = `${targetProject}/${name}`;
      const endpoint = newType === 'folder' ? '/api/files/mkdir' : '/api/files/create';
      const body = newType === 'folder' ? { path: fullPath } : { path: fullPath, content: '' };
      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      toastSuccess(`${name} created`);
      bumpRefreshTrigger();
    } catch (err: any) {
      toastError(err.message || 'Create failed');
    }
    setNewType(null);
    setTargetProject(null);
    setInputValue('');
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // Use first project with rootPath as default target
    const uploadTarget = projectsWithPath[0]?.rootPath;
    if (!uploadTarget) { toastError('No project folder available'); return; }

    const formData = new FormData();
    formData.append('targetDir', uploadTarget);
    for (const file of Array.from(files)) formData.append('files', file);
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/files/upload', { method: 'POST', headers, body: formData });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) { toastError(`Upload failed (${res.status}): server returned non-JSON response`); return; }
      const data = await res.json();
      if (!res.ok) { toastError(data.error || 'Upload failed'); return; }
      const ok = data.results.filter((r: any) => !r.error);
      const fail = data.results.filter((r: any) => r.error);
      if (ok.length > 0) toastSuccess(`${ok.length} file(s) uploaded`);
      if (fail.length > 0) toastError(`${fail.length} failed`);
      bumpRefreshTrigger();
    } catch (err) {
      toastError(`Upload failed: ${err instanceof Error ? err.message : 'Network error'}`);
    }
    e.target.value = '';
  };

  const iconBtnClass = 'p-1 rounded text-surface-600 hover:text-primary-400 hover:bg-surface-800 transition-colors';
  const actionBtnClass = 'flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors';

  return (
    <div className="px-1 pt-1 pb-1 space-y-1">
      {/* Action buttons row */}
      <div className="flex items-center gap-1">
        {/* New button with dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setNewMenuOpen(!newMenuOpen)}
            className={`${actionBtnClass} text-gray-400 hover:text-primary-300 hover:bg-surface-800`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t('new')}
          </button>
          {newMenuOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 min-w-[180px]">
              {projectsWithPath.map(p => (
                <div key={p.id}>
                  <div className="px-3 py-1 text-[10px] text-gray-500 font-medium truncate">{p.name}</div>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-primary-600/30 hover:text-white"
                    onClick={() => handleNewAction('file', p.rootPath!)}
                  >
                    <svg className="w-3.5 h-3.5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {t('newFile')}
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-primary-600/30 hover:text-white"
                    onClick={() => handleNewAction('folder', p.rootPath!)}
                  >
                    <svg className="w-3.5 h-3.5 text-yellow-400/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                    </svg>
                    {t('newFolder')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upload button */}
        <button
          onClick={handleUploadClick}
          className={`${actionBtnClass} text-gray-400 hover:text-green-300 hover:bg-surface-800`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          {t('upload')}
        </button>
        <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileUpload} />

        <div className="flex-1" />

        {/* Show hidden toggle */}
        <button
          onClick={handleToggleHidden}
          className={`${iconBtnClass} ${showHidden ? '!text-primary-400' : ''}`}
          title={showHidden ? t('hideDotfiles') : t('showDotfiles')}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {showHidden ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            )}
          </svg>
        </button>
        {/* Select mode toggle */}
        <SelectModeToggle />
        {/* Refresh */}
        <button onClick={() => onRefresh()} className={iconBtnClass} title="Refresh all">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Inline input for new file/folder (appears when creating from toolbar) */}
      {newType && targetProject && (
        <div className="flex items-center gap-1.5 px-1 py-0.5 bg-surface-850 rounded-md">
          {newType === 'folder' ? (
            <svg className="w-3.5 h-3.5 text-yellow-400/70 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-primary-400/70 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          )}
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNewSubmit();
              if (e.key === 'Escape') { setNewType(null); setTargetProject(null); }
            }}
            onBlur={() => { setNewType(null); setTargetProject(null); }}
            placeholder={newType === 'folder' ? t('enterFolderName') : t('enterFileName')}
            className="flex-1 bg-transparent border border-primary-500/50 rounded px-2 py-0.5 text-[12px] text-gray-200 outline-none placeholder-gray-600"
          />
          <span className="text-[9px] text-gray-600 truncate max-w-[80px]">
            in {targetProject.split('/').pop()}
          </span>
        </div>
      )}
    </div>
  );
}
