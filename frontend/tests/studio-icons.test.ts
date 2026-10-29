import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { studioIconShapes } from '../src/lib/studio/icon-paths';

// 旧React实现已在M25退役；这里冻结图标名清单，防止静默增删，并核对Vue渲染入口仍读取共享几何。
const expected = ['arrow', 'camera', 'check', 'close', 'download', 'fullscreen', 'fullscreenExit', 'hanger', 'history', 'info', 'lock', 'mirror', 'search', 'snapshot', 'sort', 'star', 'sun', 'switch', 'upload'];
const component = readFileSync('src/vue/StudioIcon.vue', 'utf8');

test('图标名清单冻结，未新增或漏掉图标', () => {
  assert.deepEqual(Object.keys(studioIconShapes).sort(), expected);
});

test('共享图标几何完整且由Vue组件渲染', () => {
  assert.match(component, /studioIconShapes\[name\]/);
  for (const [name, shapes] of Object.entries(studioIconShapes)) {
    assert.ok(shapes.length > 0, name);
    for (const shape of shapes) {
      if (shape.kind === 'path') assert.match(shape.d, /^[Mm]/, `${name} path`);
      else if (shape.kind === 'circle') assert.ok(shape.r > 0, `${name} circle`);
      else assert.ok(shape.width > 0 && shape.height > 0, `${name} rect`);
    }
  }
});
