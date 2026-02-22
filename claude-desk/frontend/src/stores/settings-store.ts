import { create } from 'zustand';

export interface ServerConfig {
  version: string;
  workspaceRoot: string;
  permissionMode: string;
  claudeExecutable: string;
}

interface SettingsState {
  isOpen: boolean;
  theme: 'dark' | 'light';
  serverConfig: ServerConfig | null;
  setOpen: (open: boolean) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setServerConfig: (config: ServerConfig) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isOpen: false,
  theme: (localStorage.getItem('theme') as 'dark' | 'light') || 'dark',
  serverConfig: null,
  setOpen: (open) => set({ isOpen: open }),
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    set({ theme });
  },
  setServerConfig: (config) => set({ serverConfig: config }),
}));
