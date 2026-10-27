import { createPreferenceState } from './preference-state';
import { translateText } from '../lib/i18n';

export const preferences = createPreferenceState({
  cookie: document.cookie, secure: location.protocol === 'https:',
  writeCookie(value) { document.cookie = value; },
  setItem(key, value) { localStorage.setItem(key, value); },
  listen(handler) { window.addEventListener('storage', handler); return () => window.removeEventListener('storage', handler); },
});
export const t = (text: string) => translateText(text, preferences.locale.value);
