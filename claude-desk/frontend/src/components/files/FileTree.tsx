import React from 'react';
import type { FileEntry } from '../../stores/file-store';

interface FileTreeProps {
  entries: FileEntry[];
  onFileClick: (path: string) => void;
  onDirectoryClick: (path: string) => void;
  depth?: number;
}

const fileIcons: Record<string, string> = {
  ts: '🟦', tsx: '🟦', js: '🟨', jsx: '🟨',
  py: '🐍', md: '📝', json: '📋', yaml: '⚙️', yml: '⚙️',
  html: '🌐', css: '🎨', sh: '⚡', sql: '🗄️',
  txt: '📄', csv: '📊', log: '📋',
};

export function FileTree({ entries, onFileClick, onDirectoryClick, depth = 0 }: FileTreeProps) {
  return (
    <div className={depth > 0 ? 'ml-3' : ''}>
      {entries.map((entry) => (
        <div key={entry.path}>
          <button
            className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:bg-surface-800 rounded transition-colors"
            onClick={() => {
              if (entry.isDirectory) {
                onDirectoryClick(entry.path);
              } else {
                onFileClick(entry.path);
              }
            }}
          >
            {entry.isDirectory ? (
              <>
                <svg className={`w-3 h-3 text-gray-500 transition-transform ${entry.isExpanded ? 'rotate-90' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span>{entry.isExpanded ? '📂' : '📁'}</span>
              </>
            ) : (
              <>
                <span className="w-3" />
                <span>{fileIcons[entry.extension || ''] || '📄'}</span>
              </>
            )}
            <span className="truncate">{entry.name}</span>
            {entry.size !== undefined && !entry.isDirectory && (
              <span className="ml-auto text-[10px] text-gray-600">
                {entry.size < 1024 ? `${entry.size}B` : `${(entry.size / 1024).toFixed(1)}K`}
              </span>
            )}
          </button>
          {entry.isDirectory && entry.isExpanded && entry.children && (
            <FileTree
              entries={entry.children}
              onFileClick={onFileClick}
              onDirectoryClick={onDirectoryClick}
              depth={depth + 1}
            />
          )}
        </div>
      ))}
    </div>
  );
}
