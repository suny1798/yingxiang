import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { POC_POLICY, type PocObservation, type PocStatus } from '../poc/policy';

export class PocError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}
const origins = new Set(['http://127.0.0.1:8787', 'http://localhost:8787']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function localOrigin(request: Request, mutation = false): string {
  const url = new URL(request.url), origin = `${url.protocol}//${request.headers.get('host')}`;
  if (!origins.has(origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new PocError('LOCAL_ONLY', '此验证入口仅允许本机页面访问。', 403);
  const sentOrigin = request.headers.get('origin');
  if ((mutation || sentOrigin !== null) && sentOrigin !== origin) throw new PocError('ORIGIN_REJECTED', '页面来源不符，请从本机验证入口重新打开。', 403);
  return origin;
}

export async function readBoundedJson(body: ReadableStream<Uint8Array> | null, limit = 4096): Promise<Record<string, unknown>> {
  if (!body) throw new PocError('INVALID_REQUEST', '缺少请求内容。');
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new PocError('BODY_TOO_LARGE', '请求内容过大。', 413); } chunks.push(value); }
    const joined = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) { if (error instanceof PocError) throw error; throw new PocError('INVALID_REQUEST', '请求内容无法读取。'); }
  finally { reader.releaseLock(); }
}

interface Ledger {
  batchId: string; attemptId: string; state: 'reserved' | 'issued' | 'unknown' | 'finished';
  createdAt: string; updatedAt?: string; model: string; approvedBudgetUsd: number;
  connectionCapSec: number; singleConnectionEstimateUsd: number;
  observation?: PocObservation;
}
export class PocGate {
  private ledgerFile: string;
  private accessFile: string;
  constructor(private readonly directory: string, private readonly env: Readonly<Record<string, string | undefined>> = process.env, private readonly upstream: typeof fetch = fetch) {
    this.ledgerFile = path.join(directory, `${POC_POLICY.batchId}.json`);
    this.accessFile = path.join(directory, 'access');
  }
  private enabled() { return this.env.YINGXIANG_POC_ENABLED === 'true'; }
  private key() { return this.env.DECART_API_KEY?.trim() ?? ''; }
  private async ledger(): Promise<Ledger | null> {
    try { return JSON.parse(await readFile(this.ledgerFile, 'utf8')) as Ledger; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new PocError('LEDGER_UNAVAILABLE', '测试记录无法读取，本轮暂停签发。', 503); }
  }
  private async access(): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    try { await writeFile(this.accessFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const access = await readFile(this.accessFile, 'utf8');
    if (!/^[a-f0-9]{64}$/.test(access)) throw new PocError('ACCESS_UNAVAILABLE', '本地验证凭据不可用。', 503);
    return access;
  }
  async status(request: Request): Promise<PocStatus> {
    localOrigin(request);
    const enabled = this.enabled(), keyConfigured = !!this.key(), ledger = await this.ledger();
    return { enabled, keyConfigured, available: enabled && keyConfigured && !ledger, policy: POC_POLICY,
      state: !enabled ? 'disabled' : !keyConfigured ? 'missing-key' : ledger?.state ?? 'ready',
      ...(enabled && keyConfigured ? { access: await this.access() } : {}),
    };
  }
  private async authenticate(request: Request): Promise<string> {
    const origin = localOrigin(request, true);
    if (!this.enabled() || !this.key()) throw new PocError('SERVICE_DISABLED', '请先在服务端配置密钥并启用本机验证。', 503);
    const supplied = request.headers.get('x-poc-access') ?? '', expected = await this.access();
    if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new PocError('UNAUTHORIZED', '本地验证凭据无效，请刷新验证页面。', 401);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new PocError('INVALID_REQUEST', '请使用JSON请求。', 415);
    return origin;
  }
  async issue(request: Request): Promise<{ apiKey: string; expiresAt: string }> {
    const origin = await this.authenticate(request), body = await readBoundedJson(request.body);
    if (Object.keys(body).sort().join(',') !== 'attemptId,consentVersion' || typeof body.attemptId !== 'string' || !uuid.test(body.attemptId) || body.consentVersion !== POC_POLICY.consentVersion) throw new PocError('INVALID_REQUEST', '测试编号或云端处理确认无效，请重新确认。');
    const createdAt = new Date().toISOString();
    const ledger: Ledger = { batchId: POC_POLICY.batchId, attemptId: body.attemptId, state: 'reserved', createdAt, model: POC_POLICY.model,
      approvedBudgetUsd: POC_POLICY.approvedBudgetUsd, connectionCapSec: POC_POLICY.connectionCapSec,
      singleConnectionEstimateUsd: POC_POLICY.connectionCapSec * POC_POLICY.standardUsdPerSec };
    // 原子占用唯一批次；重启、刷新、并行请求与重复操作都不能再签发。记录不保存密钥/令牌。
    let claim;
    try { claim = await open(this.ledgerFile, 'wx', 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new PocError('ATTEMPT_SPENT', '本轮短时测试已使用或结果待核实，禁止自动重复；请先核对用量。', 409); throw error; }
    try { await claim.writeFile(JSON.stringify(ledger)); } finally { await claim.close(); }
    try {
      const response = await this.upstream('https://api.decart.ai/v1/client/tokens', {
        method: 'POST', headers: { 'X-API-KEY': this.key(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: POC_POLICY.tokenTtlSec, allowedModels: [POC_POLICY.model], allowedOrigins: [origin], constraints: { realtime: { maxSessionDuration: POC_POLICY.connectionCapSec } } }),
        signal: AbortSignal.timeout(10_000), cache: 'no-store', redirect: 'error',
      });
      if (!response.ok) throw new Error('Provider refused token');
      const token = await readBoundedJson(response.body, 16384);
      const expiresAt = typeof token.expiresAt === 'string' ? Date.parse(token.expiresAt) : NaN;
      const constraints = token.constraints as { realtime?: { maxSessionDuration?: number } } | null;
      const permissions = token.permissions as { models?: string[]; origins?: string[] } | null;
      if (typeof token.apiKey !== 'string' || token.apiKey.length < 10 || token.apiKey === this.key() || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.parse(createdAt) + (POC_POLICY.tokenTtlSec + 5) * 1000 || constraints?.realtime?.maxSessionDuration !== POC_POLICY.connectionCapSec || permissions?.models?.length !== 1 || permissions.models[0] !== POC_POLICY.model || permissions.origins?.length !== 1 || permissions.origins[0] !== origin) throw new Error('Provider constraints unconfirmed');
      ledger.state = 'issued'; ledger.updatedAt = new Date().toISOString();
      await writeFile(this.ledgerFile, JSON.stringify(ledger));
      return { apiKey: token.apiKey, expiresAt: token.expiresAt as string };
    } catch {
      ledger.state = 'unknown'; ledger.updatedAt = new Date().toISOString();
      await writeFile(this.ledgerFile, JSON.stringify(ledger));
      throw new PocError('TOKEN_RESULT_UNKNOWN', '令牌未能安全取得。请检查模型权限、余额和网络并核对用量；本轮不自动重试。', 503);
    }
  }
  async observe(request: Request): Promise<void> {
    await this.authenticate(request); const body = await readBoundedJson(request.body);
    if (Object.keys(body).sort().join(',') !== 'attemptId,firstFrameMs,localTracksEnded,outcome,providerReportedSeconds' || typeof body.attemptId !== 'string' || !uuid.test(body.attemptId) || !['ended', 'error'].includes(body.outcome as string) || typeof body.localTracksEnded !== 'boolean') throw new PocError('INVALID_REQUEST', '观测记录无效。');
    for (const key of ['firstFrameMs', 'providerReportedSeconds']) if (body[key] !== null && (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < 0 || body[key] > 120_000)) throw new PocError('INVALID_REQUEST', '观测数值无效。');
    const ledger = await this.ledger();
    if (!ledger || ledger.attemptId !== body.attemptId || ledger.state === 'reserved') throw new PocError('ATTEMPT_NOT_FOUND', '没有可归属的测试记录。', 409);
    if (ledger.observation) return;
    try { await writeFile(`${this.ledgerFile}.observed`, 'claimed', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return; throw error; }
    ledger.observation = { outcome: body.outcome as PocObservation['outcome'], firstFrameMs: body.firstFrameMs as number | null, providerReportedSeconds: body.providerReportedSeconds as number | null, localTracksEnded: body.localTracksEnded };
    // unknown不能被客户端观测提升为成功；观测值仅供诊断，不作为账单。
    if (ledger.state === 'issued') ledger.state = 'finished';
    ledger.updatedAt = new Date().toISOString(); await writeFile(this.ledgerFile, JSON.stringify(ledger));
  }
}
export const pocGate = new PocGate(path.join(process.cwd(), '.cache', 'poc'));
