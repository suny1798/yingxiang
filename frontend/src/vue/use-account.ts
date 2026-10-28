import { shallowRef, onMounted, onUnmounted, watch } from 'vue';
import { accountCoordinator } from './runtime';
import { notify } from '../lib/notices';

/** 仅公共容器传入poll=true；页面只订阅，不重复创建读取计时器。 */
export function useAccountView(poll=false) {
  const snapshot=shallowRef(accountCoordinator.getSnapshot());
  const stop=accountCoordinator.subscribe(()=>{snapshot.value=accountCoordinator.getSnapshot();});
  const update=()=>{if (!document.hidden) void accountCoordinator.revalidate();};
  let timer:ReturnType<typeof setInterval>|undefined;
  onMounted(()=>{if(poll){update();timer=setInterval(update,10_000);window.addEventListener('focus',update);}});
  onUnmounted(()=>{stop(); clearInterval(timer); window.removeEventListener('focus',update);});
  if(poll)watch(()=>snapshot.value.error,error=>{if(error) notify(error,'error');});
  return {snapshot,refresh:accountCoordinator.refresh};
}
