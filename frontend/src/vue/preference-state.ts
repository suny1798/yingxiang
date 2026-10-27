import { ref } from 'vue';
import { LOCALE_COOKIE, THEME_COOKIE, validLocale, validTheme, type Locale, type Theme } from '../lib/i18n';

export interface PreferenceBrowser {
  cookie: string;
  secure: boolean;
  writeCookie(value: string): void;
  setItem(key: string, value: string): void;
  listen(handler: (event: { key: string | null; newValue: string | null }) => void): () => void;
}

function cookie(source: string, key: string) {
  const value = source.split(';').map(item => item.trim()).find(item => item.startsWith(key + '='))?.slice(key.length + 1);
  try { return value === undefined ? undefined : decodeURIComponent(value); } catch { return undefined; }
}

export function createPreferenceState(browser: PreferenceBrowser) {
  // 与旧Next首屏一致：Cookie为初始来源，localStorage只用于写入和跨标签同步。
  const locale = ref(validLocale(cookie(browser.cookie, LOCALE_COOKIE)));
  const theme = ref(validTheme(cookie(browser.cookie, THEME_COOKIE)));
  function persist(key: string, value: string) {
    try { browser.writeCookie(`${key}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${browser.secure ? '; Secure' : ''}`); } catch {}
    try { browser.setItem(key, value); } catch {}
  }
  const stop = browser.listen(event => {
    if (event.key === LOCALE_COOKIE) locale.value = validLocale(event.newValue);
    if (event.key === THEME_COOKIE) theme.value = validTheme(event.newValue);
  });
  return { locale, theme, stop,
    setLocale(value: Locale) { locale.value = value; persist(LOCALE_COOKIE, value); },
    setTheme(value: Theme) { theme.value = value; persist(THEME_COOKIE, value); },
  };
}
