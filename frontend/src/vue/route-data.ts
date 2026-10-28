/**
 * 路由与页面元数据的单一来源。
 * 不导入组件或浏览器API，构建期预渲染脚本可直接读取。
 * 公开页描述沿用原Next页面文案；无JS请求看到的服务端meta由此生成。
 */
export type PageMeta = {
  /** 中文标题；非 fullTitle 时由 pageTitle 追加“ · 映想”。 */
  title: string;
  description: string;
  robots: 'index' | 'noindex';
  /** 首页标题已含品牌与标语，不再追加后缀。 */
  fullTitle?: boolean;
  englishTitle?: string;
};

export const SITE_NAME = '映想';
export const SITE_TAGLINE = '让想象，在眼前发生。';
export const SITE_DESCRIPTION = '映想提供实时换装、视频换装与提示词实时编辑，生成内容自动保存。';
/** 既有演示海报，作为分享图；不是为本轮新制的分享卡片。 */
export const SHARE_IMAGE = '/assets/try-on-demo-poster.jpg';
export const SHARE_IMAGE_ALT = '映想实时换装演示画面';

export const PUBLIC_PAGES = {
  '/': {
    title: '映想 — 让想象，在眼前发生。',
    description: '映想提供实时换装、视频换装与提示词实时编辑。可使用摄像头、已有视频或提示词完成画面创作，生成内容自动保存。',
    robots: 'index',
    fullTitle: true,
  },
  '/pricing': {
    title: '价格方案',
    description: '轻享、创作与进阶三档积分方案，涵盖实时换装、视频换装与实时编辑。积分长期有效，支持沙盒测试购买；测试积分与真实生成权限独立，正式购买暂未开放。',
    robots: 'index',
  },
  '/help': {
    title: '帮助中心',
    description: '查看实时换装、视频换装与实时编辑的操作步骤、素材要求、积分说明和常见问题。',
    robots: 'index',
  },
  '/help/feedback': {
    title: '问题反馈',
    description: '整理问题或建议并在本机生成反馈报告，复制或下载后交给项目维护者；页面不联网提交。',
    robots: 'index',
  },
  '/privacy': {
    title: '隐私与使用说明',
    description: '说明相机预览、云端处理、作品保存、截图与下载规则。',
    robots: 'index',
  },
  '/terms': {
    title: '用户协议',
    description: '映想用户协议：账号、素材、生成、支付与作品保存规则。',
    robots: 'index',
  },
} as const satisfies Record<string, PageMeta>;

export const PUBLIC_ROUTES: readonly string[] = Object.keys(PUBLIC_PAGES);

export const PRIVATE_PAGES = {
  '/account': { title: '个人中心', description: '映想个人中心：本人权益、使用记录、沙盒订单与账号信息。', robots: 'noindex' },
  '/account/usage': { title: '使用记录', description: '映想个人中心：本人权益、使用记录、沙盒订单与账号信息。', robots: 'noindex' },
  '/account/orders': { title: '我的订单', description: '映想个人中心：本人权益、使用记录、沙盒订单与账号信息。', robots: 'noindex' },
  '/account/security': { title: '账号信息', description: '映想个人中心：本人权益、使用记录、沙盒订单与账号信息。', robots: 'noindex' },
  '/admin': { title: '管理后台', description: '映想管理后台，仅管理员可访问。', robots: 'noindex' },
  '/studio': { title: '创作空间', description: '映想创作空间，需登录并确认云端处理后使用。', robots: 'noindex' },
  '/studio/video': { title: '视频换装', description: '映想创作空间，需登录并确认云端处理后使用。', robots: 'noindex' },
  '/studio/edit': { title: '实时编辑', description: '映想创作空间，需登录并确认云端处理后使用。', robots: 'noindex' },
  '/works': { title: '我的作品', description: '映想我的作品，需登录后查看本人生成内容。', robots: 'noindex' },
} as const satisfies Record<string, PageMeta>;

/** 私有页面及其子路径一律SPA并noindex，不预渲染私有内容。 */
const PRIVATE_PREFIXES = ['/account', '/admin', '/studio', '/works'] as const;

export const PRIVATE_ROUTES: readonly string[] = Object.keys(PRIVATE_PAGES);

export const NOT_FOUND_META: PageMeta = {
  title: '页面不存在',
  englishTitle: 'Page not found',
  description: '映想没有这个页面，可返回首页或帮助中心。',
  robots: 'noindex',
};

export function isPrivatePath(path: string): boolean {
  return PRIVATE_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

export function publicPage(path: string): PageMeta | undefined {
  return Object.hasOwn(PUBLIC_PAGES, path) ? (PUBLIC_PAGES as Record<string, PageMeta>)[path] : undefined;
}

/** 中文最终标题；英文与englishTitle处理在 document-meta 中完成。 */
export function pageTitle(meta: PageMeta, site = SITE_NAME): string {
  return meta.fullTitle ? meta.title : `${meta.title} · ${site}`;
}
