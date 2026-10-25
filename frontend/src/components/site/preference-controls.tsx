'use client';

import { usePreferences } from '@/components/preferences';
import s from './site.module.css';

export function PreferenceControls() {
  const { locale, theme, setLocale, setTheme } = usePreferences();
  const english = locale === 'en', dark = theme === 'dark';
  return <div className={s.preferences} role="group" aria-label={english ? 'Language and appearance' : '语言与外观'}>
    <button type="button" className={s.preferenceButton} onClick={() => setLocale(english ? 'zh' : 'en')} aria-label={english ? '切换到中文' : 'Switch to English'} title={english ? '切换到中文' : 'Switch to English'}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 5h12M9 3v2m4 0c-1 6-4 10-9 12m1-9c1 4 4 7 8 9m1 4 4-11 4 11m-6.5-4h5" /></svg><span>{english ? '中' : 'EN'}</span></button>
    <button type="button" className={s.preferenceButton} onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={english ? dark ? 'Switch to light mode' : 'Switch to dark mode' : dark ? '切换日间模式' : '切换夜间模式'} title={english ? dark ? 'Light mode' : 'Dark mode' : dark ? '日间模式' : '夜间模式'} aria-pressed={dark}>
      {dark ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></svg> : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.5 14a8.5 8.5 0 0 1-10.5-10.5A8.5 8.5 0 1 0 20.5 14Z" /></svg>}
    </button>
  </div>;
}
