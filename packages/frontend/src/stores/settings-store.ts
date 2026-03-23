import { create } from 'zustand';

export interface ServerConfig {
  version: string;
  workspaceRoot: string;
  permissionMode: string;
  claudeExecutable: string;
}

export type ThemeId = 'dark' | 'light' | 'ocean' | 'forest' | 'aurora';

interface SettingsState {
  isOpen: boolean;
  skillsBrowserOpen: boolean;
  theme: ThemeId;
  serverConfig: ServerConfig | null;
  setOpen: (open: boolean) => void;
  setSkillsBrowserOpen: (open: boolean) => void;
  setTheme: (theme: ThemeId) => void;
  setServerConfig: (config: ServerConfig) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isOpen: false,
  skillsBrowserOpen: false,
  theme: (localStorage.getItem('theme') as ThemeId) || 'dark',
  serverConfig: null,
  setOpen: (open) => set({ isOpen: open }),
  setSkillsBrowserOpen: (open) => set({ skillsBrowserOpen: open }),
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    set({ theme });
  },
  setServerConfig: (config) => set({ serverConfig: config }),
}));
