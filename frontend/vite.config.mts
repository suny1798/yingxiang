import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// 只接受独立回环测试后端；默认8790，不自动接原8788业务服务。
const target = process.env.MIGRATION_BACKEND_URL ?? 'http://127.0.0.1:8790';
const backend = new URL(target);
if (backend.protocol !== 'http:' || backend.hostname !== '127.0.0.1' || !backend.port || backend.username || backend.password
    || backend.pathname !== '/' || backend.search || backend.hash) throw new Error('Migration backend must be numeric loopback');

export default defineConfig({
  plugins: [vue()],
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
