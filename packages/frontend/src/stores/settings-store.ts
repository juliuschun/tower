import { create } from 'zustand';

export interface ServerConfig {
  version: string;
  workspaceRoot: string;
  permissionMode: string;
  claudeExecutable: string;
}

export type ThemeId = 'dark' | 'light' | 'ocean' | 'forest' | 'aurora';
export type LangId = 'en' | 'ko';

interface SettingsState {
  isOpen: boolean;
  skillsBrowserOpen: boolean;
  helpOpen: boolean;
  theme: ThemeId;
  language: LangId;
  serverConfig: ServerConfig | null;
  setOpen: (open: boolean) => void;
  setSkillsBrowserOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  setTheme: (theme: ThemeId) => void;
  setLanguage: (lang: LangId) => void;
  setServerConfig: (config: ServerConfig) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isOpen: false,
  skillsBrowserOpen: false,
  helpOpen: false,
  theme: (localStorage.getItem('theme') as ThemeId) || 'dark',
  language: (localStorage.getItem('tower:lang') as LangId) || (navigator.language.startsWith('ko') ? 'ko' : 'en'),
  serverConfig: null,
  setOpen: (open) => set({ isOpen: open }),
  setSkillsBrowserOpen: (open) => set({ skillsBrowserOpen: open }),
  setHelpOpen: (open) => set({ helpOpen: open }),
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    set({ theme });
  },
  setLanguage: (language) => {
    localStorage.setItem('tower:lang', language);
    // i18n.changeLanguage is called from the component side
    set({ language });
  },
  setServerConfig: (config) => set({ serverConfig: config }),
}));
