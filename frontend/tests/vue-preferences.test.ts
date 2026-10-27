import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreferenceState, type PreferenceBrowser } from '../src/vue/preference-state';

function browser(cookie = '', blocked = false, secure = false) {
  const writes: string[] = [], storage: [string,string][] = [];
  let handler: Parameters<PreferenceBrowser['listen']>[0] | undefined;
  let stopped = false;
  const adapter: PreferenceBrowser = { cookie, secure,
    writeCookie(value) { if (blocked) throw new Error('blocked'); writes.push(value); },
    setItem(key, value) { if (blocked) throw new Error('blocked'); storage.push([key,value]); },
    listen(value) { handler=value; return () => { handler=undefined; stopped=true; }; },
  };
  return { adapter, writes, storage, dispatch(key:string|null,newValue:string|null) { handler?.({key,newValue}); }, get stopped() { return stopped; } };
}

test('Vue首屏延续旧Cookie偏好及未知值默认，不能从任意业务Cookie推断偏好', () => {
  for (const [source,locale,theme] of [['','zh','light'],['yingxiang-locale=en; yingxiang-theme=dark','en','dark'],
    ['yingxiang-locale=fr; yingxiang-theme=invalid','zh','light'],['auth_session=en; password=dark','zh','light']]) {
    const b=browser(source); const state=createPreferenceState(b.adapter);
    assert.equal(state.locale.value,locale); assert.equal(state.theme.value,theme); assert.equal(b.writes.length,0); state.stop();
  }
});

test('只持久化语言主题，HTTPS保留Secure，存储不可用时当前切换仍有效', () => {
  for (const blocked of [false,true]) {
    const b=browser('',blocked,true); const state=createPreferenceState(b.adapter);
    state.setLocale('en'); state.setTheme('dark');
    assert.equal(state.locale.value,'en'); assert.equal(state.theme.value,'dark');
    if (!blocked) {
      assert.deepEqual(b.storage,[['yingxiang-locale','en'],['yingxiang-theme','dark']]);
      assert.deepEqual(b.writes,['yingxiang-locale=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure','yingxiang-theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure']);
    }
    state.stop();
  }
});

test('跨标签同步不写回循环，忽略私有键，卸载移除监听', () => {
  const b=browser(); const state=createPreferenceState(b.adapter);
  b.dispatch('yingxiang-locale','en'); b.dispatch('yingxiang-theme','dark');
  b.dispatch('yingxiang_session','private'); b.dispatch(null,null);
  assert.equal(state.locale.value,'en'); assert.equal(state.theme.value,'dark'); assert.equal(b.writes.length,0);
  b.dispatch('yingxiang-locale',null); assert.equal(state.locale.value,'zh');
  state.stop(); assert.equal(b.stopped,true); b.dispatch('yingxiang-theme','light'); assert.equal(state.theme.value,'dark');
});
