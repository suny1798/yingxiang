import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

// 只接受独立回环测试后端；默认8790，不自动接原8788业务服务。
const target = process.env.MIGRATION_BACKEND_URL ?? 'http://127.0.0.1:8790';
const backend = new URL(target);
if (backend.protocol !== 'http:' || backend.hostname !== '127.0.0.1' || !backend.port || backend.username || backend.password
    || backend.pathname !== '/' || backend.search || backend.hash) throw new Error('Migration backend must be numeric loopback');

type EntryRoutes = { public: string[]; private: string[] };

/** 构建期预渲染生成的入口清单；未构建时按空清单处理，preview本就需要先build。 */
function entryRoutes(file: string): EntryRoutes {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<EntryRoutes>;
    return { public: Array.isArray(value.public) ? value.public : [], private: Array.isArray(value.private) ? value.private : [] };
  } catch { return { public: [], private: [] }; }
}

/**
 * preview只用于隔离验收，但必须与Nginx一致：
 * 公开页返回各自预渲染HTML，私有页返回noindex SPA壳，未知路径保留HTTP404。
 */
function staticEntryRoutes(): Plugin {
  return {
    name: 'yingxiang-entry-routes',
    configurePreviewServer(server) {
      const dist = resolve(server.config.root, 'dist');
      const routes = entryRoutes(join(dist, 'entry-routes.json'));
      const shellFile = join(dist, 'app.html');
      server.middlewares.use((request, response, next) => {
        const method = request.method ?? 'GET';
        if ((method !== 'GET' && method !== 'HEAD') || !request.url) return next();
        const { pathname } = new URL(request.url, 'http://127.0.0.1');
        if (pathname.startsWith('/assets/') || pathname.startsWith('/api/') || pathname === '/index.html' || pathname === '/app.html') return next();
        const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';
        if (routes.public.includes(path)) {
          request.url = path === '/' ? '/index.html' : `${path}/index.html`;
          return next();
        }
        if (routes.private.includes(path)) {
          response.setHeader('X-Robots-Tag', 'noindex, nofollow');
          request.url = '/app.html';
          return next();
        }
        void readFile(shellFile).then(body => {
          response.statusCode = 404;
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          response.setHeader('X-Robots-Tag', 'noindex, nofollow');
          response.end(method === 'HEAD' ? undefined : body);
        }).catch(next);
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), staticEntryRoutes()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // 不读取旧业务dotenv，不向客户端注入服务端配置。
  envDir: false,
  server: { host: '127.0.0.1', port: 8791, strictPort: true,
    proxy: { '/api': { target, changeOrigin: false } } },
  preview: { host: '127.0.0.1', port: 8791, strictPort: true },
  build: { rolldownOptions: { preserveEntrySignatures: 'strict', input: {
    app: fileURLToPath(new URL('./index.html', import.meta.url)),
    sdk: fileURLToPath(new URL('./scripts/sdk-vite-check.ts', import.meta.url)),
  } } },
});
