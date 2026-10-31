/**
 * 构建期静态预渲染：用本机Chromium无头浏览器抓取已构建的公开路由，
 * 生成带服务端meta和可抓取正文的HTML。不启动常驻SSR服务，不接真实后端。
 * 失败即中止构建，绝不把空壳当作预渲染产物。
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_ROUTES, PRIVATE_ROUTES, SHARE_IMAGE, SHARE_IMAGE_ALT, SITE_NAME, isPrivatePath, pageTitle, publicPage, type PageMeta } from '../src/vue/route-data';

const root = fileURLToPath(new URL('../', import.meta.url));
const frontendConfig = JSON.parse(readFileSync(join(root, 'config/frontend.json'), 'utf8')) as { publicOrigin?: string; chromeBin?: string };
const dist = join(root, 'dist');
const VIRTUAL_TIME_BUDGET_MS = 3000;
const ROUTE_TIMEOUT_MS = 30_000;

/** 每个公开页必须出现在预渲染正文里的关键文案；防止只注入meta。 */
const BODY_MARKERS: Record<string, string> = {
  '/wardrobe': '下一套，',
  '/': '让想象，',
  '/pricing': '充值与积分',
  '/help': '使用指南与常见问题',
  '/help/feedback': '整理问题反馈',
  '/privacy': '隐私与使用说明',
  '/terms': '用户协议',
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const CHROME_CANDIDATES = [
  process.env.YINGXIANG_CHROME_BIN ?? frontendConfig.chromeBin,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : undefined,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function findChrome(): Promise<string> {
  for (const candidate of CHROME_CANDIDATES) {
    if (!candidate) continue;
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* 继续查找下一个候选。 */ }
  }
  throw new Error('未找到Chromium内核浏览器；请设置 YINGXIANG_CHROME_BIN 指向 chrome.exe。');
}

function publicOrigin(): string | null {
  const raw = (process.env.YINGXIANG_PUBLIC_ORIGIN ?? frontendConfig.publicOrigin ?? '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  if (!/^https?:\/\/[^/?#]+$/.test(raw)) throw new Error('frontend.json publicOrigin 必须是 http(s)://主机[:端口] 形式，且不带路径。');
  return raw;
}

/** 预渲染期只提供公开匿名快照；不读取真实账号、公告或支付状态。 */
const API_STUBS: Record<string, unknown> = {
  '/api/account/me': { user: null, trial: null, trialLimit: 0, trialRemaining: 0, durations: [], history: [] },
  '/api/site/announcement': { enabled: false, version: 0, zh: '', en: '' },
  '/api/payments/status': { testEnabled: false },
};

async function serveDist(): Promise<{ server: Server; port: number }> {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (Object.hasOwn(API_STUBS, path)) {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(API_STUBS[path]));
      return;
    }
    if (path.startsWith('/api/')) {
      response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end('{"error":{"code":"NOT_FOUND"}}');
      return;
    }
    const file = join(dist, path === '/' ? 'index.html' : path);
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch {
      // 预渲染时公开页尚无静态文件，统一回退到Vue入口壳，由客户端渲染出正文。
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(await readFile(join(dist, 'index.html')));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('预渲染本地服务启动失败');
  return { server, port: address.port };
}

async function dumpDom(chrome: string, profile: string, url: string): Promise<string> {
  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-sync',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--virtual-time-budget=${VIRTUAL_TIME_BUDGET_MS}`,
    '--dump-dom',
    url,
  ], { windowsHide: true });
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  child.stdout.on('data', chunk => output.push(chunk as Buffer));
  child.stderr.on('data', chunk => errors.push(chunk as Buffer));
  const timer = setTimeout(() => child.kill(), ROUTE_TIMEOUT_MS);
  const [code] = await once(child, 'exit') as [number | null];
  clearTimeout(timer);
  const text = Buffer.concat(output).toString('utf8');
  if (code !== 0 || !/<html/i.test(text)) {
    const detail = Buffer.concat(errors).toString('utf8').trim().split('\n').slice(-2).join(' ');
    throw new Error(`预渲染抓取失败（${url}，退出码${code}）：${detail}`);
  }
  return text;
}

function assertRendered(html: string, path: string, meta: PageMeta): void {
  const expectedTitle = pageTitle(meta);
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1];
  if (title !== expectedTitle) throw new Error(`${path} 标题不符：期望“${expectedTitle}”，实际“${title ?? ''}”`);
  if (!/<html[^>]*\slang="zh-CN"/.test(html)) throw new Error(`${path} 缺少服务端 lang="zh-CN"`);
  if (!/<div id="app"[^>]*>/.test(html)) throw new Error(`${path} 缺少 #app 容器`);
  if (!/<main[\s>]/.test(html)) throw new Error(`${path} 正文未渲染，拒绝生成空壳HTML`);
  const marker = BODY_MARKERS[path];
  if (!marker || !html.includes(marker)) throw new Error(`${path} 缺少关键正文“${marker ?? ''}”`);
  if (!html.includes('登录 / 注册')) throw new Error(`${path} 未渲染匿名头部，预渲染接口替身可能未生效`);
  for (const transient of ['账号读取中', '重新读取账号', '正在读取账号']) {
    if (html.includes(transient)) throw new Error(`${path} 残留异步占位“${transient}”`);
  }
}

