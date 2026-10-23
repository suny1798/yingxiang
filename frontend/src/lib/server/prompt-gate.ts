import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PROMPT_POLICY, type PromptStatus } from '../prompt/policy';
import { localOrigin, readBoundedJson, StudioError } from './studio-gate';

interface Attempt { id: string; userId: string; state: 'unknown' | 'issued'; createdAt: string; leaseUntil: number; estimateUsd: number }
interface Ledger { version: 1; attempts: Attempt[] }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const estimate = PROMPT_POLICY.durationSec * PROMPT_POLICY.usdPerSecond;

/** 本机提示词场景独立预算；不保存提示词/媒体/令牌，不依靠客户端报告退还预算。 */
export class PromptGate {
  constructor(private readonly directory: string, private readonly env: Readonly<Record<string, string | undefined>> = process.env, private readonly upstream: typeof fetch = fetch) {}
  private config() {
    const budget = Number(this.env.YINGXIANG_PROMPT_BUDGET_USD), max = Number(this.env.YINGXIANG_PROMPT_MAX_SESSIONS), key = this.env.DECART_API_KEY?.trim() ?? '';
    return { budget, max, key, enabled: this.env.YINGXIANG_PROMPT_ENABLED === 'true' && budget >= estimate && budget <= 5 && Number.isInteger(max) && max > 0 && max <= 20 };
  }
  private async transaction<T>(action: (ledger: Ledger) => T): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const lock = path.join(this.directory, 'limits.lock'); let handle;
    for (let retry = 0; retry < 100; retry++) {
      try { handle = await open(lock, 'wx', 0o600); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; await new Promise((resolve) => setTimeout(resolve, 25)); }
    }
    if (!handle) throw new StudioError('PROMPT_BUSY', '实时编辑服务正忙，请稍后刷新。', 503);
    const file = path.join(this.directory, 'limits.json'), temporary = path.join(this.directory, `${randomUUID()}.tmp`);
    try {
      let ledger: Ledger;
      try { ledger = JSON.parse(await readFile(file, 'utf8')) as Ledger; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new StudioError('PROMPT_STORE_UNAVAILABLE', '编辑记录无法读取，请联系开发者检查。', 503);
        ledger = { version: 1, attempts: [] };
      }
      if (ledger.version !== 1 || !Array.isArray(ledger.attempts) || ledger.attempts.some((item) => !uuid.test(item.id) || !uuid.test(item.userId) || !['unknown', 'issued'].includes(item.state) || item.estimateUsd !== estimate || !Number.isFinite(item.leaseUntil))) throw new StudioError('PROMPT_STORE_UNAVAILABLE', '编辑记录格式不兼容。', 503);
      const result = action(ledger);
      const output = await open(temporary, 'wx', 0o600);
      try { await output.writeFile(JSON.stringify(ledger)); await output.sync(); } finally { await output.close(); }
      await rename(temporary, file); return result;
    } finally { await handle.close(); await unlink(temporary).catch(() => {}); await unlink(lock); }
  }
  private ready(ledger: Ledger): PromptStatus {
    const config = this.config();
    if (!config.enabled || !config.key) return { available: false, message: '实时编辑待开放，可先准备提示词与相机预览。' };
    if (ledger.attempts.some((item) => item.state === 'unknown')) return { available: false, message: '上次连接申请待核查，请联系开发者，勿重复尝试。' };
    if (ledger.attempts.some((item) => item.leaseUntil > Date.now())) return { available: false, message: '连接窗口尚未结束，请稍后刷新状态。' };
    if (ledger.attempts.length >= config.max || ledger.attempts.reduce((sum, item) => sum + item.estimateUsd, 0) + estimate > config.budget + 0.000001) return { available: false, message: '本轮实时编辑额度已用完。' };
    return { available: true, message: '实时编辑已就绪，每次最多15秒。' };
  }
  private async access() {
    await mkdir(this.directory, { recursive: true }); const file = path.join(this.directory, 'access');
    try { await writeFile(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const value = await readFile(file, 'utf8');
    if (!/^[a-f0-9]{64}$/.test(value)) throw new StudioError('PROMPT_ACCESS_UNAVAILABLE', '编辑访问凭据不可用。', 503);
    return value;
  }
  async status(request: Request, userId: string | null): Promise<PromptStatus & { access?: string }> {
    localOrigin(request); const value = await this.transaction((ledger) => this.ready(ledger));
    return { ...value, ...(value.available && userId ? { access: await this.access() } : {}) };
  }
  async issue(request: Request, userId: string): Promise<{ apiKey: string; expiresAt: string; durationSec: 15 }> {
    const origin = localOrigin(request, true), config = this.config();
    if (!config.enabled || !config.key) throw new StudioError('PROMPT_DISABLED', '实时编辑尚未开放。', 503);
    const supplied = request.headers.get('x-studio-access') ?? '', expected = await this.access();
    if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new StudioError('PROMPT_UNAUTHORIZED', '编辑访问凭据无效，请刷新页面。', 401);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new StudioError('INVALID_REQUEST', '请使用JSON请求。', 415);
    const body = await readBoundedJson(request.body);
    if (Object.keys(body).sort().join(',') !== 'attemptId,consentVersion,durationSec' || typeof body.attemptId !== 'string' || !uuid.test(body.attemptId) || body.consentVersion !== PROMPT_POLICY.consentVersion || body.durationSec !== PROMPT_POLICY.durationSec) throw new StudioError('INVALID_PROMPT_SESSION', '连接参数或云端确认无效。');
    const id = body.attemptId, now = Date.now();
    await this.transaction((ledger) => {
      if (ledger.attempts.some((item) => item.id === id)) throw new StudioError('PROMPT_ATTEMPT_SPENT', '这个连接已申请，请核查状态，不要重复提交。', 409);
      const status = this.ready(ledger); if (!status.available) throw new StudioError('PROMPT_LIMIT', status.message, 409);
      ledger.attempts.push({ id, userId, state: 'unknown', createdAt: new Date(now).toISOString(), leaseUntil: now + (PROMPT_POLICY.tokenTtlSec + PROMPT_POLICY.durationSec + 5) * 1000, estimateUsd: estimate });
    });
    try {
      const response = await this.upstream('https://api.decart.ai/v1/client/tokens', {
        method: 'POST', headers: { 'X-API-KEY': config.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: PROMPT_POLICY.tokenTtlSec, allowedModels: [PROMPT_POLICY.model], allowedOrigins: [origin], constraints: { realtime: { maxSessionDuration: PROMPT_POLICY.durationSec } } }),
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error();
      const token = await readBoundedJson(response.body, 16384), expiresAt = typeof token.expiresAt === 'string' ? Date.parse(token.expiresAt) : NaN;
      const permissions = token.permissions as { models?: string[]; origins?: string[] } | null, constraints = token.constraints as { realtime?: { maxSessionDuration?: number } } | null;
      if (typeof token.apiKey !== 'string' || token.apiKey.length < 10 || token.apiKey === config.key || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > now + (PROMPT_POLICY.tokenTtlSec + 5) * 1000 || permissions?.models?.length !== 1 || permissions.models[0] !== PROMPT_POLICY.model || permissions.origins?.length !== 1 || permissions.origins[0] !== origin || constraints?.realtime?.maxSessionDuration !== PROMPT_POLICY.durationSec) throw new Error();
      await this.transaction((ledger) => { const entry = ledger.attempts.find((item) => item.id === id && item.userId === userId); if (!entry) throw new Error(); entry.state = 'issued'; });
      return { apiKey: token.apiKey, expiresAt: token.expiresAt as string, durationSec: PROMPT_POLICY.durationSec };
    } catch { throw new StudioError('PROMPT_TOKEN_UNKNOWN', '连接凭据未能安全取得，请核对供应商用量并联系开发者；不会自动重试。', 503); }
  }
}
export const promptGate = new PromptGate(path.join(process.cwd(), '.cache', 'prompt'));
