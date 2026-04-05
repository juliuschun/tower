import { create } from 'zustand';
export type { Project } from '@tower/shared';
import type { Project } from '@tower/shared';

interface ProjectState {
  projects: Project[];
  collapsedProjects: Set<string>;
  collapsedLabels: Set<string>;   // key = "projectId::label"

  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  removeProject: (id: string) => void;
  toggleProjectCollapsed: (projectId: string) => void;
  toggleLabelCollapsed: (projectId: string, label: string) => void;
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

function loadCollapsedLabels(): Set<string> {
  try {
    const raw = localStorage.getItem('collapsedLabels');
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function saveCollapsedLabels(set: Set<string>) {
  localStorage.setItem('collapsedLabels', JSON.stringify([...set]));
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  collapsedProjects: loadCollapsed(),
  collapsedLabels: loadCollapsedLabels(),

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
  toggleLabelCollapsed: (projectId, label) =>
    set((s) => {
      const key = `${projectId}::${label}`;
      const next = new Set(s.collapsedLabels);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCollapsedLabels(next);
      return { collapsedLabels: next };
    }),
}));
