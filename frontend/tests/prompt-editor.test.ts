import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { composePrompt, type EditInstruction } from '../src/lib/prompt/composition';
import { PromptSession } from '../src/lib/prompt/session';
import type { PromptAdapter, PromptConnectOptions } from '../src/lib/prompt/adapter';
import { SessionScope, createAppQueryClient } from '../src/vue/session-scope';
import { PromptEditor, type PromptEditorPlatform } from '../src/vue/prompt-editor';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const scope = () => new SessionScope(createAppQueryClient(), createPinia());

function setup() {
  const connections: PromptConnectOptions[] = [], updates: string[] = [];
  const adapter: PromptAdapter = {
    async connect(options) { connections.push(options); },
    async update(prompt) { updates.push(prompt); },
    stop() {},
  };
  const session = new PromptSession(adapter), notices: Array<{ message: string; kind: string }> = [];
  let hidden = false, camera = true, closed = 0, login = 0;
  const platform: PromptEditorPlatform = {
    cameraReady: () => camera,
    closeCamera: () => { closed++; },
    openLogin: () => { login++; },
    hidden: () => hidden,
    notify: (message, kind) => { notices.push({ message, kind }); },
    translate: (message) => `[en]${message}`,
  };
  const s = scope(), editor = new PromptEditor(session, platform, s);
  return {
    editor, session, s, connections, updates, notices,
    setHidden: (value: boolean) => { hidden = value; },
    setCamera: (value: boolean) => { camera = value; },
    closed: () => closed,
    login: () => login,
  };
}

test('组合按顺序增删、超过12条拒绝，全删结束生成并回到相机原画', async () => {
  const t = setup();
  await t.s.changeIdentity('user-1');
  assert.equal(t.editor.add(' 把背景改成花园 '), true);
  assert.deepEqual(t.editor.getSnapshot().instructions, [{ id: 1, text: '把背景改成花园' }]);
  assert.equal(t.editor.getSnapshot().draft, '');
  assert.equal(t.editor.getSnapshot().view, 'generated');
  assert.equal(t.connections.length, 0);
  assert.equal(t.notices.at(-1)?.message, '[en]已加入组合，确认云端处理后可开始编辑。');
  for (let index = 1; index < 12; index++) assert.equal(t.editor.add(`第${index + 1}条`), true);
  assert.equal(t.editor.getSnapshot().instructions.length, 12);
  assert.equal(t.editor.add('第13条'), false);
  assert.equal(t.notices.at(-1)?.message, '[en]本次最多保留12条提示词，请先删除不需要的内容。');
  t.editor.setConsent(true);
  assert.equal(t.editor.start(), true);
  await settle(); await settle();
  assert.equal(t.session.getSnapshot().phase, 'live');
  assert.equal(t.connections.length, 1);
  assert.equal(t.editor.remove(2), true);
  await settle();
  assert.equal(t.updates.length, 1);
  for (const item of [...t.editor.getSnapshot().instructions]) t.editor.remove(item.id);
  assert.equal(t.editor.getSnapshot().instructions.length, 0);
  assert.equal(t.editor.getSnapshot().view, 'original');
  assert.equal(t.session.getSnapshot().phase, 'ended');
  assert.equal(t.notices.at(-1)?.message, '[en]已移除全部提示词，已恢复相机原画。');
  assert.equal(t.connections.length, 1);
  t.editor.dispose(); t.s.client.clear();
});

test('四条提示词可前后翻页，删除最后一页内容后返回首页', () => {
  const t = setup();
  for (let index = 1; index <= 4; index++) t.editor.add(`提示词${index}`);
  const visible = () => {
    const state = t.editor.getSnapshot();
    return state.instructions.slice(state.currentPage * state.pageSize, (state.currentPage + 1) * state.pageSize).map(item => item.text);
  };
  assert.deepEqual(visible(), ['提示词4']);
  t.editor.setPage(0);
  assert.deepEqual(visible(), ['提示词1', '提示词2', '提示词3']);
  t.editor.setPage(1);
  assert.deepEqual(visible(), ['提示词4']);
  t.editor.remove(4);
  assert.deepEqual(visible(), ['提示词1', '提示词2', '提示词3']);
  t.editor.dispose(); t.s.client.clear();
});

