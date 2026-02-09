import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext({
  theme: 'light',
  setTheme: () => {},
  toggleTheme: () => {},
});

const THEME_STORAGE_KEY = 'themePreference';

const getSystemTheme = () => {
  if (typeof window === 'undefined') {
    return 'light';
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const getStoredPreference = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }

  return null;
};

export const ThemeProvider = ({ children }) => {
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);
  const [userPreference, setUserPreference] = useState(getStoredPreference);
  const theme = userPreference ?? systemTheme;

  const setTheme = useCallback((nextTheme) => {
    setUserPreference((previousPreference) => {
      const previousTheme = previousPreference ?? systemTheme;
      const resolvedTheme = typeof nextTheme === 'function' ? nextTheme(previousTheme) : nextTheme;

      if (resolvedTheme === null || resolvedTheme === 'system') {
        return null;
      }

      return resolvedTheme === 'dark' ? 'dark' : 'light';
    });
  }, [systemTheme]);

  const toggleTheme = useCallback(() => {
    setTheme((previousTheme) => (previousTheme === 'dark' ? 'light' : 'dark'));
  }, [setTheme]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };

    setSystemTheme(mediaQuery.matches ? 'dark' : 'light');

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (userPreference === 'light' || userPreference === 'dark') {
      window.localStorage.setItem(THEME_STORAGE_KEY, userPreference);
      return;
    }

    window.localStorage.removeItem(THEME_STORAGE_KEY);
  }, [userPreference]);

  const value = useMemo(() => ({
    theme,
    setTheme,
    toggleTheme,
  }), [theme, setTheme, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
