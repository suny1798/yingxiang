import { shallowRef, onMounted, onUnmounted, watch } from 'vue';
import { envelopeData, envelopeMessage } from '../lib/api-response';
import { accountCoordinator,sessionScope } from './runtime';
import { SandboxCheckout } from '../lib/sandbox-checkout';
import { notify } from '../lib/notices';

export function useSandboxCheckout() {
  const controller=new SandboxCheckout({
    async request(url,body) {
      let response: Response;
      try { response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15_000),...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})}); }
      catch { throw new Error(body?'支付准备未完成，请到订单中核查。':'支付服务暂不可用。'); }
      let value;
      try { value=await response.json(); } catch { throw new Error('支付服务暂不可用。'); }
      if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('支付服务暂不可用。');
      if (!response.ok) throw new Error(envelopeMessage(value) ?? '支付服务暂不可用。');
      return envelopeData(value);
    },
    userId:()=>accountCoordinator.getSnapshot().account?.user?.id,
    identityEpoch:()=>sessionScope.state.epoch,
    refresh:accountCoordinator.refresh,
    openLogin:()=>{sessionScope.state.loginOpen=true;},
    navigate:url=>window.location.assign(url), requestId:()=>crypto.randomUUID(),
  });
  const state=shallowRef(controller.getSnapshot());
  const stop=controller.subscribe(()=>{state.value=controller.getSnapshot();});
  onMounted(()=>{void controller.load();});
  onUnmounted(()=>{stop();controller.dispose();});
  watch(()=>state.value.error,error=>{if(error)notify(error,'error');});
  return {state,buy:(sku:string)=>controller.buy(sku),clearError:controller.clearError};
}
