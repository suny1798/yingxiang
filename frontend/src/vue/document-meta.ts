import { translateText, type Locale } from '../lib/i18n';
import { SITE_NAME, pageTitle, type PageMeta } from './route-data';

/** 客户端与预渲染共用的标题规则；英文只切换界面文案，不改变URL。 */
export function documentTitle(meta: PageMeta, locale: Locale = 'zh'): string {
  const title = locale === 'en' && meta.englishTitle ? meta.englishTitle : meta.title;
  return pageTitle({ ...meta, title }, translateText(SITE_NAME, locale));
}

export function documentDescription(meta: PageMeta, locale: Locale = 'zh'): string {
  return translateText(meta.description, locale);
}

export function robotsContent(meta: PageMeta): string {
  return meta.robots === 'index' ? 'index, follow' : 'noindex, nofollow';
}

function setMeta(selector: string, attribute: 'name' | 'property', key: string, value: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', value);
}

/** 路由变化时同步客户端标题与公开分享标签；不改变服务端已生成的HTML。 */
export function applyDocumentMeta(meta: PageMeta, locale: Locale): void {
  const title = documentTitle(meta, locale);
  const description = documentDescription(meta, locale);
  document.title = title;
  setMeta('meta[name="description"]', 'name', 'description', description);
  setMeta('meta[name="robots"]', 'name', 'robots', robotsContent(meta));
  setMeta('meta[property="og:title"]', 'property', 'og:title', title);
  setMeta('meta[property="og:description"]', 'property', 'og:description', description);
  setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title);
  setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);
}