const DYNAMIC_META = /<meta (?:name|property)="(?:description|robots|twitter:[^"]*|og:[^"]*)"[^>]*>\s*/g;
const CANONICAL_LINK = /<link rel="canonical"[^>]*>\s*/g;

function injectHead(html: string, path: string, meta: PageMeta, origin: string | null): string {
  const headEnd = html.indexOf('</head>');
  if (headEnd < 0) throw new Error(`${path} 缺少 </head>`);
  // 抓取时客户端已写入动态标签；先移除再由本脚本统一生成，避免重复标签。
  const head = html.slice(0, headEnd).replace(DYNAMIC_META, '').replace(CANONICAL_LINK, '').replace(/\s+$/, '\n');
  const description = meta.description;
  const title = pageTitle(meta);
  const tags = [
    `<meta name="description" content="${escapeAttribute(description)}">`,
    `<meta name="robots" content="${meta.robots === 'index' ? 'index, follow' : 'noindex, nofollow'}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${escapeAttribute(SITE_NAME)}">`,
    `<meta property="og:locale" content="zh_CN">`,
    `<meta property="og:title" content="${escapeAttribute(title)}">`,
    `<meta property="og:description" content="${escapeAttribute(description)}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${escapeAttribute(title)}">`,
    `<meta name="twitter:description" content="${escapeAttribute(description)}">`,
  ];
  if (origin) {
    const url = `${origin}${path}`;
    tags.push(
      `<link rel="canonical" href="${escapeAttribute(url)}">`,
      `<meta property="og:url" content="${escapeAttribute(url)}">`,
      `<meta property="og:image" content="${escapeAttribute(`${origin}${SHARE_IMAGE}`)}">`,
      `<meta property="og:image:alt" content="${escapeAttribute(SHARE_IMAGE_ALT)}">`,
      `<meta name="twitter:image" content="${escapeAttribute(`${origin}${SHARE_IMAGE}`)}">`,
    );
  }
  return `${head}    ${tags.join('\n    ')}\n  ${html.slice(headEnd)}`;
}

async function main(): Promise<void> {
  const chrome = await findChrome();
  const origin = publicOrigin();
  const shell = await readFile(join(dist, 'index.html'), 'utf8');
  if (shell.includes('name="robots"')) throw new Error('构建入口已含robots标签，预渲染前置条件不符');
  await writeFile(join(dist, 'app.html'), shell.replace('</head>', '    <meta name="robots" content="noindex, nofollow">\n  </head>'));
  // preview与Nginx共用的入口清单，只由本脚本从路由元数据生成。
  await writeFile(join(dist, 'entry-routes.json'), JSON.stringify({ public: PUBLIC_ROUTES, private: PRIVATE_ROUTES }, null, 2));

  const profile = await mkdtemp(join(tmpdir(), 'yingxiang-prerender-'));
  const { server, port } = await serveDist();
  const generated: Array<{ path: string; file: string; bytes: number }> = [];
  try {
    const dumps: Array<{ path: string; html: string; meta: PageMeta }> = [];
    for (const path of PUBLIC_ROUTES) {
      const meta = publicPage(path);
      if (!meta) throw new Error(`${path} 缺少公开页元数据`);
      if (isPrivatePath(path)) throw new Error(`${path} 不能同时是公开与私有路由`);
      const html = await dumpDom(chrome, profile, `http://127.0.0.1:${port}${path}`);
      assertRendered(html, path, meta);
      dumps.push({ path, html, meta });
    }
    for (const { path, html, meta } of dumps) {
      const output = injectHead(html, path, meta, origin);
      const file = path === '/' ? join(dist, 'index.html') : join(dist, path.slice(1), 'index.html');
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, output);
      generated.push({ path, file: file.slice(root.length).replaceAll('\\', '/'), bytes: Buffer.byteLength(output) });
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    status: 'OK',
    prerenderedRoutes: generated.length,
    files: generated,
    shell: 'dist/app.html',
    anonymousApiStubs: Object.keys(API_STUBS).length,
    canonicalOrigin: origin,
    note: origin ? undefined : 'frontend/config/frontend.json 未配置 publicOrigin，已省略canonical、og:url与分享图绝对地址',
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
