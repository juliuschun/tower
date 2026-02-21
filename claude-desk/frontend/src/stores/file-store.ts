import { create } from 'zustand';

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
  extension?: string;
  children?: FileEntry[];
  isExpanded?: boolean;
}

export interface OpenFile {
  path: string;
  content: string;
  language: string;
  modified: boolean;
}

interface FileState {
  tree: FileEntry[];
  currentPath: string;
  openFile: OpenFile | null;
  contextPanelOpen: boolean;
  contextPanelTab: 'preview' | 'editor' | 'python';

  setTree: (entries: FileEntry[]) => void;
  setCurrentPath: (path: string) => void;
  setOpenFile: (file: OpenFile | null) => void;
  updateOpenFileContent: (content: string) => void;
  setContextPanelOpen: (open: boolean) => void;
  setContextPanelTab: (tab: 'preview' | 'editor' | 'python') => void;
  toggleDirectory: (path: string) => void;
}

export const useFileStore = create<FileState>((set) => ({
  tree: [],
  currentPath: '',
  openFile: null,
  contextPanelOpen: false,
  contextPanelTab: 'preview',

  setTree: (entries) => set({ tree: entries }),
  setCurrentPath: (path) => set({ currentPath: path }),
  setOpenFile: (file) => set({ openFile: file, contextPanelOpen: !!file }),
  updateOpenFileContent: (content) =>
    set((s) => s.openFile ? { openFile: { ...s.openFile, content, modified: true } } : {}),
  setContextPanelOpen: (open) => set({ contextPanelOpen: open }),
  setContextPanelTab: (tab) => set({ contextPanelTab: tab }),
  toggleDirectory: (dirPath) =>
    set((s) => ({
      tree: toggleDir(s.tree, dirPath),
    })),
}));

function toggleDir(entries: FileEntry[], dirPath: string): FileEntry[] {
  return entries.map((e) => {
    if (e.path === dirPath) {
      return { ...e, isExpanded: !e.isExpanded };
    }
    if (e.children) {
      return { ...e, children: toggleDir(e.children, dirPath) };
    }
    return e;
  });
}
