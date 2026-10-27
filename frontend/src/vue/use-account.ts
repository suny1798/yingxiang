import { shallowRef, onMounted, onUnmounted, watch } from 'vue';
import { accountSession } from '../lib/account-session';
import { notify } from '../lib/notices';

/** 当前由价格页消费；M04接全站账号协调后改由共享页面容器提供。 */
export function useAccountView() {
  const snapshot=shallowRef(accountSession.getSnapshot());
  const stop=accountSession.subscribe(()=>{snapshot.value=accountSession.getSnapshot();});
  const update=()=>{if (!document.hidden) void accountSession.revalidate();};
  let timer:ReturnType<typeof setInterval>|undefined;
  onMounted(()=>{update(); timer=setInterval(update,10_000); window.addEventListener('focus',update);});
  onUnmounted(()=>{stop(); clearInterval(timer); window.removeEventListener('focus',update);});
  watch(()=>snapshot.value.error,error=>{if(error) notify(error,'error');});
  return {snapshot,refresh:accountSession.refresh};
}
