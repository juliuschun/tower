import { useEffect } from 'react';
import { useSettingsStore, type ThemeId } from '../stores/settings-store';

/** Themes that qualify as "dark" for components that need to know (e.g. code editors) */
const DARK_THEMES: ThemeId[] = ['dark', 'ocean', 'forest', 'aurora'];

export function useTheme() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  // Apply data-theme attribute to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Listen for system preference changes (only when no saved preference)
  useEffect(() => {
    if (localStorage.getItem('theme')) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? 'light' : 'dark');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [setTheme]);

  // Initialize from system preference if no saved theme
  useEffect(() => {
    if (!localStorage.getItem('theme')) {
      const preferLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      setTheme(preferLight ? 'light' : 'dark');
    }
  }, [setTheme]);

  const isDark = DARK_THEMES.includes(theme);

  return { theme, setTheme, isDark };
}
