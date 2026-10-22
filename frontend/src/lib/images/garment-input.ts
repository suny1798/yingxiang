import { prepareGarmentImage } from './garment-image';
import type { Garment, SampleId } from '../try-on/types';

export const SAMPLES: ReadonlyArray<{ id: SampleId; name: string; tone: string }> = [
  { id: 'shirt', name: '云白衬衫', tone: '' }, { id: 'knit', name: '莓果针织', tone: 'berry' }, { id: 'jacket', name: '苔绿外套', tone: 'sage' },
];

const browserImages = {
  prepare: prepareGarmentImage,
  createURL: (blob: Blob) => URL.createObjectURL(blob),
  revokeURL: (url: string) => URL.revokeObjectURL(url),
  id: () => crypto.randomUUID() as string,
};

/** 只有最新的有效上传才能替换选图；失败保留原图，预览URL只有一个所有者。 */
export class GarmentInput {
  private snapshot: { error: string | null; processing: boolean } = { error: null, processing: false };
  private listeners = new Set<() => void>();
  private operation: AbortController | null = null;
  private preview: string | null = null;
  constructor(private readonly onChange: (garment: Garment | null) => void, private readonly images = browserImages) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<typeof this.snapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach((listener) => listener()); }
  private release() { if (this.preview) this.images.revokeURL(this.preview); this.preview = null; }

  upload = async (file?: File): Promise<void> => {
    if (!file) return;
    this.operation?.abort();
    const current = new AbortController(); this.operation = current;
    this.patch({ processing: true, error: null });
    try {
      const blob = await this.images.prepare(file, current.signal);
      if (current.signal.aborted || this.operation !== current) return;
      const url = this.images.createURL(blob);
      const previous = this.preview; this.preview = url;
      this.onChange({ id: this.images.id(), name: file.name, previewUrl: url, blob });
      if (previous) this.images.revokeURL(previous);
    } catch (cause) {
      if (!current.signal.aborted && this.operation === current) this.patch({ error: cause instanceof Error ? cause.message : '参考图处理失败，请重试。' });
    } finally {
      if (this.operation === current) { this.operation = null; this.patch({ processing: false }); }
    }
  };

  cancel = () => { this.operation?.abort(); this.operation = null; this.patch({ processing: false, error: null }); };
  sample = (id: SampleId) => {
    this.cancel();
    this.onChange({ id, sampleId: id, name: SAMPLES.find((item) => item.id === id)!.name, previewUrl: `/assets/garments.svg#${id}` });
    this.release();
  };
  clear = () => { this.cancel(); this.onChange(null); this.release(); };
  dispose = () => { this.cancel(); this.release(); };
}
