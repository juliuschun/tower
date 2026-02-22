import { create } from 'zustand';

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  authorName: string;
  message: string;
  commitType: 'auto' | 'manual' | 'rollback';
  filesChanged: string[];
  createdAt: string;
}

interface GitState {
  commits: GitCommitInfo[];
  isLoading: boolean;
  expandedCommit: string | null;

  setCommits: (commits: GitCommitInfo[]) => void;
  addCommit: (commit: GitCommitInfo) => void;
  appendCommits: (commits: GitCommitInfo[]) => void;
  setLoading: (loading: boolean) => void;
  setExpandedCommit: (hash: string | null) => void;
}

export const useGitStore = create<GitState>((set) => ({
  commits: [],
  isLoading: false,
  expandedCommit: null,

  setCommits: (commits) => set({ commits }),
  addCommit: (commit) => set((s) => ({ commits: [commit, ...s.commits] })),
  appendCommits: (commits) => set((s) => ({ commits: [...s.commits, ...commits] })),
  setLoading: (loading) => set({ isLoading: loading }),
  setExpandedCommit: (hash) => set((s) => ({
    expandedCommit: s.expandedCommit === hash ? null : hash,
  })),
}));
