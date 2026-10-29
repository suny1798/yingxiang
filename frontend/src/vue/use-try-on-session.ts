import { computed,onMounted,onUnmounted,shallowRef,watch } from 'vue';
import { envelopeData } from '../lib/api-response';
import { CameraPreviewSession } from '../lib/media/camera-preview-session';
import { LocalCamera } from '../lib/media/local-camera';
import { RemotePreview } from '../lib/media/remote-preview';
import { DecartTryOnAdapter,prepareRealtimeSdk,safeSdkDiagnostic } from '../lib/try-on/decart-adapter';
import { SessionController } from '../lib/try-on/session-controller';
import { ACTIVE_PHASES } from '../lib/try-on/types';
import { STUDIO_POLICY,type StudioStatus } from '../lib/studio/policy';
import { sessionScope } from './runtime';

/** Vue桥接既有独立控制器；相机、远端流、SDK与连接仍由原控制器拥有。 */
export function useTryOnSession() {
  const camera = new LocalCamera(), preview = new CameraPreviewSession(camera), remote = new RemotePreview();
  const controller = new SessionController(new DecartTryOnAdapter(camera, remote, undefined, undefined, { keepLocalPreview: true }), { durationMs: STUDIO_POLICY.clientWindowSec * 1000 });
  const stream = shallowRef(camera.getSnapshot()), previewState = shallowRef(preview.getSnapshot()), remoteStream = shallowRef(remote.getSnapshot()), snapshot = shallowRef(controller.getSnapshot());
  const status = shallowRef<StudioStatus | null>(null), readinessError = shallowRef<string | null>(null), sdkReady = shallowRef(false), sdkError = shallowRef<string | null>(null);
  const stops = [camera.subscribe(() => { stream.value = camera.getSnapshot(); }), preview.subscribe(() => { previewState.value = preview.getSnapshot(); }), remote.subscribe(() => { remoteStream.value = remote.getSnapshot(); }), controller.subscribe(() => { snapshot.value = controller.getSnapshot(); })];
  let abort: AbortController | undefined, alive = true, previousUser = sessionScope.capture().userId, stopIdentity: () => void = () => {};
  async function loadStatus() {
    abort?.abort(); const current = new AbortController(); abort = current;
    try {
      const response = await fetch('/api/studio/status', { cache: 'no-store', signal: current.signal });
      if (!response.ok) throw new Error();
      const value = envelopeData<StudioStatus>(await response.json());
      if (!current.signal.aborted) { status.value = value; readinessError.value = null; }
    } catch { if (!current.signal.aborted) readinessError.value = '暂时无法读取换装服务，请刷新页面。'; }
  }
  const stopAll = () => { controller.stop('页面已离开前台，换装已结束。'); preview.stop(); };
  const hidden = () => { if (document.hidden) stopAll(); };
  watch(stream, value => { if (!value && ACTIVE_PHASES.has(snapshot.value.phase)) controller.stop('相机已关闭，换装随之结束。'); });
  watch(() => snapshot.value.phase, phase => { if (!ACTIVE_PHASES.has(phase)) void loadStatus(); });
  onMounted(() => {
    void loadStatus();
    void prepareRealtimeSdk(async () => { throw new Error('unauthorized: readiness check cannot dial'); }).then(() => { if (alive) sdkReady.value = true; }).catch((error: unknown) => { if (alive) sdkError.value = `换装组件未就绪（${safeSdkDiagnostic(error)}），请刷新页面。`; });
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', stopAll);
    stopIdentity = sessionScope.onIdentityChange(() => {
      if (previousUser) { controller.stop('登录状态已变化。'); preview.stop(); }
      previousUser = sessionScope.capture().userId;
    });
  });
  onUnmounted(() => {
    alive = false; abort?.abort(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', stopAll);
    stopIdentity(); stopAll(); stops.forEach(stop => stop());
  });
  const unavailable = computed(() => sdkError.value ?? readinessError.value ?? (!status.value ? '换装服务准备中…' : !status.value.enabled ? '换装服务暂未启用。' : !status.value.keyConfigured ? '换装服务尚未配置完成。' : !sdkReady.value ? '换装组件准备中…' : !status.value.available ? '换装暂不可用。' : null));
  return { controller, snapshot, camera, stream, preview, previewState, remote, remoteStream, unavailable };
}
