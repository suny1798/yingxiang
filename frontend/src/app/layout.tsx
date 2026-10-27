import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import './globals.css';
import { NoticeCenter } from '@/components/notice-center';
import { cookies } from 'next/headers';
import { PreferencesProvider } from '@/components/preferences';
import { LOCALE_COOKIE, THEME_COOKIE, validLocale, validTheme } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({
  title: '映想 — 让想象，在眼前发生。',
  description: '映想提供实时换装、视频换装与提示词实时编辑，生成内容自动保存。',
  icons: { icon: '/assets/mark.svg' },
}); }

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const preferences = await cookies();
  const locale = validLocale(preferences.get(LOCALE_COOKIE)?.value);
  const theme = validTheme(preferences.get(THEME_COOKIE)?.value);
  return <html lang={locale === 'en' ? 'en' : 'zh-CN'} data-theme={theme}><body><PreferencesProvider initialLocale={locale} initialTheme={theme}>{children}<NoticeCenter /></PreferencesProvider></body></html>;
}
