import { onUnmounted,shallowRef } from 'vue';
import { GarmentInput } from '../lib/images/garment-input';
import type { Garment } from '../lib/try-on/types';
import { sessionScope } from './runtime';

let draft: GarmentInput | null = null;
let draftChange: (garment: Garment | null) => void = () => {};
let stopDraftIdentity: (() => void) | null = null;
export function clearGarmentDraft() {
  draftChange = () => {};
  stopDraftIdentity?.(); stopDraftIdentity = null;
  draft?.dispose(); draft = null;
}

/** 实时换装与衣装灵感往返共享本机参考图，控制器仍由当前页面拥有。 */
export function useGarmentMedia(onGarment: (garment: Garment | null) => void) {
  if (!draft) {
    const saved = new GarmentInput(value => draftChange(value));
    draft = saved;
    let owner = sessionScope.capture().userId;
    stopDraftIdentity = sessionScope.onIdentityChange(() => {
      if (owner) saved.clear(); else saved.cancel();
      owner = sessionScope.capture().userId;
    });
  }
  const input = draft;
  draftChange = onGarment;
  onGarment(input.getSnapshot().garments.find(item => item.id === input.getSnapshot().selectedId) ?? null);
  const snapshot = shallowRef(input.getSnapshot());
  const stop = input.subscribe(() => { snapshot.value = input.getSnapshot(); });
  onUnmounted(() => { stop(); input.cancel(); if(draft===input)draftChange=()=>{}; });
  return { input, snapshot };
}
