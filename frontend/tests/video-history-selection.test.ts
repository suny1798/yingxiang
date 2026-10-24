import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshVideoSelection } from '../src/lib/video/history-selection';
import type { VideoJobView } from '../src/lib/video/policy';
const job: VideoJobView = { id: 'fixture', state: 'completed', createdAt: '2026-10-24T00:00:00Z', expiresAt: '2026-10-25T00:00:00Z', seconds: 8, estimateUsd: .32, expired: false };
test('首次打开及返回创作后，即使存在完成历史也不自动加载视频', () => { assert.equal(refreshVideoSelection(null, [job]), null); });
test('刷新仅更新明确选择的任务，并保留自定义名称', () => { const current = { ...job, title: '我的穿搭', state: 'processing' as const }; const result = refreshVideoSelection(current, [job]); assert.equal(result?.state, 'completed'); assert.equal(result?.title, '我的穿搭'); });
test('查看分页中的较早历史，不被最近任务自动替换', () => { const older = { ...job, id: 'older' }; assert.equal(refreshVideoSelection(older, [job]), older); });
