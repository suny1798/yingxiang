'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GeneratedRecording } from '@/lib/media/generated-recording';
import { WorkUpload, emptySave, type ReferenceImage, type SaveSnapshot } from '@/lib/works-upload';
import type { WorkPromptState } from '@/lib/api-schema';

export function useGeneratedRecording({ enabled, live, stream, session, seconds, owner, kind = 'realtime', reference = null, promptHistory = [] }: {
  enabled: boolean; live: boolean; stream: MediaStream | null; session: number | null;
  seconds: number; owner: string | null;
  kind?: 'realtime' | 'edit'; reference?: ReferenceImage | null;
  promptHistory?: readonly WorkPromptState[];
}) {
  const [recorder] = useState(() => new GeneratedRecording());
  const snapshot = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot, recorder.getServerSnapshot);
  const started = useRef<number | null>(null);
  const boundOwner = useRef(owner);
  const uploader = useRef<WorkUpload | null>(null);
  const latestReference = useRef(reference); latestReference.current = reference;
  const latestHistory = useRef(promptHistory); latestHistory.current = promptHistory;
  const generation = useRef(0);
  const [save, setSave] = useState<SaveSnapshot>(emptySave);
  useEffect(() => {
    generation.current++; recorder.clear();
    // 账号变化时，旧连接残留的deadline/远端流不能被新账号重新录制。
    started.current = boundOwner.current !== owner ? session : null; boundOwner.current = owner;
    uploader.current = null; setSave(emptySave);
    return () => { generation.current++; recorder.finishInBackground(); };
  }, [recorder, owner]);
  useEffect(() => {
    if (enabled && live && stream && session !== null && started.current !== session) {
      started.current = session;
      const revision = generation.current;
      uploader.current = owner ? new WorkUpload(owner, kind, seconds, value => { if (revision === generation.current) setSave(value); }) : null;
      uploader.current?.addReference(latestReference.current);
      uploader.current?.addPromptHistory(latestHistory.current);
      void recorder.start(stream, seconds, uploader.current ?? undefined);
    } else if (!live || !stream) { uploader.current?.addPromptHistory(latestHistory.current); recorder.stop(); }
  }, [recorder, enabled, live, stream, session, seconds, owner, kind]);
  useEffect(() => { if (live) uploader.current?.addReference(reference); }, [live, reference]);
  useEffect(() => { uploader.current?.addPromptHistory(promptHistory); }, [promptHistory]);
  useEffect(() => () => { recorder.finishInBackground(); recorder.clear(); }, [recorder]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) recorder.stop(); };
    const leaving = () => recorder.finishInBackground();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leaving);
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', leaving); };
  }, [recorder]);
  return { recording: snapshot, save, clearRecording: () => recorder.clear() };
}
