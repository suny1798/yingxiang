import assert from 'node:assert/strict';
import test from 'node:test';
import { categories, questions, guides, filterHelpQuestions } from '../src/lib/public-help';
import { translateText } from '../src/lib/i18n';
const zh = (value: string) => value;
const en = (value: string) => translateText(value, 'en');

test('帮助默认完整问题与分类覆盖一致，指南仍指向原创作模式', () => {
  assert.deepEqual(filterHelpQuestions('  \n ', '全部问题', zh), questions);
  assert.equal(new Set(questions.map(q=>q.id)).size, questions.length);
  assert.ok(questions.every(q=>categories.includes(q.category)));
  assert.deepEqual(guides.map(g=>g.href), ['/studio','/studio/video','/studio/edit']);
});

test('帮助中文多词AND与分类同时生效，搜索为字面值不执行正则', () => {
  const results=filterHelpQuestions('镜像  下载', '保存与镜像', zh);
  assert.ok(results.some(q=>q.id==='mirror'));
  assert.ok(results.every(q=>q.category==='保存与镜像'));
  assert.equal(filterHelpQuestions('镜像 不存在的第二个关键词', '全部问题', zh).length,0);
  assert.equal(filterHelpQuestions('.*', '全部问题', zh).length,0);
});

test('英文显示时仍能搜索中文，也能不区分大小写检索英文答案', () => {
  assert.ok(filterHelpQuestions('MIRROR', '全部问题', en).some(q=>q.id==='mirror'));
  assert.ok(filterHelpQuestions('镜像', '全部问题', en).some(q=>q.id==='mirror'));
  assert.equal(filterHelpQuestions('MIRROR', '相机与连接', en).length,0);
});

test('帮助问题和指南的英文阅读不会回退成遗漏的中文段落', () => {
  const content=[...categories,...questions.flatMap(q=>[q.title,...q.answer,q.link??'']),...guides.flatMap(g=>[g.title,g.intro,g.action,...g.steps])];
  for (const text of content) assert.equal(/[一-龥]/.test(en(text)),false,`Missing public help translation: ${text}`);
});
