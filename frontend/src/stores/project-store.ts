import { create } from 'zustand';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  rootPath: string | null;
  color: string;
  sortOrder: number;
  collapsed: number;
  archived: number;
  createdAt: string;
}

interface ProjectState {
  projects: Project[];
  collapsedProjects: Set<string>;

  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  removeProject: (id: string) => void;
  toggleProjectCollapsed: (projectId: string) => void;
}

// Persist collapsed state in localStorage
function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem('collapsedProjects');
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function saveCollapsed(set: Set<string>) {
  localStorage.setItem('collapsedProjects', JSON.stringify([...set]));
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  collapsedProjects: loadCollapsed(),

  setProjects: (projects) => set({ projects }),
  addProject: (project) => set((s) => ({ projects: [...s.projects, project] })),
  updateProject: (id, updates) =>
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    })),
  removeProject: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
  toggleProjectCollapsed: (projectId) =>
    set((s) => {
      const next = new Set(s.collapsedProjects);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      saveCollapsed(next);
      return { collapsedProjects: next };
    }),
}));
