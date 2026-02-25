import { create } from 'zustand';

export interface TaskMeta {
  id: string;
  title: string;
  description: string;
  cwd: string;
  status: 'todo' | 'in_progress' | 'done' | 'failed';
  sessionId: string | null;
  sortOrder: number;
  progressSummary: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface KanbanState {
  tasks: TaskMeta[];
  loading: boolean;

  setTasks: (tasks: TaskMeta[]) => void;
  addTask: (task: TaskMeta) => void;
  updateTask: (taskId: string, updates: Partial<TaskMeta>) => void;
  removeTask: (taskId: string) => void;
  moveTask: (taskId: string, newStatus: TaskMeta['status']) => void;
  setLoading: (loading: boolean) => void;
}

export const useKanbanStore = create<KanbanState>((set) => ({
  tasks: [],
  loading: false,

  setTasks: (tasks) => set({ tasks }),

  addTask: (task) => set((s) => ({ tasks: [...s.tasks, task] })),

  updateTask: (taskId, updates) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)),
    })),

  removeTask: (taskId) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== taskId) })),

  moveTask: (taskId, newStatus) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, status: newStatus, updatedAt: new Date().toISOString() } : t
      ),
    })),

  setLoading: (loading) => set({ loading }),
}));
