import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import type { PreparationProgress } from '../src/lib/video/prepare';
import type { VideoJobView, VideoServiceView } from '../src/lib/video/policy';
import { SessionScope, createAppQueryClient } from '../src/vue/session-scope';
import { VideoJobs, inProgress, type VideoSubmitInput } from '../src/vue/video-jobs';

const scope = () => new SessionScope(createAppQueryClient(), createPinia());
const tick = () => new Promise((resolve) => setImmediate(resolve));
const file = (name = 'person.mp4') => new File([new Uint8Array(8)], name, { type: 'video/mp4' });
const garment = () => new Blob([new Uint8Array(4)], { type: 'image/png' });
const job = (id: string, state: VideoJobView['state'] = 'pending', over: Partial<VideoJobView> = {}): VideoJobView => ({
  id, state, createdAt: '2026-10-28T00:00:00.000Z', expiresAt: '2026-10-29T00:00:00.000Z', seconds: 7.5, estimateUsd: 0.3, expired: false, ...over,
});
const service = (jobs: VideoJobView[] = [], available = true): VideoServiceView => ({ available, message: available ? '本轮视频生成已开放。' : '视频生成待开放，可先预览素材。', jobs });

function platform() {
  const services: Array<{ signal: AbortSignal; resolve: (value: VideoServiceView) => void; reject: (error: unknown) => void }> = [];
  const polls: Array<{ id: string; signal: AbortSignal; resolve: (value: VideoJobView) => void; reject: (error: unknown) => void }> = [];
  const submits: Array<{ signal: AbortSignal; input: VideoSubmitInput; resolve: (value: VideoJobView) => void; reject: (error: unknown) => void }> = [];
  const prepares: Array<{ signal: AbortSignal; file: File; progress: (value: PreparationProgress) => void; resolve: (value: Blob) => void; reject: (error: unknown) => void }> = [];
  const notices: Array<{ message: string; kind: string }> = [];
  let hidden = false;
  let submitCount = 0;
  const value = {
    fetchService: (signal: AbortSignal) => new Promise<VideoServiceView>((resolve, reject) => { services.push({ signal, resolve, reject }); }),
    fetchJob: (signal: AbortSignal, id: string) => new Promise<VideoJobView>((resolve, reject) => { polls.push({ id, signal, resolve, reject }); }),
    submit: (signal: AbortSignal, input: VideoSubmitInput) => new Promise<VideoJobView>((resolve, reject) => { submitCount++; submits.push({ signal, input, resolve, reject }); }),
    prepare: (signal: AbortSignal, input: File, progress: (value: PreparationProgress) => void) => new Promise<Blob>((resolve, reject) => {
      const entry = { signal, file: input, progress, resolve, reject };
      prepares.push(entry);
      signal.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')), { once: true });
    }),
    inspect: () => ({ seconds: 7.5, hasAudio: false }),
    hidden: () => hidden,
    notify: (message: string, kind: string) => { notices.push({ message, kind }); },
    translate: (message: string) => `[en]${message}`,
  };
  return {
    value, services, polls, submits, prepares, notices,
    submitCount: () => submitCount,
    setHidden: (next: boolean) => { hidden = next; },
    resolveService: (value: VideoServiceView) => services.shift()!.resolve(value),
    rejectService: (error: unknown) => services.shift()!.reject(error),
    resolvePoll: (value: VideoJobView) => polls.shift()!.resolve(value),
    resolveSubmit: (value: VideoJobView) => submits.shift()!.resolve(value),
    rejectSubmit: (error: unknown) => submits.shift()!.reject(error),
  };
}

async function login(s: SessionScope, p: ReturnType<typeof platform>, initial = service()) {
  await s.changeIdentity('user-1');
  assert.equal(p.services.length, 1);
  p.resolveService(initial);
  await tick();
}

test('未登录不发私有请求；登录后读取服务状态与本人任务', async () => {
  const s = scope(), p = platform(), jobs = new VideoJobs(s, p.value);
  await jobs.refresh();
  assert.equal(p.services.length, 0);
  assert.equal(jobs.getSnapshot().owner, null);
  await login(s, p);
  assert.equal(jobs.getSnapshot().owner, 'user-1');
  assert.equal(jobs.getSnapshot().service?.available, true);
  assert.equal(jobs.getSnapshot().loading, false);
  const failure = jobs.refresh(); await tick(); p.rejectService(new Error('任务读取失败。')); await failure;
  assert.equal(jobs.getSnapshot().error, '任务读取失败。');
  jobs.dispose(); s.client.clear();
});

