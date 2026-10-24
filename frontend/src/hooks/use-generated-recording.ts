'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GeneratedRecording } from '@/lib/media/generated-recording';

export function useGeneratedRecording({ enabled, live, stream, session, seconds, owner }: {
  enabled: boolean; live: boolean; stream: MediaStream | null; session: number | null;
  seconds: number; owner: string | null;
}) {
  const [recorder] = useState(() => new GeneratedRecording());
  const snapshot = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot, recorder.getServerSnapshot);
  const started = useRef<number | null>(null);
  useEffect(() => { recorder.clear(); started.current = null; }, [recorder, owner]);
  useEffect(() => {
    if (enabled && live && stream && session !== null && started.current !== session) {
      started.current = session; void recorder.start(stream, seconds);
    } else if (!live || !stream) recorder.stop();
  }, [recorder, enabled, live, stream, session, seconds]);
  useEffect(() => () => recorder.clear(), [recorder]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) recorder.stop(); };
    const leaving = () => recorder.clear();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leaving);
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', leaving); };
  }, [recorder]);
  return { recording: snapshot, clearRecording: () => recorder.clear() };
}
