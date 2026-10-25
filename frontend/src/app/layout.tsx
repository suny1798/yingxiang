import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import './globals.css';
import { NoticeCenter } from '@/components/notice-center';
import { cookies } from 'next/headers';
import { PreferencesProvider } from '@/components/preferences';
import { LOCALE_COOKIE, THEME_COOKIE, validLocale, validTheme } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({
  title: '映想 — 让想象，在眼前发生。',
  description: '映想实时画面创作。上传服装参考图，开启实时换装。',
  icons: { icon: '/assets/mark.svg' },
}); }

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const preferences = await cookies();
  const locale = validLocale(preferences.get(LOCALE_COOKIE)?.value);
  const theme = validTheme(preferences.get(THEME_COOKIE)?.value);
  return <html lang={locale === 'en' ? 'en' : 'zh-CN'} data-theme={theme}><body><PreferencesProvider initialLocale={locale} initialTheme={theme}>{children}<NoticeCenter /></PreferencesProvider></body></html>;
}
