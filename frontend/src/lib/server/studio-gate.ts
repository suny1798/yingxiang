import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STUDIO_POLICY, isDurationSec, type DurationSec, type StudioObservation, type StudioStatus } from '../studio/policy';

export class StudioError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}
const origins = new Set(['http://127.0.0.1:8787', 'http://localhost:8787']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function localOrigin(request: Request, mutation = false): string {
  const url = new URL(request.url), origin = `${url.protocol}//${request.headers.get('host')}`;
  if (!origins.has(origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new StudioError('LOCAL_ONLY', '此验证入口仅允许本机页面访问。', 403);
  const sentOrigin = request.headers.get('origin');
  if ((mutation || sentOrigin !== null) && sentOrigin !== origin) throw new StudioError('ORIGIN_REJECTED', '页面来源不符，请从本机验证入口重新打开。', 403);
  return origin;
}

export async function readBoundedJson(body: ReadableStream<Uint8Array> | null, limit = 4096): Promise<Record<string, unknown>> {
  if (!body) throw new StudioError('INVALID_REQUEST', '缺少请求内容。');
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new StudioError('BODY_TOO_LARGE', '请求内容过大。', 413); } chunks.push(value); }
    const joined = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) { if (error instanceof StudioError) throw error; throw new StudioError('INVALID_REQUEST', '请求内容无法读取。'); }
  finally { reader.releaseLock(); }
}

