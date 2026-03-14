import { create } from 'zustand';

export interface ModelOption {
  id: string;
  name: string;
  badge: string;
}

interface ModelState {
  availableModels: ModelOption[];
  piModels: ModelOption[];
  selectedModel: string;
  connectionType: string;

  setAvailableModels: (models: ModelOption[]) => void;
  setPiModels: (models: ModelOption[]) => void;
  setSelectedModel: (id: string) => void;
  setConnectionType: (type: string) => void;
}

const DEFAULT_MODEL = 'claude-opus-4-6';

export const useModelStore = create<ModelState>((set) => ({
  availableModels: [],
  piModels: [],
  selectedModel: localStorage.getItem('selectedModel') || DEFAULT_MODEL,
  connectionType: 'MAX',

  setAvailableModels: (models) => set({ availableModels: models }),
  setPiModels: (models) => set({ piModels: models }),
  setSelectedModel: (id) => {
    localStorage.setItem('selectedModel', id);
    set({ selectedModel: id });
  },
  setConnectionType: (type) => set({ connectionType: type }),
}));

/** Extract engine from model ID. 'pi:openrouter/...' → 'pi', otherwise 'claude' */
export function getEngineFromModel(modelId: string): 'claude' | 'pi' {
  return modelId.startsWith('pi:') ? 'pi' : 'claude';
}

/** Strip engine prefix from model ID for backend. 'pi:openrouter/...' → 'openrouter/...' */
export function getModelIdForBackend(modelId: string): string {
  return modelId.startsWith('pi:') ? modelId.slice(3) : modelId;
}
