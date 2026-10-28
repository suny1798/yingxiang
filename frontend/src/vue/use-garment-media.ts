import { onUnmounted,shallowRef } from 'vue';
import { GarmentInput } from '../lib/images/garment-input';
import type { Garment } from '../lib/try-on/types';
import { sessionScope } from './runtime';

/** 页面拥有参考图URL；已认证身份变化清空，访客登录保留仍有效素材。 */
export function useGarmentMedia(onGarment: (garment: Garment | null) => void) {
  const input = new GarmentInput(onGarment);
  const snapshot = shallowRef(input.getSnapshot());
  const stop = input.subscribe(() => { snapshot.value = input.getSnapshot(); });
  let owner = sessionScope.capture().userId;
  const stopIdentity = sessionScope.onIdentityChange(() => {
    if (owner) input.clear(); else input.cancel();
    owner = sessionScope.capture().userId;
  });
  onUnmounted(() => { stop(); stopIdentity(); input.dispose(); });
  return { input, snapshot };
}
