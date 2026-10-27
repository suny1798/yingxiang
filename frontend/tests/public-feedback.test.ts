import assert from 'node:assert/strict';
import test from 'node:test';
import fixture from './fixtures/legacy-feedback-reports.json';
import { buildFeedbackReport, feedbackCategories } from '../src/lib/public-feedback';
import type { Locale } from '../src/lib/i18n';

test('本机反馈报告匹配原React处理函数的8个合成输出向量', () => {
  assert.equal(fixture.fixtures.length,8);
  for (const row of fixture.fixtures) assert.equal(buildFeedbackReport(row.category,row.fields,row.locale as Locale,'2026-10-28T00:00:00.000Z'),row.report,row.name);
});

test('只整理已知分类和必填内容，不将额外字段纳入报告', () => {
  assert.equal(feedbackCategories.length,6);
  assert.equal(buildFeedbackReport('invalid',{summary:'title',details:'detail'},'zh'),null);
  const result=buildFeedbackReport('connection',{summary:'synthetic title',details:'synthetic detail',cookie:'never-copy-extra-fields'},'en');
  assert.ok(result?.includes('Not provided')); assert.ok(!result?.includes('never-copy-extra-fields'));
});
