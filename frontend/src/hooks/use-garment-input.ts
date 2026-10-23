'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GarmentInput } from '@/lib/images/garment-input';
import type { Garment } from '@/lib/try-on/types';

export function useGarmentInput(onChange: (garment: Garment | null) => void) {
  const callback = useRef(onChange);
  useEffect(() => { callback.current = onChange; }, [onChange]);
  const [input] = useState(() => new GarmentInput((garment) => callback.current(garment)));
  const snapshot = useSyncExternalStore(input.subscribe, input.getSnapshot, input.getSnapshot);
  useEffect(() => () => input.dispose(), [input]);
  return { ...snapshot, uploadMany: input.uploadMany, select: input.select, remove: input.remove, cancel: input.cancel };
}
