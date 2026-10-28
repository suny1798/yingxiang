import { shallowRef,computed,onMounted,onUnmounted,watch } from 'vue';
import { LocalStudioMedia } from './local-studio-media';
import { sessionScope } from './runtime';
import { notices,notify } from '../lib/notices';

export function useLocalStudio(){
  const media=new LocalStudioMedia(sessionScope),stream=shallowRef(media.camera.getSnapshot()),preview=shallowRef(media.preview.getSnapshot()),input=shallowRef(media.input.getSnapshot());
  const stops=[media.camera.subscribe(()=>{stream.value=media.camera.getSnapshot();}),media.preview.subscribe(()=>{preview.value=media.preview.getSnapshot();}),media.input.subscribe(()=>{input.value=media.input.getSnapshot();})];
  const selected=computed(()=>input.value.garments.find(item=>item.id===input.value.selectedId)??null);
  const hidden=()=>{if(document.hidden)media.hidden();};
  let count=0;
  watch(()=>input.value.garments.length,next=>{if(next>count)notify(`已添加${next-count}张服装图。`,'success');count=next;});
  let cameraNotice:string|undefined;
  watch(()=>preview.value.message,message=>{if(cameraNotice)notices.dismiss(cameraNotice);cameraNotice=message?notify(message,'error'):undefined;});
  onMounted(()=>document.addEventListener('visibilitychange',hidden));
  onUnmounted(()=>{document.removeEventListener('visibilitychange',hidden);if(cameraNotice)notices.dismiss(cameraNotice);media.dispose();stops.forEach(stop=>stop());});
  const toggleCamera=()=>{if(preview.value.phase==='requesting'||stream.value)media.stopCamera();else void media.startCamera(document.hidden);};
  return {media,stream,preview,input,selected,toggleCamera};
}