interface Ledger {
  batchId: string; attemptId: string; userId?: string; state: 'reserved' | 'issued' | 'unknown' | 'finished';
  createdAt: string; updatedAt?: string; model: string; approvedBudgetUsd: number;
  connectionCapSec: number; singleConnectionEstimateUsd: number;
  observation?: StudioObservation;
}
export class StudioGate {
  private accessFile: string;
  constructor(private readonly directory: string, private readonly env: Readonly<Record<string, string | undefined>> = process.env, private readonly upstream: typeof fetch = fetch) {
    this.accessFile = path.join(directory, 'access');
  }
  private enabled() { return this.env.YINGXIANG_STUDIO_ENABLED === 'true'; }
  private key() { return this.env.DECART_API_KEY?.trim() ?? ''; }
  private fileFor(attemptId: string) { return path.join(this.directory, `${attemptId}.json`); }
  private async ledger(file: string): Promise<Ledger | null> {
    try { return JSON.parse(await readFile(file, 'utf8')) as Ledger; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new StudioError('LEDGER_UNAVAILABLE', '测试记录无法读取，本轮暂停签发。', 503); }
  }
  private async access(): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    try { await writeFile(this.accessFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const access = await readFile(this.accessFile, 'utf8');
    if (!/^[a-f0-9]{64}$/.test(access)) throw new StudioError('ACCESS_UNAVAILABLE', '本地验证凭据不可用。', 503);
    return access;
  }
  async status(request: Request): Promise<StudioStatus> {
    localOrigin(request);
    const enabled = this.enabled(), keyConfigured = !!this.key();
    return { enabled, keyConfigured, available: enabled && keyConfigured, policy: STUDIO_POLICY,
      state: !enabled ? 'disabled' : !keyConfigured ? 'missing-key' : 'ready',
      ...(enabled && keyConfigured ? { access: await this.access() } : {}),
    };
  }
  private async authenticate(request: Request): Promise<string> {
    const origin = localOrigin(request, true);
    if (!this.enabled() || !this.key()) throw new StudioError('SERVICE_DISABLED', '请先在服务端配置密钥并启用本机验证。', 503);
    const supplied = request.headers.get('x-studio-access') ?? '', expected = await this.access();
    if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new StudioError('UNAUTHORIZED', '本地验证凭据无效，请刷新验证页面。', 401);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new StudioError('INVALID_REQUEST', '请使用JSON请求。', 415);
    return origin;
  }
  async issue(request: Request, owner?: { userId: string; claim: (attemptId: string, durationSec: DurationSec) => Promise<void>; issued: (attemptId: string) => Promise<void> }): Promise<{ apiKey: string; expiresAt: string; durationSec: DurationSec }> {
    const origin = await this.authenticate(request), body = await readBoundedJson(request.body);
    const fields = Object.keys(body).sort().join(',');
    if (!['attemptId,consentVersion', 'attemptId,consentVersion,durationSec'].includes(fields) || typeof body.attemptId !== 'string' || !uuid.test(body.attemptId) || body.consentVersion !== STUDIO_POLICY.consentVersion) throw new StudioError('INVALID_REQUEST', '体验编号或云端处理确认无效，请重新确认。');
    const durationSec = 'durationSec' in body ? body.durationSec : STUDIO_POLICY.clientWindowSec;
    if (!isDurationSec(durationSec)) throw new StudioError('INVALID_DURATION', '请选择15秒、30秒或1分钟。');
    if (durationSec !== 15 && !owner) throw new StudioError('LOGIN_REQUIRED', '长时体验需要登录及对应权益。', 401);
    const ledgerFile = this.fileFor(body.attemptId);
    const createdAt = new Date().toISOString();
    const ledger: Ledger = { batchId: STUDIO_POLICY.batchId, attemptId: body.attemptId, ...(owner ? { userId: owner.userId } : {}), state: 'reserved', createdAt, model: STUDIO_POLICY.model,
      approvedBudgetUsd: STUDIO_POLICY.approvedBudgetUsd, connectionCapSec: durationSec,
      singleConnectionEstimateUsd: durationSec * STUDIO_POLICY.standardUsdPerSec };
    // 按操作UUID独占占位；并行和重放不会再次签发，不保存密钥或令牌。
    let claim;
    try { claim = await open(ledgerFile, 'wx', 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StudioError('ATTEMPT_SPENT', '这次连接已申请，不能重复发送。请结束当前体验后手动再次开启。', 409); throw error; }
    try { await claim.writeFile(JSON.stringify(ledger)); } finally { await claim.close(); }
    if (owner) await owner.claim(body.attemptId, durationSec);
    try {
      const response = await this.upstream('https://api.decart.ai/v1/client/tokens', {
        method: 'POST', headers: { 'X-API-KEY': this.key(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: STUDIO_POLICY.tokenTtlSec, allowedModels: [STUDIO_POLICY.model], allowedOrigins: [origin], constraints: { realtime: { maxSessionDuration: durationSec } } }),
        signal: AbortSignal.timeout(10_000), cache: 'no-store', redirect: 'error',
      });
      if (!response.ok) throw new Error('Provider refused token');
      const token = await readBoundedJson(response.body, 16384);
      const expiresAt = typeof token.expiresAt === 'string' ? Date.parse(token.expiresAt) : NaN;
      const constraints = token.constraints as { realtime?: { maxSessionDuration?: number } } | null;
      const permissions = token.permissions as { models?: string[]; origins?: string[] } | null;
      if (typeof token.apiKey !== 'string' || token.apiKey.length < 10 || token.apiKey === this.key() || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.parse(createdAt) + (STUDIO_POLICY.tokenTtlSec + 5) * 1000 || constraints?.realtime?.maxSessionDuration !== durationSec || permissions?.models?.length !== 1 || permissions.models[0] !== STUDIO_POLICY.model || permissions.origins?.length !== 1 || permissions.origins[0] !== origin) throw new Error('Provider constraints unconfirmed');
      ledger.state = 'issued'; ledger.updatedAt = new Date().toISOString();
      await writeFile(ledgerFile, JSON.stringify(ledger));
      if (owner) await owner.issued(body.attemptId);
      return { apiKey: token.apiKey, expiresAt: token.expiresAt as string, durationSec };
    } catch {
      ledger.state = 'unknown'; ledger.updatedAt = new Date().toISOString();
      await writeFile(ledgerFile, JSON.stringify(ledger));
      throw new StudioError('TOKEN_RESULT_UNKNOWN', '令牌未能安全取得。请检查模型权限、余额和网络并核对用量；本轮不自动重试。', 503);
    }
  }
  async observe(request: Request, userId?: string): Promise<void> {
    await this.authenticate(request); const body = await readBoundedJson(request.body);
    if (Object.keys(body).sort().join(',') !== 'attemptId,firstFrameMs,localTracksEnded,outcome,providerReportedSeconds' || typeof body.attemptId !== 'string' || !uuid.test(body.attemptId) || !['ended', 'error'].includes(body.outcome as string) || typeof body.localTracksEnded !== 'boolean') throw new StudioError('INVALID_REQUEST', '观测记录无效。');
    for (const key of ['firstFrameMs', 'providerReportedSeconds']) if (body[key] !== null && (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < 0 || body[key] > 120_000)) throw new StudioError('INVALID_REQUEST', '观测数值无效。');
    const ledgerFile = this.fileFor(body.attemptId);
    const ledger = await this.ledger(ledgerFile);
    if (!ledger || (userId !== undefined && ledger.userId !== userId) || ledger.attemptId !== body.attemptId || ledger.state === 'reserved') throw new StudioError('ATTEMPT_NOT_FOUND', '没有可归属的测试记录。', 409);
    if (ledger.observation) return;
    try { await writeFile(`${ledgerFile}.observed`, 'claimed', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return; throw error; }
    ledger.observation = { outcome: body.outcome as StudioObservation['outcome'], firstFrameMs: body.firstFrameMs as number | null, providerReportedSeconds: body.providerReportedSeconds as number | null, localTracksEnded: body.localTracksEnded };
    // unknown不能被客户端观测提升为成功；观测值仅供诊断，不作为账单。
    if (ledger.state === 'issued') ledger.state = 'finished';
    ledger.updatedAt = new Date().toISOString(); await writeFile(ledgerFile, JSON.stringify(ledger));
  }
}
export const studioGate = new StudioGate(path.join(process.cwd(), '.cache', 'studio'));
