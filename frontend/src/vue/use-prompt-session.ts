import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue';
import { envelopeData } from '../lib/api-response';
import { CameraPreviewSession } from '../lib/media/camera-preview-session';
import { LocalCamera } from '../lib/media/local-camera';
import { RemotePreview } from '../lib/media/remote-preview';
import { safeSdkDiagnostic } from '../lib/media/decart-realtime';
import { DecartPromptAdapter, preparePromptSdk } from '../lib/prompt/adapter';
import { promptActive, PromptSession } from '../lib/prompt/session';
import type { PromptStatus } from '../lib/prompt/policy';
import { notify } from '../lib/notices';
import { sessionScope } from './runtime';
import { t } from './preferences';
import { PromptEditor, type PromptEditorPlatform } from './prompt-editor';

/** Vue只桥接既有PromptSession与相机／SDK；模型协议、令牌和组合历史仍由原控制器拥有。 */
export function usePromptSession() {
  const camera = new LocalCamera(), preview = new CameraPreviewSession(camera), remote = new RemotePreview();
  const controller = new PromptSession(new DecartPromptAdapter(camera, remote));
  const platform: PromptEditorPlatform = {
    cameraReady: () => camera.isReady() && preview.getSnapshot().phase === 'ready',
    closeCamera: () => preview.stop(),
    openLogin: () => { sessionScope.state.loginOpen = true; },
    hidden: () => document.hidden,
    notify: (message, kind) => notify(message, kind),
    translate: t,
  };
  const editor = new PromptEditor(controller, platform, sessionScope);
  const snapshot = shallowRef(controller.getSnapshot()), editorState = shallowRef(editor.getSnapshot());
  const stream = shallowRef(camera.getSnapshot()), previewState = shallowRef(preview.getSnapshot()), remoteStream = shallowRef(remote.getSnapshot());
  const status = shallowRef<PromptStatus | null>(null), statusError = shallowRef<string | null>(null);
  const sdkReady = shallowRef(false), sdkError = shallowRef<string | null>(null);
  const active = computed(() => promptActive(snapshot.value.phase)), owner = computed(() => editorState.value.owner);
  const stops = [
    camera.subscribe(() => { stream.value = camera.getSnapshot(); }),
    preview.subscribe(() => { previewState.value = preview.getSnapshot(); }),
    remote.subscribe(() => { remoteStream.value = remote.getSnapshot(); }),
    controller.subscribe(() => { snapshot.value = controller.getSnapshot(); }),
    editor.subscribe(() => { editorState.value = editor.getSnapshot(); }),
  ];
  let statusAbort: AbortController | undefined, statusTimer: ReturnType<typeof setInterval> | undefined, alive = true;

  async function loadStatus(signal?: AbortSignal) {
    try {
      const response = await fetch('/api/prompt/status', { cache: 'no-store', signal });
      if (!response.ok) throw new Error();
      const value = envelopeData<PromptStatus>(await response.json());
      if (!signal?.aborted) { status.value = { available: value.available, message: value.message }; statusError.value = null; }
    } catch { if (!signal?.aborted) statusError.value = '暂时无法读取编辑服务，请刷新状态。'; }
  }
  function stopStatus() { statusAbort?.abort(); statusAbort = undefined; clearInterval(statusTimer); statusTimer = undefined; }
  function watchStatus() {
    stopStatus();
    if (active.value) return;
    const current = new AbortController(); statusAbort = current;
    const update = () => { if (!document.hidden) void loadStatus(current.signal); };
    update(); statusTimer = setInterval(update, 10_000);
  }
  watch([active, owner], watchStatus, { immediate: true });

  const stopAll = () => editor.closeCamera('页面已离开前台，实时编辑已结束。');
  const hidden = () => { if (document.hidden) editor.hidden(); };
  watch(stream, value => { if (!value && active.value) controller.stop('相机已关闭，实时编辑随之结束。'); });
  watch(() => previewState.value.message, message => { if (message) notify(message, 'error'); });

  onMounted(() => {
    void preparePromptSdk(async () => { throw new Error('unauthorized: readiness check cannot dial'); })
      .then(() => { if (alive) sdkReady.value = true; })
      .catch((error: unknown) => { if (alive) sdkError.value = `编辑组件未就绪（${safeSdkDiagnostic(error)}），请刷新页面。`; });
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', stopAll);
  });
  onUnmounted(() => {
    alive = false; stopStatus();
    document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', stopAll);
    editor.dispose(); stops.forEach(stop => stop());
  });

  const unavailable = computed(() => sdkError.value ?? statusError.value ?? (!status.value ? '编辑服务准备中…' : !sdkReady.value ? '编辑组件准备中…' : !status.value.available ? status.value.message : null));
  return { editor, editorState, controller, snapshot, camera, stream, preview, previewState, remote, remoteStream, status, unavailable };
}
