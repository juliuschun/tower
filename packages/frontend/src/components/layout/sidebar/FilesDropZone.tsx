import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useFileStore } from '../../../stores/file-store';
import { useSessionStore } from '../../../stores/session-store';
import { toastError, toastSuccess } from '../../../utils/toast';
import { useTranslation } from 'react-i18next';

export function FilesDropZone({ projects, onRefresh }: {
  projects: { id: string; name: string; rootPath?: string | null; color?: string }[];
  onRefresh: (path?: string) => void;
}) {
  const { t } = useTranslation('layout');
  const [dragOver, setDragOver] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<FileList | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const bumpRefreshTrigger = useFileStore((s) => s.bumpRefreshTrigger);
  const treeRoot = useFileStore((s) => s.treeRoot);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);

  const projectsWithPath = projects.filter(p => p.rootPath);

  const autoTargetProject = useMemo(() => {
    if (treeRoot) {
      const match = projectsWithPath.find(p =>
        treeRoot === p.rootPath || treeRoot.startsWith(p.rootPath + '/')
      );
      if (match) return match;
    }
    const activeSession = sessions.find(s => s.id === activeSessionId);
    if (activeSession?.projectId) {
      const match = projectsWithPath.find(p => p.id === activeSession.projectId);
      if (match) return match;
    }
    if (projectsWithPath.length === 1) return projectsWithPath[0];
    return null;
  }, [treeRoot, projectsWithPath, sessions, activeSessionId]);

  useEffect(() => {
    if (!showProjectPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowProjectPicker(false);
        setPendingFiles(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showProjectPicker]);

  const uploadToProject = async (targetDir: string, files: FileList, projectName?: string) => {
    const formData = new FormData();
    formData.append('targetDir', targetDir);
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
      if (ok.length > 0) toastSuccess(projectName ? `${ok.length} file(s) → ${projectName}` : `${ok.length} file(s) uploaded`);
      if (fail.length > 0) toastError(`${fail.length} failed`);
      bumpRefreshTrigger();
    } catch (err) {
      toastError(`Upload failed: ${err instanceof Error ? err.message : 'Network error'}`);
    }
    setShowProjectPicker(false);
    setPendingFiles(null);
  };

  const handleFilesReady = (files: FileList) => {
    if (autoTargetProject) {
      uploadToProject(autoTargetProject.rootPath!, files, autoTargetProject.name);
    } else if (projectsWithPath.length > 1) {
      setPendingFiles(files);
      setShowProjectPicker(true);
    } else {
      toastError('No project folder available');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.getData('application/x-attachment')) return;
    const files = e.dataTransfer.files;
    if (files.length === 0) return;
    handleFilesReady(files);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    handleFilesReady(files);
    e.target.value = '';
  };

  const targetLabel = autoTargetProject?.name;

  return (
    <div className="relative px-1 pb-2 pt-1 shrink-0">
      <div
        className={`border-2 border-dashed rounded-lg py-3 text-center cursor-pointer transition-all ${
          dragOver
            ? 'border-primary-500/60 bg-primary-900/10 text-primary-400'
            : 'border-surface-700/50 text-surface-600 hover:border-surface-600 hover:text-surface-500'
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
        onDrop={handleDrop}
      >
        <svg className="w-5 h-5 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="text-[11px]">{t('dropFilesOrClick')}</p>
        {targetLabel && (
          <p className="text-[9px] text-gray-500 mt-0.5">→ {targetLabel}</p>
        )}
      </div>
      <input ref={fileInputRef} type="file" multiple hidden onChange={handleInputChange} />

      {showProjectPicker && pendingFiles && (
        <div ref={pickerRef} className="absolute bottom-full left-1 right-1 mb-1 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 z-50">
          <div className="px-3 py-1.5 text-[10px] text-gray-500 font-medium">{t('uploadTo')}</div>
          {projectsWithPath.map(p => (
            <button
              key={p.id}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-primary-600/30 hover:text-white transition-colors"
              onClick={() => uploadToProject(p.rootPath!, pendingFiles, p.name)}
            >
              <svg className="w-3.5 h-3.5 text-yellow-400/70" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
