import { create } from 'zustand';

export interface ModelOption {
  id: string;
  name: string;
  badge: string;
}

export interface ModelDefaults {
  session: string;
  ai_reply: string;
  ai_task: string;
}

const DEFAULT_DEFAULTS: ModelDefaults = {
  session: 'claude-opus-4-6',
  ai_reply: 'claude-haiku-4-5-20251001',
  ai_task: 'claude-sonnet-4-6',
};

interface ModelState {
  availableModels: ModelOption[];
  piModels: ModelOption[];
  localModels: ModelOption[];
  selectedModel: string;
  connectionType: string;
  defaults: ModelDefaults;

  setAvailableModels: (models: ModelOption[]) => void;
  setPiModels: (models: ModelOption[]) => void;
  setLocalModels: (models: ModelOption[]) => void;
  setSelectedModel: (id: string) => void;
  setConnectionType: (type: string) => void;
  setDefaults: (defaults: ModelDefaults) => void;
}

export const useModelStore = create<ModelState>((set) => ({
  availableModels: [],
  piModels: [],
  localModels: [],
  selectedModel: localStorage.getItem('selectedModel') || DEFAULT_DEFAULTS.session,
  connectionType: 'MAX',
  defaults: DEFAULT_DEFAULTS,

  setAvailableModels: (models) => set({ availableModels: models }),
  setPiModels: (models) => set({ piModels: models }),
  setLocalModels: (models) => set({ localModels: models }),
  setSelectedModel: (id) => {
    localStorage.setItem('selectedModel', id);
    set({ selectedModel: id });
  },
  setConnectionType: (type) => set({ connectionType: type }),
  setDefaults: (defaults) => set({ defaults }),
}));

/** Extract engine from model ID. 'pi:...' → 'pi', 'local:...' → 'local', otherwise 'claude' */
export function getEngineFromModel(modelId: string): 'claude' | 'pi' | 'local' {
  if (modelId.startsWith('pi:')) return 'pi';
  if (modelId.startsWith('local:')) return 'local';
  return 'claude';
}

/** Strip engine prefix from model ID for backend. 'pi:openrouter/...' → 'openrouter/...', 'local:Qwen...' → 'Qwen...' */
export function getModelIdForBackend(modelId: string): string {
  if (modelId.startsWith('pi:')) return modelId.slice(3);
  if (modelId.startsWith('local:')) return modelId.slice(6);
  return modelId;
}
