import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectVideo } from '../src/lib/video/mp4';
import { VIDEO_POLICY } from '../src/lib/video/policy';
import { VideoJobs } from '../src/lib/server/video-jobs';
import { StudioError } from '../src/lib/server/studio-gate';
import { AccountStore } from '../src/lib/server/account-store';

const url = 'http://127.0.0.1:8787/api/video/jobs';
const env = { YINGXIANG_VIDEO_ENABLED: 'true', YINGXIANG_VIDEO_BUDGET_USD: '1', YINGXIANG_VIDEO_MAX_JOBS: '2', DECART_API_KEY: 'unit-test-secret' };
const video = readFileSync('public/assets/try-on-demo.mp4'); // 仓库合成动画，只用于离线容器/接口测试。
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const get = () => new Request(url, { headers: { host: '127.0.0.1:8787' } });
const req = (id = randomUUID(), data: Uint8Array = video, consentVersion: string = VIDEO_POLICY.consentVersion) => {
  const form = new FormData(); form.set('data', new Blob([new Uint8Array(data)], { type: 'video/mp4' }), 'input.mp4'); form.set('reference_image', new Blob([png], { type: 'image/png' }), 'garment.png'); form.set('consentVersion', consentVersion);
  return new Request(url, { method: 'POST', headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787', 'x-video-attempt': id }, body: form });
};
const hasCode = (code: string) => (error: unknown) => error instanceof StudioError && error.code === code;
async function setup(options: { unknown?: boolean; environment?: typeof env } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yingxiang-video-'));
  const calls: { url: string; method: string }[] = [];
  let state = 'pending', failStatus = false, failResult = false;
  const upstream: typeof fetch = async (input, init) => {
    const target = String(input), method = init?.method ?? 'GET'; calls.push({ url: target, method });
    assert.equal((init?.headers as Record<string, string>)['X-API-KEY'], 'unit-test-secret');
    assert.equal(init?.redirect, 'error');
    if (method === 'POST') {
      const form = init?.body as FormData;
      assert.deepEqual([...form.keys()].sort(), ['data', 'enhance_prompt', 'prompt', 'reference_image', 'resolution']);
      assert.equal(form.get('resolution'), '720p'); assert.equal(form.get('prompt'), VIDEO_POLICY.prompt);
      assert.equal(form.get('enhance_prompt'), 'false');
      assert.equal(target, 'https://api.decart.ai/v1/jobs/lucy-vton-3.6');
      if (options.unknown) throw new Error('credential unit-test-secret RAWDIAGNOSTIC');
    }
    if (target.endsWith('/content')) return failResult ? new Response(null, { status: 503 }) : new Response(video, { headers: { 'Content-Type': 'video/mp4' } });
    if (method !== 'POST' && failStatus) throw new Error('RAWDIAGNOSTIC');
    return Response.json({ job_id: 'provider-1', status: state });
  };
  return { dir, service: new VideoJobs(dir, options.environment ?? env, upstream), calls, upstream, setState(value: string) { state = value; }, failStatus() { failStatus = true; }, failResult() { failResult = true; } };
}

test('MP4检查真实合成素材的时长、尺寸；拒绝伪造、超限、音轨与时间信息低报', () => {
  assert.deepEqual(inspectVideo(video), { seconds: 9, width: 1280, height: 720 });
  assert.throws(() => inspectVideo(new Uint8Array(35)), /格式/);
  assert.throws(() => inspectVideo(new Uint8Array(VIDEO_POLICY.maxBytes + 1)), /25MB/);
  const audio = Buffer.from(video); const handler = audio.indexOf('vide'); assert.ok(handler > 0); audio.write('soun', handler); assert.throws(() => inspectVideo(audio), /音轨/);
  const long = Buffer.from(video); const movie = long.indexOf('mvhd'); const scale = long.readUInt32BE(movie + 16); long.writeUInt32BE(scale * 16, movie + 20); assert.throws(() => inspectVideo(long), /15秒/);
  const mismatch = Buffer.from(video); mismatch.writeUInt32BE(scale * 2, movie + 20); assert.throws(() => inspectVideo(mismatch), /时间信息/);
  const brokenTimeline = Buffer.from(video); const stts = brokenTimeline.indexOf('stts'); brokenTimeline.writeUInt32BE(9_999_999, stts + 12); assert.throws(() => inspectVideo(brokenTimeline), /时间表/);
  for (let index = 0; index < 40; index++) assert.throws(() => inspectVideo(video.subarray(0, index * 53)));
});

test('默认关闭、来源、同意版本与媒体无效都不提交供应商', async () => {
  const s = await setup({ environment: { ...env, YINGXIANG_VIDEO_ENABLED: 'false' } });
  const user = randomUUID();
  assert.equal((await s.service.status(get(), null)).available, false);
  await assert.rejects(s.service.submit(req(), user), hasCode('VIDEO_DISABLED'));
  const t = await setup();
  const cross = req(); cross.headers.set('origin', 'https://other.example'); await assert.rejects(t.service.submit(cross, user), hasCode('ORIGIN_REJECTED'));
  await assert.rejects(t.service.submit(req(randomUUID(), video, 'old'), user), hasCode('VIDEO_CONSENT_REQUIRED'));
  await assert.rejects(t.service.submit(req(randomUUID(), new Uint8Array(80)), user), hasCode('INVALID_VIDEO_MEDIA'));
  assert.equal(s.calls.length + t.calls.length, 0);
});

test('幂等提交、重启恢复、跨用户隔离、并发重复仅发一次；落盘无密钥/媒体', async () => {
  const s = await setup(), user = randomUUID(), id = randomUUID();
  const result = await Promise.all([s.service.submit(req(id), user), s.service.submit(req(id), user)]);
  assert.equal(result[0].id, result[1].id); assert.equal(s.calls.length, 1);
  const reloaded = new VideoJobs(s.dir, env, s.upstream);
  assert.equal((await reloaded.submit(req(id), user)).state, 'pending'); assert.equal(s.calls.length, 1);
  assert.equal((await reloaded.status(get(), user)).jobs.length, 1);
  assert.equal((await reloaded.status(get(), randomUUID())).jobs.length, 0);
  await assert.rejects(reloaded.get(get(), randomUUID(), id), hasCode('VIDEO_NOT_FOUND'));
  await assert.rejects(reloaded.content(get(), randomUUID(), id), hasCode('VIDEO_NOT_FOUND'));
  await assert.rejects(reloaded.submit(req(id), randomUUID()), hasCode('VIDEO_NOT_FOUND'));
  const ledger = await readFile(path.join(s.dir, 'jobs.json'), 'utf8'); assert.doesNotMatch(ledger, /unit-test-secret|reference_image|input.mp4|RAWDIAGNOSTIC|base64/);
});

test('不同任务并发仅允许一个在途，完成后全局预算仍保守扣留', async () => {
  const s = await setup({ environment: { ...env, YINGXIANG_VIDEO_BUDGET_USD: '0.50' } }), user = randomUUID();
  const outcomes = await Promise.allSettled([s.service.submit(req(), user), s.service.submit(req(), user)]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1); assert.equal(s.calls.length, 1);
  const job = (await s.service.status(get(), user)).jobs[0]; assert.equal(job.estimateUsd, .36);
  await assert.rejects(s.service.content(get(), user, job.id), hasCode('VIDEO_NOT_READY'));
  s.setState('completed'); assert.equal((await s.service.get(get(), user, job.id)).state, 'completed');
  await assert.rejects(s.service.submit(req(), user), hasCode('VIDEO_BUDGET_LIMIT')); assert.equal(s.calls.filter((call) => call.method === 'POST').length, 1);
});

test('上游提交不确定不自动重提、不退预算，未知任务阻止新的提交', async () => {
  const s = await setup({ unknown: true }), user = randomUUID(), id = randomUUID();
  assert.equal((await s.service.submit(req(id), user)).state, 'unknown');
  assert.equal((await s.service.submit(req(id), user)).state, 'unknown');
  await assert.rejects(s.service.submit(req(), user), hasCode('VIDEO_IN_PROGRESS'));
  assert.equal(s.calls.length, 1); assert.doesNotMatch(await readFile(path.join(s.dir, 'jobs.json'), 'utf8'), /RAWDIAGNOSTIC|unit-test-secret/);
});

test('状态查询失败保留任务且限频，成功后结果鉴权转发、可下载，过期不可访问', async () => {
  const s = await setup(), user = randomUUID(); const job = await s.service.submit(req(), user);
  s.setState('completed'); assert.equal((await s.service.get(get(), user, job.id)).state, 'completed');
  const result = await s.service.content(new Request(`${url}/${job.id}/content?download=1`, { headers: { host: '127.0.0.1:8787' } }), user, job.id);
  assert.equal(result.headers.get('Content-Type'), 'video/mp4'); assert.match(result.headers.get('Content-Disposition')!, /^attachment/); assert.equal(result.headers.get('Cache-Control'), 'no-store'); assert.deepEqual(Buffer.from(await result.arrayBuffer()), video);
  s.failResult(); await assert.rejects(s.service.content(get(), user, job.id), hasCode('VIDEO_DOWNLOAD_UNAVAILABLE'));
  const ledgerFile = path.join(s.dir, 'jobs.json'), ledger = JSON.parse(await readFile(ledgerFile, 'utf8')); ledger.jobs[0].expiresAt = new Date(0).toISOString(); await writeFile(ledgerFile, JSON.stringify(ledger));
  await assert.rejects(s.service.content(get(), user, job.id), hasCode('VIDEO_EXPIRED'));
  const t = await setup(); const pending = await t.service.submit(req(), user); t.failStatus(); await assert.rejects(t.service.get(get(), user, pending.id), hasCode('VIDEO_STATUS_UNAVAILABLE'));
  assert.equal((await t.service.get(get(), user, pending.id)).state, 'pending'); assert.equal(t.calls.length, 2);
});

test('GET任务登录校验支持无Origin的同源读取；未登录不允许，其他账号不冒用', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yingxiang-video-auth-')), store = new AccountStore(dir);
  await assert.rejects(store.requireUser(get(), false), hasCode('LOGIN_REQUIRED'));
  const signed = await store.authenticate(new Request('http://127.0.0.1:8787/api/account/register', { method: 'POST', headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787', 'content-type': 'application/json' }, body: JSON.stringify({ username: 'video_unit', password: 'unit-password' }) }), true);
  const request = get(); request.headers.set('cookie', signed.cookie.split(';')[0]);
  assert.equal(await store.requireUser(request, false), signed.view.user!.id);
  await assert.rejects(store.requireUser(request), hasCode('ORIGIN_REJECTED'));
});

test('请求体超限在上游前拒绝，损坏账本不重建；失败任务也占用有限任务数', async () => {
  const s = await setup({ environment: { ...env, YINGXIANG_VIDEO_MAX_JOBS: '1' } }), user = randomUUID();
  const large = req(); large.headers.set('content-length', '99999999'); await assert.rejects(s.service.submit(large, user), hasCode('VIDEO_TOO_LARGE')); assert.equal(s.calls.length, 0);
  const job = await s.service.submit(req(), user); s.setState('failed'); assert.equal((await s.service.get(get(), user, job.id)).state, 'failed');
  await assert.rejects(s.service.submit(req(), user), hasCode('VIDEO_BUDGET_LIMIT')); assert.equal(s.calls.filter((call) => call.method === 'POST').length, 1);
  await writeFile(path.join(s.dir, 'jobs.json'), 'broken');
  await assert.rejects(s.service.status(get(), user), hasCode('VIDEO_STORE_UNAVAILABLE')); assert.equal(await readFile(path.join(s.dir, 'jobs.json'), 'utf8'), 'broken');
});
