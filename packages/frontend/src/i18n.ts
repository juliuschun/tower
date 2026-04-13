import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// -- English --
import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enLayout from './locales/en/layout.json';
import enChat from './locales/en/chat.json';
import enAdmin from './locales/en/admin.json';
import enKanban from './locales/en/kanban.json';
import enRooms from './locales/en/rooms.json';
import enSettings from './locales/en/settings.json';
import enHelp from './locales/en/help.json';
import enGit from './locales/en/git.json';
import enHistory from './locales/en/history.json';
import enShare from './locales/en/share.json';
import enSchedule from './locales/en/schedule.json';
import enAutomation from './locales/en/automation.json';

// -- Korean --
import koCommon from './locales/ko/common.json';
import koAuth from './locales/ko/auth.json';
import koLayout from './locales/ko/layout.json';
import koChat from './locales/ko/chat.json';
import koAdmin from './locales/ko/admin.json';
import koKanban from './locales/ko/kanban.json';
import koRooms from './locales/ko/rooms.json';
import koSettings from './locales/ko/settings.json';
import koHelp from './locales/ko/help.json';
import koGit from './locales/ko/git.json';
import koHistory from './locales/ko/history.json';
import koShare from './locales/ko/share.json';
import koSchedule from './locales/ko/schedule.json';
import koAutomation from './locales/ko/automation.json';

export const defaultNS = 'common';
export const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    layout: enLayout,
    chat: enChat,
    admin: enAdmin,
    kanban: enKanban,
    rooms: enRooms,
    settings: enSettings,
    help: enHelp,
    git: enGit,
    history: enHistory,
    share: enShare,
    schedule: enSchedule,
    automation: enAutomation,
  },
  ko: {
    common: koCommon,
    auth: koAuth,
    layout: koLayout,
    chat: koChat,
    admin: koAdmin,
    kanban: koKanban,
    rooms: koRooms,
    settings: koSettings,
    help: koHelp,
    git: koGit,
    history: koHistory,
    share: koShare,
    schedule: koSchedule,
    automation: koAutomation,
  },
} as const;

// Detect saved language or fall back to browser language
function getInitialLanguage(): string {
  const saved = localStorage.getItem('tower:lang');
  if (saved === 'ko' || saved === 'en') return saved;
  // Check browser language
  const browserLang = navigator.language.toLowerCase();
  return browserLang.startsWith('ko') ? 'ko' : 'en';
}

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: 'en',
  defaultNS,
  ns: Object.keys(resources.en),
  interpolation: {
    escapeValue: false, // React already escapes
  },
});

// Sync language changes to localStorage
i18n.on('languageChanged', (lng) => {
  localStorage.setItem('tower:lang', lng);
});

export default i18n;