test('生成完成后继续等待结果文件核验，刷新最终时长和结算', async () => {
  const s = scope(), p = platform(), jobs = new VideoJobs(s, p.value);
  const pending = job('result-1', 'completed', { resultPending: true });
  await login(s, p, service([pending])); jobs.select(pending);
  const running = jobs.poll();
  assert.equal(p.polls.length, 1);
  p.resolvePoll(job('result-1', 'completed', { resultPending: false, resultSeconds: 4.934, billing: { state: 'settled', reservedCredits: 6, chargedCredits: 5, returnedCredits: 1 } }));
  await tick();
  p.resolveService(service([job('result-1', 'completed', { resultPending: false, resultSeconds: 4.934, billing: { state: 'settled', reservedCredits: 6, chargedCredits: 5, returnedCredits: 1 } })]));
  await running;
  assert.equal(jobs.getSnapshot().selected?.resultSeconds, 4.934);
  assert.equal(jobs.getSnapshot().selected?.billing?.returnedCredits, 1);
  await jobs.poll(); assert.equal(p.polls.length, 0);
  jobs.dispose(); s.client.clear();
});

test('提交只POST一次，使用同一提交编号并读取服务状态', async () => {
  const s = scope(), p = platform(), jobs = new VideoJobs(s, p.value);
  await login(s, p);
  const pending = jobs.submit({ file: file(), garment: garment(), hasAudio: false, consentVersion: 'v1' });
  assert.equal(jobs.getSnapshot().submitting, true);
  assert.equal(p.submits.length, 1);
  const input = p.submits[0].input;
  assert.match(input.attemptId, /^[0-9a-f-]{36}$/);
  assert.equal(input.consentVersion, 'v1');
  p.resolveSubmit(job(input.attemptId));
  await tick();
  assert.equal(jobs.getSnapshot().selected?.state, 'pending');
  assert.equal(p.services.length, 1);
  p.resolveService(service([job(input.attemptId)]));
  await pending;
  assert.equal(p.submitCount(), 1);
  assert.equal(jobs.getSnapshot().submitting, false);
  assert.deepEqual(p.notices[0], { message: '[en]视频已提交处理，可在“我的作品”查看进度和保存结果。', kind: 'success' });
  jobs.dispose(); s.client.clear();
});

test('提交网络未知不重试，只从列表恢复同一提交编号', async () => {
  const s = scope(), p = platform(), jobs = new VideoJobs(s, p.value);
  await login(s, p);
  const running = jobs.submit({ file: file(), garment: garment(), hasAudio: false, consentVersion: 'v1' });
  assert.equal(p.submits.length, 1);
  const attempt = p.submits[0].input.attemptId;
  p.rejectSubmit(new Error('network'));
  await tick();
  assert.equal(jobs.getSnapshot().error, '提交结果尚未确认，请刷新任务核查，不要再次生成。');
  assert.equal(jobs.getSnapshot().unknown, true);
  assert.equal(p.submitCount(), 1);
  assert.equal(p.services.length, 1);
  p.resolveService(service([job(attempt, 'processing')]));
  await running;
  assert.equal(p.submitCount(), 1);
  assert.equal(jobs.getSnapshot().selected?.id, attempt);
  assert.equal(jobs.getSnapshot().unknown, false);
  assert.equal(p.notices.at(-1)?.message, '[en]已从任务列表恢复本次提交，请查看状态，不要再次生成。');
  jobs.dispose(); s.client.clear();
});

test('轮询processing→completed并回读列表；failed保留原状态', async () => {
  const s = scope(), p = platform(), jobs = new VideoJobs(s, p.value);
  const pending = job('job-1', 'pending');
  await login(s, p, service([pending]));
  jobs.select(pending);
  const first = jobs.poll();
  assert.equal(p.polls.length, 1); p.resolvePoll(job('job-1', 'processing')); await first;
  assert.equal(jobs.getSnapshot().selected?.state, 'processing');
  const second = jobs.poll();
  p.resolvePoll(job('job-1', 'completed'));
  await tick();
  assert.equal(p.services.length, 1);
  p.resolveService(service([job('job-1', 'completed')]));
  await second;
  assert.equal(jobs.getSnapshot().selected?.state, 'completed');
  assert.equal(inProgress(jobs.getSnapshot().selected!), false);
  const failed = jobs.refresh();
  await tick();
  assert.equal(p.polls.length, 0);
  p.resolveService(service([job('job-1', 'failed')]));
  await failed;
  assert.equal(jobs.getSnapshot().selected?.state, 'failed');
  jobs.dispose(); s.client.clear();
});

