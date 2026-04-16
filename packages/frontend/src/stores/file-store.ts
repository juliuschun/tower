import { create } from 'zustand';
import type { FileEntry as FileEntryBase } from '@tower/shared';

export interface FileEntry extends FileEntryBase {
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

export interface FileTab {
  id: string;              // crypto.randomUUID()
  path: string;
  content: string;
  language: string;
  modified: boolean;
  encoding?: string;
  scrollPos?: number;      // 탭별 스크롤 위치 기억
  pinned: boolean;         // true = 고정 탭, false = 임시 탭 (싱글 클릭)
}

export interface ExternalChange {
  path: string;
  detectedAt: number;
}

// ─── Expanded paths persistence (per-user) ───
function getUserKey(): string {
  try {
    const token = localStorage.getItem('token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.username) return `fileTree:expandedPaths:${payload.username}`;
    }
  } catch {}
  return 'fileTree:expandedPaths';
}

function loadExpandedPaths(): Set<string> {
  try {
    const raw = localStorage.getItem(getUserKey());
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function saveExpandedPaths(paths: Set<string>): void {
  try {
    localStorage.setItem(getUserKey(), JSON.stringify([...paths]));
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

// ─── Expanded projects persistence (per-user) ───
function getProjectsKey(): string {
  try {
    const token = localStorage.getItem('token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.username) return `fileTree:expandedProjects:${payload.username}`;
    }
  } catch {}
  return 'fileTree:expandedProjects';
}

function loadExpandedProjects(): Set<string> {
  try {
    const key = getProjectsKey();
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      console.log('[file-store] loadExpandedProjects:', key, parsed);
      return new Set(parsed);
    }
    console.log('[file-store] loadExpandedProjects: no saved data, key=', key);
  } catch (e) {
    console.error('[file-store] loadExpandedProjects error:', e);
  }
  return new Set();
}

function saveExpandedProjects(projects: Set<string>): void {
  try {
    localStorage.setItem(getProjectsKey(), JSON.stringify([...projects]));
  } catch {}
}

// ─── Show hidden files preference (per-user) ───
function getShowHiddenKey(): string {
  try {
    const token = localStorage.getItem('token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.username) return `fileTree:showHidden:${payload.username}`;
    }
  } catch {}
  return 'fileTree:showHidden';
}

function loadShowHidden(): boolean {
  try {
    return localStorage.getItem(getShowHiddenKey()) === 'true';
  } catch {}
  return false;
}

function saveShowHidden(show: boolean): void {
  try {
    localStorage.setItem(getShowHiddenKey(), String(show));
  } catch {}
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
  /** Incremented on file_changed WS events — ProjectFileSection subscribes to auto-refresh */
  refreshTrigger: number;
  /** Set of project IDs whose file sections are expanded (persisted) */
  expandedProjects: Set<string>;
  /** Whether to show hidden/dotfiles in the file tree */
  showHidden: boolean;

  // ─── Tab state ───
  tabs: FileTab[];
  activeTabId: string | null;

  // ─── Navigation history (back/forward within file viewer) ───
  navHistory: string[];   // list of file paths visited
  navIndex: number;       // current position in history (-1 = none)

  // ─── Multi-select state ───
  /** Set of selected file/folder paths */
  selectedPaths: Set<string>;
  /** Whether multi-select mode is active */
  selectMode: boolean;
  /** Last clicked path for Shift range selection */
  lastClickedPath: string | null;

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
  /** Trigger a refresh for ProjectFileSection components */
  bumpRefreshTrigger: () => void;
  /** Toggle a project's expanded/collapsed state in the file tab */
  toggleProjectExpanded: (projectId: string) => void;
  /** Check if a project section is expanded */
  isProjectExpanded: (projectId: string) => boolean;
  /** Toggle show hidden files */
  toggleShowHidden: () => void;

  // ─── Tab actions ───
  openTab: (path: string, content: string, language: string, encoding?: string) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (id: string) => void;
  updateTabContent: (id: string, content: string) => void;
  markTabSaved: (id: string) => void;
  pinTab: (id: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateTabScroll: (id: string, scrollPos: number) => void;

  // ─── Navigation history actions ───
  /** Push a path to nav history (called when navigating via link click) */
  navPush: (path: string) => void;
  /** Go back in navigation history */
  navBack: () => string | null;
  /** Go forward in navigation history */
  navForward: () => string | null;
  /** Check if can go back/forward */
  canNavBack: () => boolean;
  canNavForward: () => boolean;

  // ─── Multi-select actions ───
  /** Toggle select mode on/off */
  toggleSelectMode: () => void;
  /** Toggle a single path's selection (Ctrl+Click) */
  toggleSelectPath: (path: string) => void;
  /** Range select from lastClickedPath to given path (Shift+Click) */
  rangeSelectTo: (path: string, flatPaths: string[]) => void;
  /** Bulk add or remove paths (for folder select/deselect) */
  bulkTogglePaths: (paths: string[], selected: boolean) => void;
  /** Clear all selections */
  clearSelection: () => void;
  /** Set last clicked path (for Shift range base) */
  setLastClickedPath: (path: string) => void;
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
  refreshTrigger: 0,
  expandedProjects: loadExpandedProjects(),
  showHidden: loadShowHidden(),

  // ─── Tab state ───
  tabs: [],
  activeTabId: null,

  // ─── Navigation history ───
  navHistory: [],
  navIndex: -1,

  // ─── Multi-select state ───
  selectedPaths: new Set(),
  selectMode: false,
  lastClickedPath: null,

  setTree: (entries) => {
    const { expandedPaths } = get();
    // Restore expanded state from persisted set
    const restored = applyExpandedState(entries, expandedPaths);
    set({ tree: restored });
  },

  setTreeRoot: (path) => set({ treeRoot: path }),
  setOpenFile: (file) => {
    if (file) {
      // Delegate to openTab for tab system integration
      get().openTab(file.path, file.content, file.language, file.encoding);
    } else {
      // Close active tab
      const { activeTabId } = get();
      if (activeTabId) {
        get().closeTab(activeTabId);
      } else {
        set({ openFile: null, contextPanelOpen: false, contextPanelExpanded: false, originalContent: null, externalChange: null });
      }
    }
  },
  updateOpenFileContent: (content) => {
    const { activeTabId } = get();
    if (activeTabId) {
      get().updateTabContent(activeTabId, content);
    }
  },
  setContextPanelOpen: (open) => set({ contextPanelOpen: open }),
  setContextPanelExpanded: (expanded) => set({ contextPanelExpanded: expanded }),
  setContextPanelTab: (tab) => set({ contextPanelTab: tab }),

  markSaved: () => {
    const { activeTabId } = get();
    if (activeTabId) {
      get().markTabSaved(activeTabId);
    } else {
      set((s) => s.openFile
        ? { openFile: { ...s.openFile, modified: false }, originalContent: s.openFile.content }
        : {});
    }
  },

  setExternalChange: (change) => set({ externalChange: change }),

  reloadFromDisk: (content) =>
    set((s) => {
      const update: any = s.openFile
        ? { openFile: { ...s.openFile, content, modified: false }, originalContent: content, externalChange: null }
        : {};
      // Sync active tab
      if (s.activeTabId) {
        update.tabs = s.tabs.map(t =>
          t.id === s.activeTabId ? { ...t, content, modified: false } : t
        );
      }
      return update;
    }),

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

  bumpRefreshTrigger: () => set((s) => ({ refreshTrigger: s.refreshTrigger + 1 })),

  toggleProjectExpanded: (projectId) =>
    set((s) => {
      const newSet = new Set(s.expandedProjects);
      if (newSet.has(projectId)) {
        newSet.delete(projectId);
      } else {
        newSet.add(projectId);
      }
      console.log('[file-store] toggleProjectExpanded:', projectId, 'now expanded:', [...newSet]);
      saveExpandedProjects(newSet);
      return { expandedProjects: newSet };
    }),

  isProjectExpanded: (projectId) => get().expandedProjects.has(projectId),

  toggleShowHidden: () =>
    set((s) => {
      const next = !s.showHidden;
      saveShowHidden(next);
      return { showHidden: next, refreshTrigger: s.refreshTrigger + 1 };
    }),

  // ─── Tab actions ───
  // Single click → replaces the unpinned (temporary) tab
  // Double click or edit → pins the tab so it won't be replaced
  openTab: (path, content, language, encoding) => set((s) => {
    // Already open → focus (and ensure panel is visible)
    const existing = s.tabs.find(t => t.path === path);
    if (existing) {
      return {
        activeTabId: existing.id,
        openFile: { path: existing.path, content: existing.content, language: existing.language, modified: existing.modified, encoding: existing.encoding },
        lastOpenedFilePath: existing.path,
        originalContent: existing.content,
        contextPanelOpen: true,
      };
    }

    // Find existing unpinned (temporary) tab to replace
    const tempIdx = s.tabs.findIndex(t => !t.pinned);
    const newTab: FileTab = {
      id: crypto.randomUUID(),
      path,
      content,
      language,
      modified: false,
      encoding,
      pinned: false,  // new tabs start as temporary
    };

    let newTabs: FileTab[];
    if (tempIdx !== -1) {
      // Replace the temporary tab in-place
      newTabs = [...s.tabs];
      newTabs[tempIdx] = newTab;
    } else {
      // All tabs are pinned — add new temporary tab
      newTabs = [...s.tabs, newTab];
    }

    return {
      tabs: newTabs,
      activeTabId: newTab.id,
      openFile: { path, content, language, modified: false, encoding },
      contextPanelOpen: true,
      lastOpenedFilePath: path,
      originalContent: content,
      externalChange: null,
    };
  }),

  closeTab: (id) => set((s) => {
    const tab = s.tabs.find(t => t.id === id);
    if (!tab) return {};

    const newTabs = s.tabs.filter(t => t.id !== id);

    // If closing active tab, switch to adjacent
    let newActiveId = s.activeTabId;
    if (s.activeTabId === id) {
      if (newTabs.length === 0) {
        newActiveId = null;
      } else {
        const closedIdx = s.tabs.findIndex(t => t.id === id);
        const nextIdx = Math.min(closedIdx, newTabs.length - 1);
        newActiveId = newTabs[nextIdx].id;
      }
    }

    const activeTab = newActiveId ? newTabs.find(t => t.id === newActiveId) : null;

    return {
      tabs: newTabs,
      activeTabId: newActiveId,
      openFile: activeTab
        ? { path: activeTab.path, content: activeTab.content, language: activeTab.language, modified: activeTab.modified, encoding: activeTab.encoding }
        : null,
      contextPanelOpen: newTabs.length > 0,
      contextPanelExpanded: newTabs.length === 0 ? false : s.contextPanelExpanded,
      originalContent: activeTab?.content ?? null,
    };
  }),

  closeOtherTabs: (id) => set((s) => {
    const keep = s.tabs.filter(t => t.id === id);
    const tab = keep[0];
    return {
      tabs: keep,
      activeTabId: id,
      openFile: tab ? { path: tab.path, content: tab.content, language: tab.language, modified: tab.modified, encoding: tab.encoding } : s.openFile,
    };
  }),

  closeAllTabs: () => set({
    tabs: [],
    activeTabId: null,
    openFile: null,
    contextPanelOpen: false,
    contextPanelExpanded: false,
    originalContent: null,
  }),

  setActiveTab: (id) => set((s) => {
    const tab = s.tabs.find(t => t.id === id);
    if (!tab) return {};
    return {
      activeTabId: id,
      openFile: { path: tab.path, content: tab.content, language: tab.language, modified: tab.modified, encoding: tab.encoding },
      lastOpenedFilePath: tab.path,
      originalContent: tab.content,
      contextPanelExpanded: ['html', 'pdf', 'image', 'video'].includes(tab.language),
    };
  }),

  updateTabContent: (id, content) => set((s) => {
    const newTabs = s.tabs.map(t => {
      if (t.id !== id) return t;
      const modified = content !== s.originalContent;
      // Editing auto-pins the tab
      return { ...t, content, modified, pinned: true };
    });
    const activeTab = newTabs.find(t => t.id === s.activeTabId);
    return {
      tabs: newTabs,
      openFile: s.activeTabId === id && activeTab
        ? { path: activeTab.path, content: activeTab.content, language: activeTab.language, modified: activeTab.modified, encoding: activeTab.encoding }
        : s.openFile,
    };
  }),

  pinTab: (id) => set((s) => ({
    tabs: s.tabs.map(t => t.id === id ? { ...t, pinned: true } : t),
  })),

  markTabSaved: (id) => set((s) => {
    const tab = s.tabs.find(t => t.id === id);
    if (!tab) return {};
    const newTabs = s.tabs.map(t =>
      t.id === id ? { ...t, modified: false } : t
    );
    return {
      tabs: newTabs,
      originalContent: tab.content,
      openFile: s.activeTabId === id
        ? { path: tab.path, content: tab.content, language: tab.language, modified: false, encoding: tab.encoding }
        : s.openFile,
    };
  }),

  reorderTabs: (fromIndex, toIndex) => set((s) => {
    const newTabs = [...s.tabs];
    const [moved] = newTabs.splice(fromIndex, 1);
    newTabs.splice(toIndex, 0, moved);
    return { tabs: newTabs };
  }),

  updateTabScroll: (id, scrollPos) => set((s) => ({
    tabs: s.tabs.map(t => t.id === id ? { ...t, scrollPos } : t),
  })),

  // ─── Multi-select actions ───
  toggleSelectMode: () =>
    set((s) => {
      const next = !s.selectMode;
      if (!next) {
        // Exiting select mode → clear selections
        return { selectMode: false, selectedPaths: new Set(), lastClickedPath: null };
      }
      return { selectMode: true };
    }),

  toggleSelectPath: (path) =>
    set((s) => {
      const next = new Set(s.selectedPaths);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return { selectedPaths: next, lastClickedPath: path };
    }),

  rangeSelectTo: (path, flatPaths) =>
    set((s) => {
      const anchor = s.lastClickedPath;
      if (!anchor) {
        // No anchor — just select the clicked path
        const next = new Set(s.selectedPaths);
        next.add(path);
        return { selectedPaths: next, lastClickedPath: path };
      }
      const startIdx = flatPaths.indexOf(anchor);
      const endIdx = flatPaths.indexOf(path);
      if (startIdx === -1 || endIdx === -1) {
        const next = new Set(s.selectedPaths);
        next.add(path);
        return { selectedPaths: next, lastClickedPath: path };
      }
      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      const next = new Set(s.selectedPaths);
      for (let i = lo; i <= hi; i++) {
        next.add(flatPaths[i]);
      }
      return { selectedPaths: next };
    }),

  bulkTogglePaths: (paths, selected) =>
    set((s) => {
      const next = new Set(s.selectedPaths);
      for (const p of paths) {
        if (selected) next.add(p); else next.delete(p);
      }
      return { selectedPaths: next };
    }),

  clearSelection: () =>
    set({ selectedPaths: new Set(), lastClickedPath: null }),

  setLastClickedPath: (path) =>
    set({ lastClickedPath: path }),

  // ─── Navigation history ───
  navPush: (path) => set((s) => {
    // If same as current position, skip
    if (s.navIndex >= 0 && s.navHistory[s.navIndex] === path) return {};
    // Truncate forward history and push new path
    const newHistory = [...s.navHistory.slice(0, s.navIndex + 1), path];
    // Limit history size to 50
    const trimmed = newHistory.length > 50 ? newHistory.slice(-50) : newHistory;
    return { navHistory: trimmed, navIndex: trimmed.length - 1 };
  }),

  navBack: () => {
    const s = get();
    if (s.navIndex <= 0) return null;
    const newIndex = s.navIndex - 1;
    const path = s.navHistory[newIndex];
    set({ navIndex: newIndex });
    return path;
  },

  navForward: () => {
    const s = get();
    if (s.navIndex >= s.navHistory.length - 1) return null;
    const newIndex = s.navIndex + 1;
    const path = s.navHistory[newIndex];
    set({ navIndex: newIndex });
    return path;
  },

  canNavBack: () => {
    const s = get();
    return s.navIndex > 0;
  },

  canNavForward: () => {
    const s = get();
    return s.navIndex < s.navHistory.length - 1;
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
