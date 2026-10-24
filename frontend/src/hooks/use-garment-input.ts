'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GarmentInput } from '@/lib/images/garment-input';
import { useNotice } from './use-notice';
import { notify } from '@/lib/notices';
import type { Garment } from '@/lib/try-on/types';

export function useGarmentInput(onChange: (garment: Garment | null) => void) {
  const callback = useRef(onChange);
  useEffect(() => { callback.current = onChange; }, [onChange]);
  const [input] = useState(() => new GarmentInput((garment) => callback.current(garment)));
  const snapshot = useSyncExternalStore(input.subscribe, input.getSnapshot, input.getSnapshot);
  useNotice(snapshot.error);
  const previousCount = useRef(0);
  useEffect(() => { if (snapshot.garments.length > previousCount.current) notify(`已添加${snapshot.garments.length - previousCount.current}张服装图。`, 'success'); previousCount.current = snapshot.garments.length; }, [snapshot.garments.length]);
  useEffect(() => () => input.dispose(), [input]);
  return { ...snapshot, uploadMany: async (files: File[]) => { await input.uploadMany(files); const message = input.getSnapshot().error; if (message) notify(message, 'error'); }, select: input.select, remove: input.remove, cancel: input.cancel };
}
