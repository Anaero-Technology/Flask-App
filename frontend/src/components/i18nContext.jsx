import { createContext, useContext, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';

const I18nContext = createContext();

export function I18nProvider({ children }) {
  const { i18n } = useTranslation();
  const { authFetch } = useAuth();

  const changeLanguage = useCallback(async (language) => {
    if (!['en', 'es', 'fr', 'de', 'zh'].includes(language)) {
      console.error('Invalid language:', language);
      return false;
    }

    try {
      // Update i18next
      await i18n.changeLanguage(language);

      // Save to localStorage for persistence
      localStorage.setItem('appLanguage', language);

      // Sync with backend
      try {
        await authFetch('/api/v1/user/preferences', {
          method: 'PUT',
          body: JSON.stringify({
            language: language
          })
        });
      } catch (error) {
        console.error('Error syncing language preference with backend:', error);
        // Don't fail - language change is applied locally even if backend sync fails
      }

      return true;
    } catch (error) {
      console.error('Error changing language:', error);
      return false;
    }
  }, [i18n, authFetch]);

  const value = {
    changeLanguage,
    currentLanguage: i18n.language,
  };

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}
