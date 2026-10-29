import { onMounted,onUnmounted,shallowRef,watch } from 'vue';
import { envelopeData,envelopeMessage } from '../lib/api-response';
import type { GarmentFavoritesList,GarmentFavorite } from '../lib/api-schema';
import { sessionScope } from './runtime';
import { GarmentFavorites } from './garment-favorites';

async function read<T>(response:Response):Promise<T>{
  const value=await response.json();
  if(!response.ok)throw Object.assign(new Error(envelopeMessage(value)??'收藏操作失败。'),{status:response.status});
  return envelopeData<T>(value);
}
export function useGarmentFavorites(){
  const favorites=new GarmentFavorites(sessionScope,{
    read:async(signal,owner)=>read<GarmentFavoritesList>(await fetch('/api/garments/favorites',{signal,cache:'no-store',headers:{'X-Garment-Owner':owner}})),
    write:async(signal,owner,id,favorite)=>read<GarmentFavorite>(await fetch(`/api/garments/${id}/favorite`,{method:'POST',signal,headers:{'Content-Type':'application/json','X-Garment-Owner':owner},body:JSON.stringify({favorite})})),
    login:()=>{sessionScope.state.loginOpen=true;},
  });
  const state=shallowRef(favorites.getSnapshot());
  const stop=favorites.subscribe(()=>{state.value=favorites.getSnapshot();});
  const refresh=()=>{if(!document.hidden&&!state.value.busyId)void favorites.refresh();};
  watch(()=>[sessionScope.state.userId,sessionScope.state.transitioning],refresh,{flush:'post'});
  onMounted(()=>{refresh();window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);});
  onUnmounted(()=>{stop();favorites.dispose();window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);});
  return {favorites,state};
}
