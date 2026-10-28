import { createPreferenceState } from './preference-state';
import { translateText } from '../lib/i18n';
import { defineStore,storeToRefs } from 'pinia';
import { pinia } from './runtime';
import { LOCALE_COOKIE,THEME_COOKIE } from '../lib/i18n';
let channel:BroadcastChannel|undefined;

const usePreferencesStore=defineStore('preferences',()=>createPreferenceState({
  cookie: document.cookie, secure: location.protocol === 'https:',
  writeCookie(value) { document.cookie = value; },
  setItem(key, value) { localStorage.setItem(key, value); },
  broadcast(key,value){channel?.postMessage({key,value});},
  listen(handler) {
    window.addEventListener('storage',handler);
    try{
      if(typeof BroadcastChannel!=='undefined'){
        channel=new BroadcastChannel('yingxiang-preferences-v1');
        channel.onmessage=event=>{const value=event.data;if(value&&((value.key===LOCALE_COOKIE&&['zh','en'].includes(value.value))||(value.key===THEME_COOKIE&&['light','dark'].includes(value.value))))handler({key:value.key,newValue:value.value});};
      }
    }catch{/* Cookie／localStorage降级路径继续有效。 */}
    return ()=>{window.removeEventListener('storage',handler);channel?.close();channel=undefined;};
  },
}));
const store=usePreferencesStore(pinia);
const {locale,theme}=storeToRefs(store);
export const preferences={locale,theme,setLocale:store.setLocale,setTheme:store.setTheme,stop:store.stop};
export const t = (text: string) => translateText(text, preferences.locale.value);
