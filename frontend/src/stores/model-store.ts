import { create } from 'zustand';

export interface ModelOption {
  id: string;
  name: string;
  badge: string;
}

interface ModelState {
  availableModels: ModelOption[];
  selectedModel: string;
  connectionType: string;

  setAvailableModels: (models: ModelOption[]) => void;
  setSelectedModel: (id: string) => void;
  setConnectionType: (type: string) => void;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export const useModelStore = create<ModelState>((set) => ({
  availableModels: [],
  selectedModel: localStorage.getItem('selectedModel') || DEFAULT_MODEL,
  connectionType: 'MAX',

  setAvailableModels: (models) => set({ availableModels: models }),
  setSelectedModel: (id) => {
    localStorage.setItem('selectedModel', id);
    set({ selectedModel: id });
  },
  setConnectionType: (type) => set({ connectionType: type }),
}));
