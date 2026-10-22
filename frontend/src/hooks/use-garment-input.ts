'use client';

import { useEffect, useRef, useState } from 'react';
import { prepareGarmentImage } from '@/lib/images/garment-image';
import type { Garment, SampleId } from '@/lib/try-on/types';

export const SAMPLES: ReadonlyArray<{ id: SampleId; name: string; tone: string }> = [
  { id: 'shirt', name: '云白衬衫', tone: '' }, { id: 'knit', name: '莓果针织', tone: 'berry' }, { id: 'jacket', name: '苔绿外套', tone: 'sage' },
];

export function useGarmentInput(onChange: (garment: Garment | null) => void) {
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const preview = useRef<string | null>(null);
  const release = () => { if (preview.current) URL.revokeObjectURL(preview.current); preview.current = null; };
  useEffect(() => () => { operation.current?.abort(); release(); }, []);

  async function upload(file?: File) {
    if (!file) return;
    operation.current?.abort();
    const current = new AbortController(); operation.current = current;
    setProcessing(true); setError(null);
    try {
      const blob = await prepareGarmentImage(file, current.signal);
      if (current.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      release(); preview.current = url;
      onChange({ id: crypto.randomUUID(), name: file.name, previewUrl: url, blob });
    } catch (cause) {
      if (!current.signal.aborted) setError(cause instanceof Error ? cause.message : '参考图处理失败，请重试。');
    } finally { if (operation.current === current) setProcessing(false); }
  }

  function sample(id: SampleId) {
    operation.current?.abort(); release(); setProcessing(false); setError(null);
    onChange({ id, sampleId: id, name: SAMPLES.find((item) => item.id === id)!.name, previewUrl: `/assets/garments.svg#${id}` });
  }

  function clear() { operation.current?.abort(); release(); setError(null); setProcessing(false); onChange(null); }
  return { upload, sample, clear, error, processing };
}
