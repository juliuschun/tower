export const CHART_COLORS = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
];

export function getChartColors(custom?: string[]): string[] {
  return custom && custom.length > 0 ? custom : CHART_COLORS;
}

export const DARK_THEME = {
  background: 'transparent',
  text: '#9ca3af',
  grid: '#374151',
  tooltip: {
    bg: '#1f2937',
    border: '#374151',
    text: '#f3f4f6',
  },
};

export const LIGHT_THEME = {
  background: 'transparent',
  text: '#6b7280',
  grid: '#e5e7eb',
  tooltip: {
    bg: '#ffffff',
    border: '#e5e7eb',
    text: '#111827',
  },
};

export function getTheme(mode: string) {
  return mode === 'light' ? LIGHT_THEME : DARK_THEME;
}
