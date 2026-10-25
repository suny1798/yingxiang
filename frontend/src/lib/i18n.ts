import english from './messages/en.json';

export type Locale = 'zh' | 'en';
export type Theme = 'light' | 'dark';
export const LOCALE_COOKIE = 'yingxiang-locale';
export const THEME_COOKIE = 'yingxiang-theme';
export const validLocale = (value: unknown): Locale => value === 'en' ? 'en' : 'zh';
export const validTheme = (value: unknown): Theme => value === 'dark' ? 'dark' : 'light';

const messages: Record<string, string> = english;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.entries(messages).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => {
  const slots: string[] = [];
  const source = key.split(/(\{\d+\})/).map(part => {
    if (/^\{\d+\}$/.test(part)) { slots.push(part); return '([\\s\\S]*?)'; }
    return escape(part);
  }).join('');
  return { pattern: new RegExp(`^${source}$`), value, slots, weight: key.replace(/\{\d+\}/g, '').length };
}).sort((a, b) => b.weight - a.weight);

/** 只处理界面文案；调用方不将用户输入、名称和素材内容交给翻译。 */
export function translateText(text: string, locale: Locale, depth = 0): string {
  if (locale === 'zh' || !/[\u3400-\u9fff]/.test(text) || depth > 5) return text;
  if (Object.hasOwn(messages, text)) return messages[text];
  const trimmed = text.trim();
  if (trimmed !== text && Object.hasOwn(messages, trimmed)) return text.replace(trimmed, messages[trimmed]);
  for (const { pattern, value, slots } of patterns) {
    const match = pattern.exec(text);
    if (match) return value.replace(/\{\d+\}/g, slot => {
      const index = slots.indexOf(slot);
      return index < 0 ? slot : translateText(match[index + 1], locale, depth + 1);
    });
  }
  return text;
}

export function translateValue<T>(value: T, locale: Locale): T {
  return (typeof value === 'string' ? translateText(value, locale) : value) as T;
}

export function translatedDocumentTitle(title: string, locale: Locale): string {
  const source = Object.entries(messages).find(([, englishTitle]) => englishTitle === title)?.[0] ?? title;
  return translateText(source, locale);
}
