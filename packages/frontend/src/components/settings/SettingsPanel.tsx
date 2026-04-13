import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore, type LangId, type FontSize } from '../../stores/settings-store';
import { useSessionStore } from '../../stores/session-store';
import { OAuthConnections } from './OAuthConnections';

// Simple error boundary to prevent OAuthConnections from crashing the whole Settings modal
class OAuthErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error?: string }> {
  state = { hasError: false, error: undefined as string | undefined };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <section>
          <h3 className="text-[12px] font-semibold text-surface-500 uppercase tracking-wider mb-3">Connections</h3>
          <div className="text-[10px] text-red-400 p-2 border border-red-500/20 rounded-lg">
            Error: {this.state.error}
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}

export function SettingsPanel() {
  const { t, i18n } = useTranslation('settings');
  const isOpen = useSettingsStore((s) => s.isOpen);
  const setOpen = useSettingsStore((s) => s.setOpen);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const isMobile = useSessionStore((s) => s.isMobile);
  const activeView = useSessionStore((s) => s.activeView);
  const setActiveView = useSessionStore((s) => s.setActiveView);

  const handleLanguageChange = (lang: LangId) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div className="relative bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-[calc(100vw-32px)] max-w-[360px] max-h-[80vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-800">
          <h2 className="text-[15px] font-bold text-gray-100">{t('settings')}</h2>
          <button
            onClick={() => setOpen(false)}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* Language selector */}
          <section>
            <h3 className="text-[12px] font-semibold text-surface-500 uppercase tracking-wider mb-3">{t('language')}</h3>
            <div className="flex gap-2">
              {(['en', 'ko'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => handleLanguageChange(lang)}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${
                    language === lang
                      ? 'bg-surface-800 border-primary-500 text-primary-400'
                      : 'bg-surface-900 border-surface-700 text-surface-500 hover:border-surface-600'
                  }`}
                >
                  {lang === 'en' ? t('english') : t('korean')}
                </button>
              ))}
            </div>
          </section>

          {/* Font size selector */}
          <section>
            <h3 className="text-[12px] font-semibold text-surface-500 uppercase tracking-wider mb-3">{t('fontSize')}</h3>
            <div className="flex gap-2">
              {([
                { id: 'small' as FontSize, label: t('fontSmall'), preview: 'A' },
                { id: 'medium' as FontSize, label: t('fontMedium'), preview: 'A' },
                { id: 'large' as FontSize, label: t('fontLarge'), preview: 'A' },
              ]).map(({ id, label, preview }) => (
                <button
                  key={id}
                  onClick={() => setFontSize(id)}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all flex flex-col items-center gap-1 ${
                    fontSize === id
                      ? 'bg-surface-800 border-primary-500 text-primary-400'
                      : 'bg-surface-900 border-surface-700 text-surface-500 hover:border-surface-600'
                  }`}
                >
                  <span style={{ fontSize: id === 'small' ? '15px' : id === 'medium' ? '17px' : '20px' }}>{preview}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* View mode — mobile only (desktop has header toggle) */}
          {isMobile && (
            <section>
              <h3 className="text-[12px] font-semibold text-surface-500 uppercase tracking-wider mb-3">{t('view')}</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveView('chat')}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${
                    activeView === 'chat'
                      ? 'bg-surface-800 border-primary-500 text-primary-400'
                      : 'bg-surface-900 border-surface-700 text-surface-500 hover:border-surface-600'
                  }`}
                >
                  AI
                </button>
                <button
                  onClick={() => setActiveView('kanban')}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${
                    activeView === 'kanban'
                      ? 'bg-surface-800 border-primary-500 text-primary-400'
                      : 'bg-surface-900 border-surface-700 text-surface-500 hover:border-surface-600'
                  }`}
                >
                  Task
                </button>
              </div>
            </section>
          )}

          {/* Connections — OAuth */}
          <OAuthErrorBoundary>
            <OAuthConnections />
          </OAuthErrorBoundary>
        </div>
      </div>
    </div>
  );
}
