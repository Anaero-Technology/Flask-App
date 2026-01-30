import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import translation files
import enCommon from './locales/en/common.json';
import enSidebar from './locales/en/sidebar.json';
import enPages from './locales/en/pages.json';
import enMessages from './locales/en/messages.json';

import esCommon from './locales/es/common.json';
import esSidebar from './locales/es/sidebar.json';
import esPages from './locales/es/pages.json';
import esMessages from './locales/es/messages.json';

import frCommon from './locales/fr/common.json';
import frSidebar from './locales/fr/sidebar.json';
import frPages from './locales/fr/pages.json';
import frMessages from './locales/fr/messages.json';

import deCommon from './locales/de/common.json';
import deSidebar from './locales/de/sidebar.json';
import dePages from './locales/de/pages.json';
import deMessages from './locales/de/messages.json';

import zhCommon from './locales/zh/common.json';
import zhSidebar from './locales/zh/sidebar.json';
import zhPages from './locales/zh/pages.json';
import zhMessages from './locales/zh/messages.json';

// Define resources
const resources = {
  en: {
    common: enCommon,
    sidebar: enSidebar,
    pages: enPages,
    messages: enMessages,
  },
  es: {
    common: esCommon,
    sidebar: esSidebar,
    pages: esPages,
    messages: esMessages,
  },
  fr: {
    common: frCommon,
    sidebar: frSidebar,
    pages: frPages,
    messages: frMessages,
  },
  de: {
    common: deCommon,
    sidebar: deSidebar,
    pages: dePages,
    messages: deMessages,
  },
  zh: {
    common: zhCommon,
    sidebar: zhSidebar,
    pages: zhPages,
    messages: zhMessages,
  },
};

// Get initial language from localStorage or default to 'en'
const getInitialLanguage = () => {
  const savedLanguage = localStorage.getItem('appLanguage');
  if (savedLanguage && Object.keys(resources).includes(savedLanguage)) {
    return savedLanguage;
  }
  return 'en';
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: getInitialLanguage(),
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'sidebar', 'pages', 'messages'],
    interpolation: {
      escapeValue: false, // React already escapes values
    },
  });

export default i18n;
