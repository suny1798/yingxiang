import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountSession } from '../src/lib/account-session';
import type { AccountView } from '../src/lib/account';

const account = { user: { id: 'test-user', username: '测试', createdAt: '2026-10-24T00:00:00Z' }, durations: [], history: [], trial: 'ready', trialLimit: 1, trialRemaining: 1 } as AccountView;
const deferred = () => { let resolve!: (value: Response) => void; const promise = new Promise<Response>((r) => { resolve = r; }); return { promise, resolve }; };

test('页面重新订阅和后台读取保留已确认账号，在途读取合并，SSR快照不泄露账号', async () => {
  const next = deferred(); let calls = 0;
  const store = new AccountSession(() => ++calls === 1 ? Promise.resolve(Response.json(account)) : next.promise);
  await store.refresh(); const before = store.getSnapshot();
  const unsubscribe = store.subscribe(() => {}); unsubscribe(); store.subscribe(() => {});
  const first = store.revalidate(), second = store.revalidate();
  assert.equal(first, second); assert.equal(store.getSnapshot(), before);
  assert.equal(store.getServerSnapshot().account, null);
  next.resolve(Response.json(account)); await first; assert.equal(calls, 2);
});

test('登录/退出显式刷新抢占较早读取，迟到的旧账号不能覆盖新的匿名状态', async () => {
  const old = deferred(), fresh = deferred(); let calls = 0;
  const store = new AccountSession(() => ++calls === 1 ? old.promise : fresh.promise);
  const earlier = store.revalidate(); await Promise.resolve();
  const latest = store.refresh();
  fresh.resolve(Response.json({ ...account, user: null })); await latest;
  old.resolve(Response.json(account)); assert.equal(await earlier, null);
  assert.equal(store.getSnapshot().account?.user, null); assert.equal(calls, 2);
});

test('刷新失败保留账号显示并报告错误，后续成功恢复；不把缓存当作刷新成功', async () => {
  let calls = 0;
  const store = new AccountSession(() => ++calls === 2 ? Promise.reject(new Error('网络暂不可用')) : Promise.resolve(Response.json(account)));
  await store.refresh(); assert.equal(await store.refresh(), null);
  assert.equal(store.getSnapshot().account?.user?.id, account.user!.id);
  assert.equal(store.getSnapshot().error, '网络暂不可用');
  assert.ok(await store.refresh()); assert.equal(store.getSnapshot().error, null);
});
