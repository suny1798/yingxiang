import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOT_FOUND_META, PRIVATE_PAGES, PUBLIC_PAGES, PUBLIC_ROUTES, SITE_NAME,
  isPrivatePath, pageTitle, publicPage,
} from '../src/vue/route-data';
import { documentDescription, documentTitle, robotsContent } from '../src/vue/document-meta';

test('公开路由固定为六个可抓取页面', () => {
  assert.deepEqual([...PUBLIC_ROUTES], ['/', '/pricing', '/help', '/help/feedback', '/privacy', '/terms']);
  for (const path of PUBLIC_ROUTES) {
    const meta = publicPage(path);
    assert.ok(meta, `${path} 缺少元数据`);
    assert.equal(meta.robots, 'index');
    assert.ok(meta.title.length > 0 && meta.description.length > 0);
    assert.ok(meta.description.length <= 160, `${path} 描述过长`);
  }
});

test('标题后缀与原Next行为一致', () => {
  assert.equal(pageTitle(publicPage('/')!), '映想 — 让想象，在眼前发生。');
  assert.equal(pageTitle(publicPage('/pricing')!), '价格方案 · 映想');
  assert.equal(pageTitle(publicPage('/help/feedback')!), '问题反馈 · 映想');
  assert.equal(pageTitle(publicPage('/privacy')!), '隐私与使用说明 · 映想');
  assert.equal(pageTitle(publicPage('/pricing')!, 'Test'), '价格方案 · Test');
  assert.equal(documentTitle(publicPage('/terms')!), '用户协议 · 映想');
});

test('英文切换保留路由与标题结构', () => {
  const english = documentTitle(NOT_FOUND_META, 'en');
  assert.ok(english.startsWith('Page not found'), english);
  assert.ok(!english.includes('页面不存在'));
  const chinese = documentTitle(NOT_FOUND_META, 'zh');
  assert.equal(chinese, `页面不存在 · ${SITE_NAME}`);
  assert.equal(documentDescription(publicPage('/privacy')!), publicPage('/privacy')!.description);
});

test('私有页面与子路径不进入公开集合', () => {
  for (const path of Object.keys(PRIVATE_PAGES)) {
    assert.ok(isPrivatePath(path), `${path} 应识别为私有`);
    assert.ok(!PUBLIC_ROUTES.includes(path), `${path} 不能出现在公开路由`);
    assert.equal((PRIVATE_PAGES as Record<string, { robots: string }>)[path].robots, 'noindex');
  }
  for (const path of ['/account/orders', '/studio/video', '/studio/edit', '/works/detail', '/admin']) {
    assert.ok(isPrivatePath(path), `${path} 应识别为私有`);
  }
  for (const path of ['/', '/pricing', '/help', '/help/feedback', '/helpful', '/workspace', '/accounting']) {
    assert.equal(isPrivatePath(path), false, `${path} 不应被误判为私有`);
  }
  assert.equal(publicPage('/account'), undefined);
});

test('robots与meta值可直接写入HTML属性', () => {
  assert.equal(robotsContent(publicPage('/')!), 'index, follow');
  assert.equal(robotsContent(NOT_FOUND_META), 'noindex, nofollow');
  for (const meta of [...Object.values(PUBLIC_PAGES), ...Object.values(PRIVATE_PAGES), NOT_FOUND_META]) {
    for (const value of [meta.title, meta.description, pageTitle(meta)]) {
      assert.ok(!/["<>]/.test(value), `含HTML敏感字符：${value}`);
    }
  }
});
