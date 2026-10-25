import assert from 'node:assert/strict';
import test from 'node:test';
import messages from '../src/lib/messages/en.json';
import { translateText, translateValue, validLocale, validTheme } from '../src/lib/i18n';

test('只接受已知的语言与主题偏好，未知值回到默认', () => {
  assert.equal(validLocale('en'), 'en');
  assert.equal(validLocale('fr'), 'zh');
  assert.equal(validTheme('dark'), 'dark');
  assert.equal(validTheme('<script>'), 'light');
});

test('动态额度、组合标签与嵌套场景正确翻译，中文保持原样', () => {
  assert.equal(translateText('剩余 99 次', 'en'), '99 sessions left');
  assert.equal(translateText('全部 450 积分用于视频换装', 'en'), 'All 450 credits used for Video try-on');
  assert.equal(translateText('相机与连接 · 7 个答案', 'en'), 'Camera & connection · 7 answers');
  assert.equal(translateText('已添加3张服装图。', 'en'), 'Added 3 garment images.');
  assert.equal(translateText(' 暂未开放 ', 'en'), ' Not available yet ');
  assert.equal(translateText('剩余 99 次', 'zh'), '剩余 99 次');
});

test('未登记文本及非字符串原样返回，不修改对象或媒体数据', () => {
  assert.equal(translateText('我的私人提示词：蓝色猫咪', 'en'), '我的私人提示词：蓝色猫咪');
  const value = { name: '原视频', url: 'blob:local-example' };
  assert.equal(translateValue(value, 'en'), value);
  assert.equal(translateValue(15, 'en'), 15);
  assert.equal(translateValue(null, 'en'), null);
});

test('英语词典没有空白项，动态插槽没有丢失或新增', () => {
  for (const [source, target] of Object.entries(messages)) {
    assert.ok(target.trim(), source);
    assert.deepEqual((source.match(/\{\d+\}/g) ?? []).sort(), (target.match(/\{\d+\}/g) ?? []).sort(), source);
  }
});
