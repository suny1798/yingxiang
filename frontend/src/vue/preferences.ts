import { createPreferenceState } from './preference-state';
import { translateText } from '../lib/i18n';
import { defineStore,storeToRefs } from 'pinia';
import { pinia } from './runtime';

const usePreferencesStore=defineStore('preferences',()=>createPreferenceState({
  cookie: document.cookie, secure: location.protocol === 'https:',
  writeCookie(value) { document.cookie = value; },
  setItem(key, value) { localStorage.setItem(key, value); },
  listen(handler) { window.addEventListener('storage', handler); return () => window.removeEventListener('storage', handler); },
}));
const store=usePreferencesStore(pinia);
const {locale,theme}=storeToRefs(store);
export const preferences={locale,theme,setLocale:store.setLocale,setTheme:store.setTheme,stop:store.stop};
export const t = (text: string) => translateText(text, preferences.locale.value);
