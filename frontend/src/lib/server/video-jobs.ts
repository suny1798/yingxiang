import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { validateImageHeader } from '../images/garment-image';
import { inspectVideo } from '../video/mp4';
import { VIDEO_POLICY, type VideoJobState, type VideoJobView, type VideoServiceView } from '../video/policy';
import { localOrigin, StudioError } from './studio-gate';

interface Job {
  id: string; userId: string; state: VideoJobState; createdAt: string; expiresAt: string;
  seconds: number; estimateUsd: number; providerId?: string; checkedAt?: number;
}
interface Ledger { version: 1; jobs: Job[] }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states = new Set(['pending', 'processing', 'completed', 'failed']);
const base = 'https://api.decart.ai/v1/jobs';
const active = (job: Job) => !['completed', 'failed'].includes(job.state);
const view = (job: Job): VideoJobView => ({ id: job.id, state: job.state, createdAt: job.createdAt, expiresAt: job.expiresAt, seconds: job.seconds, estimateUsd: job.estimateUsd, expired: Date.now() >= Date.parse(job.expiresAt) });

/** 单机文件任务仓储。只存元数据，终态及过期任务的预算预留也不自动退回。 */
export class VideoJobs {
  constructor(private readonly directory: string, private readonly env: Readonly<Record<string, string | undefined>> = process.env, private readonly upstream: typeof fetch = fetch) {}
  private config() {
    const budget = Number(this.env.YINGXIANG_VIDEO_BUDGET_USD), maxJobs = Number(this.env.YINGXIANG_VIDEO_MAX_JOBS);
    return { budget, maxJobs, key: this.env.DECART_API_KEY?.trim() ?? '', enabled: this.env.YINGXIANG_VIDEO_ENABLED === 'true' && budget > 0 && budget <= 5 && Number.isInteger(maxJobs) && maxJobs > 0 && maxJobs <= 20 };
  }
  private async transaction<T>(action: (ledger: Ledger) => T | Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const lock = path.join(this.directory, 'jobs.lock'); let handle;
    for (let retry = 0; retry < 100; retry++) {
      try { handle = await open(lock, 'wx', 0o600); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; await new Promise((resolve) => setTimeout(resolve, 25)); }
    }
    if (!handle) throw new StudioError('VIDEO_BUSY', '任务服务正忙，请稍后刷新。', 503);
    const file = path.join(this.directory, 'jobs.json'), temporary = path.join(this.directory, `${randomUUID()}.tmp`);
    try {
      let ledger: Ledger;
      try { ledger = JSON.parse(await readFile(file, 'utf8')) as Ledger; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new StudioError('VIDEO_STORE_UNAVAILABLE', '任务记录无法读取，请联系开发者检查。', 503);
        ledger = { version: 1, jobs: [] };
      }
      if (ledger.version !== 1 || !Array.isArray(ledger.jobs) || ledger.jobs.some((job) => !uuid.test(job.id) || !uuid.test(job.userId) || !Number.isFinite(job.estimateUsd) || job.estimateUsd <= 0 || !Number.isFinite(Date.parse(job.expiresAt)))) throw new StudioError('VIDEO_STORE_UNAVAILABLE', '任务记录格式不兼容。', 503);
      const result = await action(ledger);
      const output = await open(temporary, 'wx', 0o600);
      try { await output.writeFile(JSON.stringify(ledger)); await output.sync(); } finally { await output.close(); }
      await rename(temporary, file);
      return result;
    } finally { await handle.close(); await unlink(temporary).catch(() => {}); await unlink(lock); }
  }
  private own(ledger: Ledger, userId: string, id: string) {
    const job = ledger.jobs.find((entry) => entry.id === id && entry.userId === userId);
    if (!job) throw new StudioError('VIDEO_NOT_FOUND', '找不到这个视频任务。', 404);
    return job;
  }
  async status(request: Request, userId: string | null): Promise<VideoServiceView> {
    localOrigin(request);
    const config = this.config();
    return this.transaction((ledger) => {
      const remaining = config.budget - ledger.jobs.reduce((sum, job) => sum + job.estimateUsd, 0);
      const available = config.enabled && !!config.key && remaining >= VIDEO_POLICY.usdPerSecond && ledger.jobs.length < config.maxJobs && !ledger.jobs.some(active);
      return { available, message: !config.enabled || !config.key ? '视频生成待开放，可先预览素材。' : ledger.jobs.some(active) ? '有任务正在处理或待核查，请先查看任务。' : !available ? '本轮视频额度已用完，请联系开发者。' : '本轮视频生成已开放。', jobs: userId ? ledger.jobs.filter((job) => job.userId === userId).slice(-20).reverse().map(view) : [] };
    });
  }
  private async boundedBody(request: Request, limit: number) {
    if (!request.body || Number(request.headers.get('content-length') ?? 0) > limit) throw new StudioError('VIDEO_TOO_LARGE', '上传内容过大。', 413);
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    const timer = setTimeout(() => { void reader.cancel(); }, 30_000);
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new StudioError('VIDEO_TOO_LARGE', '上传内容过大。', 413); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes;
    } finally { clearTimeout(timer); reader.releaseLock(); }
  }
  async submit(request: Request, userId: string): Promise<VideoJobView> {
    localOrigin(request, true);
    const id = request.headers.get('x-video-attempt') ?? '';
    if (!uuid.test(id)) throw new StudioError('INVALID_VIDEO_ATTEMPT', '缺少有效的提交编号，请刷新后重试。');
    const previous = await this.transaction((ledger) => {
      const job = ledger.jobs.find((entry) => entry.id === id);
      if (job && job.userId !== userId) throw new StudioError('VIDEO_NOT_FOUND', '找不到这个视频任务。', 404);
      return job ? view(job) : null;
    });
    if (previous) return previous;
    const config = this.config();
    if (!config.enabled || !config.key) throw new StudioError('VIDEO_DISABLED', '视频生成待开放，可先预览素材。', 503);
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.length > 256 || !contentType.startsWith('multipart/form-data;')) throw new StudioError('INVALID_VIDEO_UPLOAD', '请通过页面选择视频与服装图。', 415);
    const bytes = await this.boundedBody(request, VIDEO_POLICY.maxBytes + 10 * 1024 * 1024 + 4096);
    let form: FormData;
    try { form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData(); }
    catch { throw new StudioError('INVALID_VIDEO_UPLOAD', '上传内容无法读取，请重新选择素材。'); }
    if ([...form.keys()].sort().join(',') !== 'consentVersion,data,reference_image' || form.get('consentVersion') !== VIDEO_POLICY.consentVersion) throw new StudioError('VIDEO_CONSENT_REQUIRED', '请重新确认视频云端处理说明。');
    const video = form.get('data'), image = form.get('reference_image');
    if (!(video instanceof File) || !(image instanceof File) || video.type !== 'video/mp4' || image.size > 10 * 1024 * 1024) throw new StudioError('INVALID_VIDEO_UPLOAD', '请选择MP4视频和不超过10MB的服装图。');
    let seconds: number;
    try {
      seconds = inspectVideo(new Uint8Array(await video.arrayBuffer())).seconds;
      validateImageHeader(new Uint8Array(await image.arrayBuffer()), image.type, image.size);
    } catch (error) { throw new StudioError('INVALID_VIDEO_MEDIA', error instanceof Error ? error.message : '素材校验失败。'); }
    const estimateUsd = Math.ceil(seconds) * VIDEO_POLICY.usdPerSecond;
    const reservation = await this.transaction((ledger) => {
      const existing = ledger.jobs.find((job) => job.id === id);
      if (existing) { if (existing.userId !== userId) throw new StudioError('VIDEO_NOT_FOUND', '找不到这个视频任务。', 404); return { job: existing, fresh: false }; }
      if (ledger.jobs.some(active)) throw new StudioError('VIDEO_IN_PROGRESS', '请等待现有任务完成或核查，不要重复提交。', 409);
      if (ledger.jobs.length >= config.maxJobs || ledger.jobs.reduce((sum, job) => sum + job.estimateUsd, 0) + estimateUsd > config.budget + 0.000001) throw new StudioError('VIDEO_BUDGET_LIMIT', '本轮视频额度不足，请联系开发者。', 409);
      const now = Date.now();
      // 在网络调用前即保守写为unknown；进程退出也不能把同一任务再次发送。
      const job: Job = { id, userId, state: 'unknown', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + VIDEO_POLICY.resultWindowMs).toISOString(), seconds, estimateUsd };
      ledger.jobs.push(job); return { job, fresh: true };
    });
    if (!reservation.fresh) return view(reservation.job);
    const upload = new FormData();
    upload.set('data', video, 'person.mp4'); upload.set('reference_image', image, image.type === 'image/jpeg' ? 'garment.jpg' : image.type === 'image/webp' ? 'garment.webp' : 'garment.png');
    upload.set('prompt', VIDEO_POLICY.prompt); upload.set('resolution', '720p'); upload.set('enhance_prompt', 'false');
    let provider: { id: string; state: VideoJobState } | null = null;
    try {
      const response = await this.upstream(`${base}/${VIDEO_POLICY.model}`, { method: 'POST', headers: { 'X-API-KEY': config.key }, body: upload, redirect: 'error', signal: AbortSignal.timeout(60_000) });
      const value = response.ok ? await this.smallJson(response) : null;
      if (value && typeof value.job_id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.job_id) && typeof value.status === 'string' && states.has(value.status)) provider = { id: value.job_id, state: value.status as VideoJobState };
    } catch { /* 保留unknown，不输出上游内容，不自动重提。 */ }
    return this.transaction((ledger) => {
      const job = this.own(ledger, userId, id);
      if (provider) { job.providerId = provider.id; job.state = provider.state; }
      return view(job);
    });
  }
  private async smallJson(response: Response): Promise<Record<string, unknown>> {
    const bytes = await this.boundedBody(new Request('http://localhost', { method: 'POST', body: response.body, duplex: 'half' } as RequestInit), 8192);
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  }
  async get(request: Request, userId: string, id: string): Promise<VideoJobView> {
    localOrigin(request);
    const current = await this.transaction((ledger) => {
      const job = this.own(ledger, userId, id);
      const check = !!job.providerId && ['pending', 'processing'].includes(job.state) && Date.now() < Date.parse(job.expiresAt) && Date.now() - (job.checkedAt ?? 0) >= 3000;
      if (check) job.checkedAt = Date.now();
      return { ...job, check };
    });
    if (!current.check) return view(current);
    let state: VideoJobState;
    try {
      const response = await this.upstream(`${base}/${current.providerId}`, { headers: { 'X-API-KEY': this.config().key }, redirect: 'error', signal: AbortSignal.timeout(15_000), cache: 'no-store' });
      const value = response.ok ? await this.smallJson(response) : null;
      if (!value || value.job_id !== current.providerId || typeof value.status !== 'string' || !states.has(value.status)) throw new Error();
      state = value.status as VideoJobState;
    } catch { throw new StudioError('VIDEO_STATUS_UNAVAILABLE', '暂时无法更新进度，稍后可刷新任务；请勿重复提交。', 502); }
    return this.transaction((ledger) => { const job = this.own(ledger, userId, id); if (['pending', 'processing'].includes(job.state) && !(job.state === 'processing' && state === 'pending')) job.state = state; return view(job); });
  }
  async content(request: Request, userId: string, id: string): Promise<Response> {
    localOrigin(request);
    const job = await this.transaction((ledger) => ({ ...this.own(ledger, userId, id) }));
    if (Date.now() >= Date.parse(job.expiresAt)) throw new StudioError('VIDEO_EXPIRED', '视频访问窗口已结束。', 410);
    if (job.state !== 'completed' || !job.providerId) throw new StudioError('VIDEO_NOT_READY', '视频尚未生成完成。', 409);
    let response: Response;
    try { response = await this.upstream(`${base}/${job.providerId}/content`, { headers: { 'X-API-KEY': this.config().key }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(120_000) }); }
    catch { throw new StudioError('VIDEO_DOWNLOAD_UNAVAILABLE', '视频暂时无法下载，请稍后再试。', 502); }
    const type = response.headers.get('content-type')?.split(';')[0].trim();
    if (!response.ok || !response.body || !['video/mp4', 'application/octet-stream'].includes(type ?? '') || Number(response.headers.get('content-length') ?? 0) > 200 * 1024 * 1024) { await response.body?.cancel(); throw new StudioError('VIDEO_DOWNLOAD_UNAVAILABLE', '视频暂时无法下载，请稍后再试。', 502); }
    const reader = response.body.getReader(); let size = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try { const result = await reader.read(); if (result.done) { controller.close(); return; } size += result.value.length; if (size > 200 * 1024 * 1024) { await reader.cancel(); controller.error(new Error('视频结果过大。')); return; } controller.enqueue(result.value); }
        catch { controller.error(new Error('视频传输中断，请重新下载。')); }
      },
      async cancel() { await reader.cancel(); },
    });
    const attachment = new URL(request.url).searchParams.get('download') === '1';
    return new Response(stream, { headers: { 'Content-Type': 'video/mp4', 'Content-Disposition': `${attachment ? 'attachment' : 'inline'}; filename="yingxiang-${job.id}.mp4"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' } });
  }
}
export const videoJobs = new VideoJobs(path.join(process.cwd(), '.cache', 'video-jobs'));
