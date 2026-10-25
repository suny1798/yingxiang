'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LOCALE_COOKIE, THEME_COOKIE, translatedDocumentTitle, translateValue, validLocale, validTheme, type Locale, type Theme } from '@/lib/i18n';

type Preferences = { locale: Locale; theme: Theme; setLocale: (value: Locale) => void; setTheme: (value: Theme) => void };
const Context = createContext<Preferences | null>(null);

function persist(key: string, value: string) {
  try { document.cookie = `${key}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; } catch { /* 浏览器可单独禁用Cookie。 */ }
  try { localStorage.setItem(key, value); } catch { /* 存储被禁用时，当前页面依然可以切换。 */ }
}

export function PreferencesProvider({ initialLocale, initialTheme, children }: { initialLocale: Locale; initialTheme: Theme; children: ReactNode }) {
  const [locale, updateLocale] = useState(initialLocale);
  const [theme, updateTheme] = useState(initialTheme);
  const setLocale = useCallback((value: Locale) => { updateLocale(value); persist(LOCALE_COOKIE, value); }, []);
  const setTheme = useCallback((value: Theme) => { updateTheme(value); persist(THEME_COOKIE, value); }, []);
  useEffect(() => { document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'; document.title = translatedDocumentTitle(document.title, locale); }, [locale]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === LOCALE_COOKIE) updateLocale(validLocale(event.newValue));
      if (event.key === THEME_COOKIE) updateTheme(validTheme(event.newValue));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const value = useMemo(() => ({ locale, theme, setLocale, setTheme }), [locale, theme, setLocale, setTheme]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePreferences() {
  const value = useContext(Context);
  if (!value) throw new Error('PreferencesProvider is missing');
  return value;
}

export function useI18n() {
  const { locale } = usePreferences();
  const t = useCallback(<T,>(value: T): T => translateValue(value, locale), [locale]);
  return { t, locale, intlLocale: locale === 'en' ? 'en-US' : 'zh-CN' };
}
