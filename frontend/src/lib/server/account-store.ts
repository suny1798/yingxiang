import { createHash, randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { AccountView } from '../account';
import { DURATION_OPTIONS, isDurationSec, type DurationSec } from '../studio/policy';
import { localOrigin, readBoundedJson, StudioError } from './studio-gate';

const COOKIE = 'yingxiang_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const hashPassword = (password: string, salt: string) => new Promise<string>((resolve, reject) => {
  nodeScrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key.toString('hex')));
});
interface User { id: string; username: string; salt: string; passwordHash: string; createdAt: string }
interface LoginSession { hash: string; userId: string; expiresAt: number }
interface Attempt { id: string; userId: string; createdAt: string; durationSec?: DurationSec; state: 'used' | 'review'; outcome?: 'ended' | 'error' }
interface Data { version: 1; users: User[]; sessions: LoginSession[]; attempts: Attempt[]; limits: Record<string, { count: number; until: number }>; quotas?: Record<string, number>; durationQuotas?: Record<string, Partial<Record<30 | 60, number>>> }

/** 本机文件仓储。锁不自动抢占；崩溃留下锁时停止服务后人工检查，禁止静默覆盖数据。 */
export class AccountStore {
  constructor(private readonly directory: string) {}
  private async transaction<T>(action: (data: Data) => T | Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const lock = path.join(this.directory, 'store.lock');
    let handle;
    for (let retry = 0; retry < 100; retry++) {
      try { handle = await open(lock, 'wx', 0o600); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    if (!handle) throw new StudioError('ACCOUNT_BUSY', '账号服务正忙，请稍后再试。', 503);
    const file = path.join(this.directory, 'store.json');
    const temporary = path.join(this.directory, `${randomUUID()}.tmp`);
    try {
      let data: Data;
      try { data = JSON.parse(await readFile(file, 'utf8')) as Data; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new StudioError('ACCOUNT_STORE_UNAVAILABLE', '账号记录无法读取，请联系开发者检查。', 503);
        data = { version: 1, users: [], sessions: [], attempts: [], limits: {} };
      }
      if (data.version !== 1 || !Array.isArray(data.users) || !Array.isArray(data.sessions) || !Array.isArray(data.attempts) || !data.limits) throw new StudioError('ACCOUNT_STORE_UNAVAILABLE', '账号记录格式不兼容。', 503);
      data.sessions = data.sessions.filter((item) => item.expiresAt > Date.now());
      for (const [key, entry] of Object.entries(data.limits)) if (entry.until <= Date.now()) delete data.limits[key];
      // 失败次数也必须落盘，不能因密码错误抛出而回滚防刷计数。
      let result: T | undefined, failure: unknown;
      try { result = await action(data); } catch (error) { failure = error; }
      const output = await open(temporary, 'wx', 0o600);
      try { await output.writeFile(JSON.stringify(data)); await output.sync(); } finally { await output.close(); }
      await rename(temporary, file);
      if (failure) throw failure;
      return result as T;
    } finally {
      await handle.close();
      await unlink(temporary).catch(() => {});
      await unlink(lock);
    }
  }
  private sessionHash(request: Request): string {
    const value = request.headers.get('cookie')?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? '';
    return /^[a-f0-9]{64}$/.test(value) ? digest(value) : '';
  }
  private user(data: Data, request: Request): User | null {
    const session = data.sessions.find((item) => item.hash === this.sessionHash(request));
    return session ? data.users.find((item) => item.id === session.userId) ?? null : null;
  }
  private require(data: Data, request: Request): User {
    const user = this.user(data, request);
    if (!user) throw new StudioError('LOGIN_REQUIRED', '请先登录后继续。', 401);
    return user;
  }
  private view(data: Data, user: User | null): AccountView {
    if (!user) return { user: null, trial: null, trialLimit: 0, trialRemaining: 0, durations: DURATION_OPTIONS.map((seconds) => ({ seconds, limit: 0, remaining: 0 })), history: [] };
    const attempts = data.attempts.filter((item) => item.userId === user.id);
    const durations = DURATION_OPTIONS.map((seconds) => { const limit = this.quota(data, user.id, seconds); return { seconds, limit, remaining: Math.max(0, limit - attempts.filter((item) => (item.durationSec ?? 15) === seconds).length) }; });
    const { limit, remaining } = durations[0];
    return { user: { id: user.id, username: user.username, createdAt: user.createdAt }, trial: remaining > 0 ? 'ready' : attempts.some((item) => (item.durationSec ?? 15) === 15 && item.state === 'review') ? 'review' : 'used', trialLimit: limit, trialRemaining: remaining, durations,
      history: attempts.slice(-20).reverse().map(({ id, createdAt, state, outcome, durationSec }) => ({ id, createdAt, durationSec: durationSec ?? 15, state, ...(outcome ? { outcome } : {}) })) };
  }
  /** 体验次数配额，默认1；仅在本机数据文件中显式配置的账号可放宽，供测试使用。 */
  private quota(data: Data, userId: string, seconds: DurationSec = 15): number {
    const value = seconds === 15 ? data.quotas?.[userId] : data.durationQuotas?.[userId]?.[seconds];
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, 1000) : seconds === 15 ? 1 : 0;
  }
  private limit(data: Data, key: string, max: number, duration: number) {
    const item = data.limits[key] ??= { count: 0, until: Date.now() + duration };
    if (++item.count > max) throw new StudioError('RATE_LIMITED', '操作过于频繁，请稍后再试。', 429);
  }
  async me(request: Request): Promise<AccountView> {
    localOrigin(request);
    return this.transaction((data) => this.view(data, this.user(data, request)));
  }
  async requireUser(request: Request, mutation = true): Promise<string> {
    localOrigin(request, mutation);
    return this.transaction((data) => this.require(data, request).id);
  }
  async requireTrial(request: Request, durationSec: DurationSec = 15): Promise<string> {
    localOrigin(request, true);
    return this.transaction((data) => {
      const user = this.require(data, request);
      this.checkDuration(data, user.id, durationSec);
      return user.id;
    });
  }
  private checkDuration(data: Data, userId: string, durationSec: DurationSec) {
    if (!isDurationSec(durationSec)) throw new StudioError('INVALID_DURATION', '请选择15秒、30秒或1分钟。');
    if (data.attempts.filter((item) => item.userId === userId && (item.durationSec ?? 15) === durationSec).length >= this.quota(data, userId, durationSec)) throw new StudioError(durationSec === 15 ? 'TRIAL_USED' : 'DURATION_UNAVAILABLE', durationSec === 15 ? '免费体验已使用或正在处理中，付费功能尚未开放。' : '当前账号没有此时长权益，在线购买尚未开放。', 409);
  }
  async authenticate(request: Request, register: boolean): Promise<{ view: AccountView; cookie: string }> {
    localOrigin(request, true);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new StudioError('INVALID_REQUEST', '请使用JSON请求。', 415);
    const body = await readBoundedJson(request.body);
    if (Object.keys(body).sort().join(',') !== 'password,username' || typeof body.username !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(body.username) || typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) throw new StudioError('INVALID_ACCOUNT', '账号需为3—24位字母、数字或下划线，密码需为8—128位。');
    const username = body.username.toLowerCase(), password = body.password;
    return this.transaction(async (data) => {
      this.limit(data, 'auth:global', 60, 15 * 60_000);
      this.limit(data, `auth:${username}`, 10, 15 * 60_000);
      if (register) this.limit(data, 'signup', 20, 60 * 60_000);
      let user = data.users.find((item) => item.username === username);
      if (register && user) throw new StudioError('ACCOUNT_EXISTS', '这个账号已注册，请直接登录或换一个账号。', 409);
      const salt = register ? randomBytes(16).toString('hex') : user?.salt ?? 'yingxiang-nonexistent-account';
      const encoded = await hashPassword(password, salt);
      if (!register && (!user || !timingSafeEqual(Buffer.from(encoded, 'hex'), Buffer.from(user.passwordHash, 'hex')))) throw new StudioError('INVALID_CREDENTIALS', '账号或密码不正确。', 401);
      if (register) {
        user = { id: randomUUID(), username, salt, passwordHash: encoded, createdAt: new Date().toISOString() };
        data.users.push(user);
      }
      const token = randomBytes(32).toString('hex');
      data.sessions.push({ hash: digest(token), userId: user!.id, expiresAt: Date.now() + SESSION_MS });
      // 本机HTTP例外；仅允许固定本机Origin，未来HTTPS部署须使用Secure。
      const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
      return { view: this.view(data, user!), cookie: `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}` };
    });
  }
  async logout(request: Request): Promise<string> {
    localOrigin(request, true);
    await this.transaction((data) => { data.sessions = data.sessions.filter((item) => item.hash !== this.sessionHash(request)); });
    return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  }
  async claim(request: Request, userId: string, attemptId: string, durationSec: DurationSec = 15): Promise<void> {
    await this.transaction((data) => {
      if (this.require(data, request).id !== userId) throw new StudioError('LOGIN_REQUIRED', '登录状态已变化，请重新登录。', 401);
      this.checkDuration(data, userId, durationSec);
      data.attempts.push({ id: attemptId, userId, durationSec, createdAt: new Date().toISOString(), state: 'review' });
    });
  }
  async issued(userId: string, attemptId: string): Promise<void> {
    await this.transaction((data) => { const entry = data.attempts.find((item) => item.userId === userId && item.id === attemptId); if (entry) entry.state = 'used'; });
  }
  async observe(userId: string, attemptId: string, outcome: 'ended' | 'error'): Promise<void> {
    await this.transaction((data) => { const entry = data.attempts.find((item) => item.userId === userId && item.id === attemptId); if (entry && !entry.outcome) entry.outcome = outcome; });
  }
}
export const accounts = new AccountStore(path.join(process.cwd(), '.cache', 'accounts'));
