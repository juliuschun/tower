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

// ─── Expanded paths persistence ───
const EXPANDED_KEY = 'fileTree:expandedPaths';

function loadExpandedPaths(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function saveExpandedPaths(paths: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...paths]));
  } catch {}
}

/** Apply persisted expanded state to a flat entry list (top-level only) */
function applyExpandedState(entries: FileEntry[], expandedPaths: Set<string>): FileEntry[] {
  return entries.map((e) => {
    if (e.isDirectory && expandedPaths.has(e.path)) {
      return { ...e, isExpanded: true };
    }
    return e;
  });
}

/** Collect all expanded directory paths from the tree recursively */
function collectExpandedPaths(entries: FileEntry[], result: Set<string>): void {
  for (const e of entries) {
    if (e.isDirectory && e.isExpanded) {
      result.add(e.path);
    }
    if (e.children) {
      collectExpandedPaths(e.children, result);
    }
  }
}

interface FileState {
  tree: FileEntry[];
  treeRoot: string;
  expandedPaths: Set<string>;
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
  expandedPaths: loadExpandedPaths(),
  openFile: null,
  contextPanelOpen: false,
  contextPanelExpanded: false,
  contextPanelTab: 'preview',
  lastOpenedFilePath: null,
  originalContent: null,
  externalChange: null,

  setTree: (entries) => {
    const { expandedPaths } = get();
    // Restore expanded state from persisted set
    const restored = applyExpandedState(entries, expandedPaths);
    set({ tree: restored });
  },

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
    set((s) => {
      const newTree = toggleDir(s.tree, dirPath);
      // Update persisted expanded paths
      const newExpanded = new Set(s.expandedPaths);
      if (newExpanded.has(dirPath)) {
        newExpanded.delete(dirPath);
      } else {
        newExpanded.add(dirPath);
      }
      saveExpandedPaths(newExpanded);
      return { tree: newTree, expandedPaths: newExpanded };
    }),

  setDirectoryChildren: (dirPath, children) =>
    set((s) => {
      // Apply expanded state to children as well
      const restoredChildren = applyExpandedState(children, s.expandedPaths);
      const newTree = setChildren(s.tree, dirPath, restoredChildren);
      // Ensure this dir is marked expanded
      const newExpanded = new Set(s.expandedPaths);
      newExpanded.add(dirPath);
      saveExpandedPaths(newExpanded);
      return { tree: newTree, expandedPaths: newExpanded };
    }),

  setDirectoryLoading: (dirPath, loading) =>
    set((s) => ({
      tree: setLoading(s.tree, dirPath, loading),
    })),

  handleFileChange: (event, filePath) => {
    const state = get();
    if (event === 'unlink' || event === 'unlinkDir') {
      // Remove from tree and expanded paths
      const newExpanded = new Set(state.expandedPaths);
      newExpanded.delete(filePath);
      saveExpandedPaths(newExpanded);
      set({ tree: removeFromTree(state.tree, filePath), expandedPaths: newExpanded });
    }
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
