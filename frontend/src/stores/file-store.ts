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
  isLoading?: boolean;
}

export interface OpenFile {
  path: string;
  content: string;
  language: string;
  modified: boolean;
  encoding?: string;
}

export interface ExternalChange {
  path: string;
  detectedAt: number;
}

interface FileState {
  tree: FileEntry[];
  treeRoot: string;
  openFile: OpenFile | null;
  contextPanelOpen: boolean;
  contextPanelExpanded: boolean;
  contextPanelTab: 'preview' | 'editor' | 'python';
  lastOpenedFilePath: string | null;
  originalContent: string | null;
  externalChange: ExternalChange | null;

  setTree: (entries: FileEntry[]) => void;
  setTreeRoot: (path: string) => void;
  setOpenFile: (file: OpenFile | null) => void;
  updateOpenFileContent: (content: string) => void;
  setContextPanelOpen: (open: boolean) => void;
  setContextPanelExpanded: (expanded: boolean) => void;
  setContextPanelTab: (tab: 'preview' | 'editor' | 'python') => void;
  toggleDirectory: (path: string) => void;
  setDirectoryChildren: (dirPath: string, children: FileEntry[]) => void;
  setDirectoryLoading: (dirPath: string, loading: boolean) => void;
  handleFileChange: (event: string, filePath: string) => void;
  markSaved: () => void;
  setExternalChange: (change: ExternalChange | null) => void;
  reloadFromDisk: (content: string) => void;
  keepLocalEdits: () => void;
}

export const useFileStore = create<FileState>((set, get) => ({
  tree: [],
  treeRoot: '',
  openFile: null,
  contextPanelOpen: false,
  contextPanelExpanded: false,
  contextPanelTab: 'preview',
  lastOpenedFilePath: null,
  originalContent: null,
  externalChange: null,

  setTree: (entries) => set({ tree: entries }),
  setTreeRoot: (path) => set({ treeRoot: path }),
  setOpenFile: (file) => {
    if (file) {
      const shouldExpand = file.language === 'html' || file.language === 'pdf';
      set({
        openFile: file,
        contextPanelOpen: true,
        contextPanelExpanded: shouldExpand,
        lastOpenedFilePath: file.path,
        originalContent: file.content,
        externalChange: null,
      });
    } else {
      // Close panel but keep lastOpenedFilePath
      set({ openFile: null, contextPanelOpen: false, contextPanelExpanded: false, originalContent: null, externalChange: null });
    }
  },
  updateOpenFileContent: (content) =>
    set((s) => {
      if (!s.openFile) return {};
      const modified = content !== s.originalContent;
      return { openFile: { ...s.openFile, content, modified } };
    }),
  setContextPanelOpen: (open) => set({ contextPanelOpen: open }),
  setContextPanelExpanded: (expanded) => set({ contextPanelExpanded: expanded }),
  setContextPanelTab: (tab) => set({ contextPanelTab: tab }),

  markSaved: () =>
    set((s) => s.openFile
      ? { openFile: { ...s.openFile, modified: false }, originalContent: s.openFile.content }
      : {}),

  setExternalChange: (change) => set({ externalChange: change }),

  reloadFromDisk: (content) =>
    set((s) => s.openFile
      ? { openFile: { ...s.openFile, content, modified: false }, originalContent: content, externalChange: null }
      : {}),

  keepLocalEdits: () => set({ externalChange: null }),

  toggleDirectory: (dirPath) =>
    set((s) => ({
      tree: toggleDir(s.tree, dirPath),
    })),

  setDirectoryChildren: (dirPath, children) =>
    set((s) => ({
      tree: setChildren(s.tree, dirPath, children),
    })),

  setDirectoryLoading: (dirPath, loading) =>
    set((s) => ({
      tree: setLoading(s.tree, dirPath, loading),
    })),

  handleFileChange: (event, filePath) => {
    const state = get();
    // Find parent directory of the changed file
    const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));

    // If the change is in a currently expanded directory, we need a refresh
    // The tree will be refreshed via requestFileTree from the hook
    // For now, mark the tree as needing refresh by triggering a re-render
    if (event === 'unlink' || event === 'unlinkDir') {
      // Remove from tree
      set({ tree: removeFromTree(state.tree, filePath) });
    }
    // For 'add', 'addDir', 'change' — the parent will be re-fetched
  },
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

function setChildren(entries: FileEntry[], dirPath: string, children: FileEntry[]): FileEntry[] {
  return entries.map((e) => {
    if (e.path === dirPath) {
      return { ...e, children, isExpanded: true, isLoading: false };
    }
    if (e.children) {
      return { ...e, children: setChildren(e.children, dirPath, children) };
    }
    return e;
  });
}

function setLoading(entries: FileEntry[], dirPath: string, loading: boolean): FileEntry[] {
  return entries.map((e) => {
    if (e.path === dirPath) {
      return { ...e, isLoading: loading };
    }
    if (e.children) {
      return { ...e, children: setLoading(e.children, dirPath, loading) };
    }
    return e;
  });
}

function removeFromTree(entries: FileEntry[], filePath: string): FileEntry[] {
  return entries
    .filter((e) => e.path !== filePath)
    .map((e) => {
      if (e.children) {
        return { ...e, children: removeFromTree(e.children, filePath) };
      }
      return e;
    });
}
