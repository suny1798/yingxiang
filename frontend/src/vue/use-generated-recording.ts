import { onUnmounted,shallowRef,watch } from 'vue';
import { GeneratedRecording } from '../lib/media/generated-recording';
import { emptySave,WorkUpload,type ReferenceImage,type SaveSnapshot } from '../lib/works-upload';

/** 生成画面默认录制并分片保存；离开或换账号只收尾，不重新生成。 */
export function useGeneratedRecording(options: { enabled: boolean; live: () => boolean; stream: () => MediaStream | null; session: () => number | null; seconds: () => number; owner: () => string | null; reference: () => ReferenceImage | null }) {
  const recorder = new GeneratedRecording();
  const recording = shallowRef(recorder.getSnapshot()), save = shallowRef<SaveSnapshot>(emptySave);
  let started: number | null = null, boundOwner = options.owner(), uploader: WorkUpload | null = null, generation = 0;
  const stopRecorder = recorder.subscribe(() => { recording.value = recorder.getSnapshot(); });
  watch(options.owner, () => {
    generation++; recorder.clear();
    started = boundOwner !== options.owner() ? options.session() : null; boundOwner = options.owner();
    uploader = null; save.value = emptySave;
  });
  watch([options.live, options.stream, options.session, options.owner, options.seconds], () => {
    const live = options.live(), stream = options.stream(), session = options.session(), owner = options.owner();
    if (options.enabled && live && stream && session !== null && started !== session) {
      started = session;
      const revision = generation;
      uploader = owner ? new WorkUpload(owner, 'realtime', options.seconds(), value => { if (revision === generation) save.value = value; }) : null;
      uploader?.addReference(options.reference());
      void recorder.start(stream, options.seconds(), uploader ?? undefined);
    } else if (!live || !stream) recorder.stop();
  }, { immediate: true });
  watch(options.reference, value => { if (options.live()) uploader?.addReference(value); });
  const hidden = () => { if (document.hidden) recorder.stop(); };
  const leaving = () => recorder.finishInBackground();
  document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', leaving);
  onUnmounted(() => {
    document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', leaving);
    generation++; recorder.finishInBackground(); recorder.clear(); stopRecorder();
  });
  return { recording, save, clearRecording: () => recorder.clear() };
}
