import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { studioIconShapes } from '../src/lib/studio/icon-paths';

// npm test 在 frontend/ 执行；直接读取旧React图标源做机械对照，不修改对照实现。
const source = readFileSync('src/components/studio/icon.tsx', 'utf8');

test('共享图标几何与旧React实现逐项一致，未新增或漏掉图标名', () => {
  const declared = (source.match(/export type IconName = ([^;]+);/)?.[1].match(/'[^']+'/g) ?? []).map((name) => name.slice(1, -1)).sort();
  assert.deepEqual(declared, Object.keys(studioIconShapes).sort());
  for (const [name, shapes] of Object.entries(studioIconShapes)) {
    assert.ok(new RegExp(`${name}:`).test(source), name);
    for (const shape of shapes) {
      const markup = shape.kind === 'path' ? `d="${shape.d}"`
        : shape.kind === 'circle' ? `cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}"`
          : `x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${shape.rx}"`;
      assert.ok(source.includes(markup), `${name} ${markup}`);
    }
  }
});