test('页面不可见时不轮询', async () => {
  const s = scope(), p = platform(), jobs = new VideoJobs(s, p.value);
  await login(s, p, service([job('job-1', 'pending')]));
  p.setHidden(true);
  await jobs.poll();
  assert.equal(p.polls.length, 0);
  jobs.hidden();
  p.setHidden(false);
  const running = jobs.poll();
  assert.equal(p.polls.length, 1); p.resolvePoll(job('job-1', 'processing')); await running;
  jobs.dispose(); s.client.clear();
});

test('页面不可见取消在途提交与准备，迟到结果不进入界面', async () => {
  const s = scope(), p = platform(), jobs = new VideoJobs(s, p.value);
  await login(s, p);
  const running = jobs.submit({ file: file(), garment: garment(), hasAudio: false, consentVersion: 'v1' });
  const submit = p.submits[0];
  p.setHidden(true); jobs.hidden();
  assert.equal(submit.signal.aborted, true);
  p.resolveSubmit(job(submit.input.attemptId));
  await running;
  assert.equal(jobs.getSnapshot().selected, null);
  assert.equal(jobs.getSnapshot().submitting, false);
  p.setHidden(false);
  const preparing = jobs.submit({ file: file(), garment: garment(), hasAudio: true, consentVersion: 'v1' });
  assert.equal(p.prepares.length, 1);
  p.setHidden(true); jobs.hidden();
  assert.equal(p.prepares[0].signal.aborted, true);
  await preparing;
  assert.equal(p.submitCount(), 1);
  assert.equal(jobs.getSnapshot().preparing, false);
  assert.equal(jobs.getSnapshot().selected, null);
  jobs.dispose(); s.client.clear();
});

test('换账号取消在途提交并丢弃旧账号迟到结果', async () => {
  const s = scope(), p = platform(), jobs = new VideoJobs(s, p.value);
  await login(s, p);
  const running = jobs.submit({ file: file(), garment: garment(), hasAudio: false, consentVersion: 'v1' });
  const attempt = p.submits[0].input.attemptId;
  assert.equal(p.submits[0].signal.aborted, false);
  await s.changeIdentity('user-2');
  assert.equal(p.submits[0].signal.aborted, true);
  assert.equal(jobs.getSnapshot().selected, null);
  assert.equal(p.services.length, 1);
  p.resolveSubmit(job(attempt));
  await running;
  assert.equal(jobs.getSnapshot().selected, null);
  p.resolveService(service());
  await tick();
  assert.equal(jobs.getSnapshot().owner, 'user-2');
  assert.equal(jobs.getSnapshot().selected, null);
  jobs.dispose(); s.client.clear();
});

test('卸载取消在途轮询，迟到结果不进入界面', async () => {
  const s = scope(), p = platform(), jobs = new VideoJobs(s, p.value);
  await login(s, p, service([job('job-1', 'pending')]));
  const running = jobs.poll();
  assert.equal(p.polls.length, 1);
  jobs.dispose();
  assert.equal(p.polls[0].signal.aborted, true);
  p.resolvePoll(job('job-1', 'completed'));
  await running;
  assert.equal(jobs.getSnapshot().selected, null);
  s.client.clear();
});

test('含音轨先准备；取消不提交，准备结果只用于本次提交', async () => {
  const s = scope(), p = platform(), jobs = new VideoJobs(s, p.value);
  await login(s, p);
  const cancelled = jobs.submit({ file: file(), garment: garment(), hasAudio: true, consentVersion: 'v1' });
  assert.equal(jobs.getSnapshot().preparing, true);
  assert.deepEqual(jobs.getSnapshot().preparation, { stage: 'upload', percent: 0 });
  p.prepares[0].progress({ stage: 'processing' });
  assert.deepEqual(jobs.getSnapshot().preparation, { stage: 'processing' });
  jobs.cancelPreparation();
  await cancelled;
  assert.equal(p.submits.length, 0);
  assert.equal(jobs.getSnapshot().preparing, false);
  assert.equal(p.notices.at(-1)?.message, '[en]已取消视频处理。');
  const running = jobs.submit({ file: file(), garment: garment(), hasAudio: true, consentVersion: 'v1' });
  p.prepares.at(-1)!.resolve(new Blob([new Uint8Array(16)], { type: 'video/mp4' }));
  await tick();
  assert.equal(p.submits.length, 1);
  assert.equal(p.submits[0].input.file.name, 'person.mp4');
  assert.equal(p.submits[0].input.file.type, 'video/mp4');
  p.resolveSubmit(job(p.submits[0].input.attemptId));
  await tick();
  p.resolveService(service());
  await running;
  assert.equal(p.submitCount(), 1);
  assert.equal(jobs.getSnapshot().preparing, false);
  jobs.dispose(); s.client.clear();
});
