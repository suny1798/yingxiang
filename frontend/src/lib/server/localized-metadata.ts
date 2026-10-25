import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, translateText, validLocale } from '../i18n';

export async function localizedMetadata(value: Metadata): Promise<Metadata> {
  const locale = validLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    ...value,
    ...(typeof value.title === 'string' ? { title: translateText(value.title, locale) } : {}),
    ...(typeof value.description === 'string' ? { description: translateText(value.description, locale) } : {}),
  };
}
