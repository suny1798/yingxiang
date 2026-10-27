import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkUpload, type SaveSnapshot } from '../src/lib/works-upload';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('实时编辑记录按序随视频上传，数组复制且重复渲染不重复保存', async () => {
  const calls: Array<{ path: string; body: unknown }> = [], states: SaveSnapshot[] = [];
  const upload = new WorkUpload('owner', 'edit', 15, value => states.push(value), async (url, init) => {
    calls.push({ path: String(url), body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
    return Response.json(init?.method === 'GET' ? { state: 'ready' } : { accepted: true });
  });
  const history = [{ atMs: 0, instructions: ['米白色上衣'] }];
  upload.addPromptHistory(history); history[0].instructions[0] = '不得污染已缓存内容';
  upload.start('video/webm'); upload.chunk(new Blob(['video']));
  history.push({ atMs: 2000, instructions: ['蓝色上衣', '保留人物面部'] });
  upload.addPromptHistory(history); upload.addPromptHistory(history); upload.complete();
  for (let i = 0; i < 20 && states.at(-1)?.phase !== 'saved'; i++) await settle();
  const prompts = calls.filter(call => call.path.includes('/prompts/'));
  assert.deepEqual(prompts.map(call => call.path.split('/').at(-1)), ['0', '1']);
  assert.deepEqual(prompts.map(call => call.body), [{ atMs: 0, instructions: ['米白色上衣'] }, { atMs: 2000, instructions: ['蓝色上衣', '保留人物面部'] }]);
  assert.ok(calls.findIndex(call => call.path.endsWith('/complete')) > calls.findIndex(call => call.path.endsWith('/prompts/1')));
  assert.equal(states.at(-1)?.phase, 'saved');
});

test('提示词保存失败仍完成视频，并上报缺失而不是伪报完整', async () => {
  let completed: Record<string, unknown> | undefined;
  const states: SaveSnapshot[] = [];
  const upload = new WorkUpload('owner', 'edit', 15, value => states.push(value), async (url, init) => {
    if (String(url).includes('/prompts/')) return Response.json({}, { status: 400 });
    if (String(url).endsWith('/complete')) completed = JSON.parse(String(init?.body));
    return Response.json(init?.method === 'GET' ? { state: 'ready', message: '部分提示词未能保存' } : {});
  });
  upload.addPromptHistory([{ atMs: 0, instructions: ['米白色上衣'] }]);
  upload.start('video/mp4'); upload.chunk(new Blob(['video'])); upload.complete();
  for (let i = 0; i < 20 && states.at(-1)?.phase !== 'saved'; i++) await settle();
  assert.equal(completed?.promptsFailed, true); assert.equal(states.at(-1)?.phase, 'saved');
  assert.match(states.at(-1)?.message ?? '', /提示词/);
});
test('录制片段后台顺序上传，保存实际使用的多张参考图并按源图去重', async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [], states: SaveSnapshot[] = [];
  const request: typeof fetch = async (url, init) => {
    calls.push({ path: String(url), init });
    return Response.json(init?.method === 'GET' ? { state: 'ready', message: null } : { accepted: true });
  };
  const upload = new WorkUpload('owner-start', 'realtime', 15, value => states.push(value), request);
  const first = { id: 'garment-one', blob: new Blob(['first-image'], { type: 'image/png' }) };
  upload.addReference(first); upload.start('video/webm;codecs=vp8');
  upload.chunk(new Blob(['first-frame'])); upload.addReference(first);
  upload.addReference({ id: 'garment-two', blob: new Blob(['second-image'], { type: 'image/webp' }) });
  upload.chunk(new Blob(['last-frame'])); upload.complete(); upload.complete();
  for (let i = 0; i < 10 && states.at(-1)?.phase !== 'saved'; i++) await settle();
  assert.equal(states.at(-1)?.phase, 'saved');
  assert.equal(calls.filter(c => c.path === '/api/works').length, 1);
  assert.equal(calls.filter(c => c.path.includes('/references/')).length, 2);
  assert.deepEqual(calls.filter(c => c.path.includes('/chunks/')).map(c => c.path.split('/').at(-1)), ['0', '1']);
  assert.equal(calls.filter(c => c.path.endsWith('/complete')).length, 1);
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.ownerId, 'owner-start'); assert.equal(body.mime, 'video/webm');
  assert.ok(calls.every(c => (c.init?.headers as Record<string, string>)['X-Work-Owner'] === 'owner-start'));
  const references = calls.filter(c => c.path.includes('/references/'));
  assert.equal(await (references[0].init?.body as Blob).text(), 'first-image');
  assert.equal(await (references[1].init?.body as Blob).text(), 'second-image');
});

test('账号切换被后端拒绝后停止上传，不把剩余片段写给新账号', async () => {
  const calls: string[] = [], states: SaveSnapshot[] = [];
  const upload = new WorkUpload('original-owner', 'realtime', 15, value => states.push(value), async (url) => {
    calls.push(String(url)); return Response.json({ error: { message: '账号已变更' } }, { status: 409 });
  });
  upload.start('video/mp4'); upload.chunk(new Blob(['video'])); upload.complete();
  for (let i = 0; i < 10; i++) await settle();
  assert.equal(states.at(-1)?.phase, 'error');
  assert.ok(!calls.some(path => path.includes('/chunks/')));
  assert.equal(calls.filter(path => path === '/api/works').length, 1);
});

test('参考图失败不丢弃视频，完成时向后端明确报告参考图保存失败', async () => {
  let completion: Record<string, unknown> | undefined;
  const states: SaveSnapshot[] = [];
  const upload = new WorkUpload('owner', 'realtime', 30, value => states.push(value), async (url, init) => {
    if (String(url).includes('/references/')) return Response.json({ error: { message: 'invalid image' } }, { status: 400 });
    if (String(url).endsWith('/complete')) completion = JSON.parse(String(init?.body));
    return Response.json(init?.method === 'GET' ? { state: 'ready' } : { accepted: true });
  });
  upload.addReference({ id: 'shirt', blob: new Blob(['image'], { type: 'image/png' }) });
  upload.start('video/webm'); upload.chunk(new Blob(['video'])); upload.complete();
  for (let i = 0; i < 10 && states.at(-1)?.phase !== 'saved'; i++) await settle();
  assert.equal(states.at(-1)?.phase, 'saved'); assert.equal(completion?.referenceFailed, true);
});

test('编码中断收尾时标记部分录像，不把已有片段伪报为完整会话', async () => {
  let completion: Record<string, unknown> | undefined;
  const states: SaveSnapshot[] = [];
  const upload = new WorkUpload('owner', 'realtime', 15, value => states.push(value), async (url, init) => {
    if (String(url).endsWith('/complete')) completion = JSON.parse(String(init?.body));
    return Response.json(init?.method === 'GET' ? { state: 'ready', message: '已保存收到的片段' } : { accepted: true });
  });
  upload.start('video/webm'); upload.chunk(new Blob(['partial'])); upload.fail('编码中断');
  for (let i = 0; i < 10 && states.at(-1)?.phase !== 'saved'; i++) await settle();
  assert.equal(completion?.interrupted, true); assert.equal(states.at(-1)?.message, '已保存收到的片段');
});