test('同连接增删同步完整组合，不重新签发、不续时', async () => {
  const t = setup();
  await t.s.changeIdentity('user-1');
  const a: EditInstruction = { id: 1, text: '背景变成花园' }, b: EditInstruction = { id: 2, text: '添加一盆植物' }, c: EditInstruction = { id: 3, text: '衣服变成白色' };
  t.editor.add(a.text); t.editor.add(b.text); t.editor.setConsent(true);
  t.editor.start(); await settle(); await settle();
  const deadline = t.session.getSnapshot().deadlineAt;
  assert.equal(t.connections.length, 1);
  t.editor.add(c.text); await settle();
  assert.equal(t.connections.length, 1);
  assert.equal(t.updates.at(-1), composePrompt([a, b, c]));
  t.editor.remove(a.id); await settle();
  assert.equal(t.connections.length, 1);
  assert.equal(t.updates.at(-1), composePrompt([b, c]));
  assert.equal(t.session.getSnapshot().deadlineAt, deadline);
  assert.equal(t.notices.at(-1)?.message, '[en]已移除，正在同步剩余提示词…');
  t.editor.dispose(); t.s.client.clear();
});

test('账号切换停止连接、关闭相机并清空上一账号组合；访客登录保留组合', async () => {
  const t = setup();
  t.editor.add('访客草稿'); t.editor.setConsent(true);
  assert.equal(t.editor.start(), false);
  assert.equal(t.login(), 1);
  await t.s.changeIdentity('user-1');
  assert.equal(t.editor.getSnapshot().instructions.length, 1);
  t.editor.setConsent(true);
  assert.equal(t.editor.start(), true);
  await settle(); await settle();
  assert.equal(t.session.getSnapshot().phase, 'live');
  await t.s.changeIdentity('user-2');
  assert.equal(t.editor.getSnapshot().instructions.length, 0);
  assert.equal(t.editor.getSnapshot().view, 'original');
  assert.equal(t.editor.getSnapshot().owner, 'user-2');
  assert.equal(t.session.getSnapshot().phase, 'ended');
  assert.equal(t.closed(), 1);
  assert.equal(t.notices.at(-1)?.message, '[en]已清空上一账号的本次提示词。');
  t.editor.add('新账号组合'); t.editor.setConsent(true); t.editor.start();
  await settle(); await settle();
  assert.equal(t.connections.length, 2);
  t.editor.dispose(); t.s.client.clear();
});

test('页面隐藏停止连接与相机，组合保留但不自动重连', async () => {
  const t = setup();
  await t.s.changeIdentity('user-1');
  t.editor.add('花园'); t.editor.setConsent(true); t.editor.start();
  await settle(); await settle();
  assert.equal(t.session.getSnapshot().phase, 'live');
  t.setHidden(false); t.editor.hidden();
  assert.equal(t.session.getSnapshot().phase, 'live');
  assert.equal(t.closed(), 0);
  t.setHidden(true); t.editor.hidden();
  assert.equal(t.session.getSnapshot().phase, 'ended');
  assert.equal(t.closed(), 1);
  assert.equal(t.editor.getSnapshot().instructions.length, 1);
  assert.equal(t.connections.length, 1);
  assert.equal(t.updates.length, 0);
  assert.equal(t.session.getSnapshot().message, '页面已离开前台，实时编辑已结束。');
  t.editor.dispose(); t.s.client.clear();
});

test('未打开相机或未确认云端处理时不会开始；草稿不会进入组合历史', async () => {
  const t = setup();
  await t.s.changeIdentity('user-1');
  t.editor.add('花园'); t.editor.setConsent(true); t.setCamera(false);
  assert.equal(t.editor.start(), false);
  assert.equal(t.connections.length, 0);
  assert.equal(t.notices.at(-1)?.message, '[en]请先打开相机并等待预览就绪。');
  t.setCamera(true); t.editor.setConsent(false);
  assert.equal(t.editor.start(), false);
  t.editor.setDraft('尚未发送的草稿');
  assert.deepEqual(t.session.getSnapshot().history, []);
  t.editor.dispose(); t.s.client.clear();
});
