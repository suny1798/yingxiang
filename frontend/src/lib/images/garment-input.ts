import { prepareGarmentImage } from './garment-image';
import { MAX_GARMENTS } from '../limits';
import type { Garment } from '../try-on/types';

const browserImages = {
  prepare: prepareGarmentImage,
  createURL: (blob: Blob) => URL.createObjectURL(blob),
  revokeURL: (url: string) => URL.revokeObjectURL(url),
  id: () => crypto.randomUUID() as string,
};

/** 批次顺序解码；当前页面拥有全部预览URL，只有明确点选才更新模型参考图。 */
export class GarmentInput {
  private snapshot: { error: string | null; processing: boolean; garments: Garment[]; selectedId: string | null } = { error: null, processing: false, garments: [], selectedId: null };
  private listeners = new Set<() => void>();
  private operation: AbortController | null = null;
  constructor(private readonly onChange: (garment: Garment | null) => void, private readonly images = browserImages) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<typeof this.snapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach((listener) => listener()); }
  upload = async (file?: File): Promise<void> => { if (file) await this.uploadMany([file]); };
  uploadMany = async (files: readonly File[]): Promise<void> => {
    if (!files.length) return;
    this.operation?.abort();
    const current = new AbortController(); this.operation = current;
    this.patch({ processing: true, error: null });
    const prepared: Array<{ blob: Blob; name: string }> = [];
    const errors: string[] = [];
    try {
      const room = MAX_GARMENTS - this.snapshot.garments.length;
      if (files.length > room) errors.push(`最多保留${MAX_GARMENTS}张，请移除后再添加。`);
      for (const file of files.slice(0, room)) {
        try {
          const blob = await this.images.prepare(file, current.signal);
          if (current.signal.aborted || this.operation !== current) return;
          prepared.push({ blob, name: file.name });
        } catch (cause) {
          if (current.signal.aborted || this.operation !== current) return;
          errors.push(`${file.name}：${cause instanceof Error ? cause.message : '参考图处理失败，请重试。'}`);
        }
      }
      if (current.signal.aborted || this.operation !== current) return;
      const added = prepared.map(({ blob, name }) => ({ id: this.images.id(), name, previewUrl: this.images.createURL(blob), blob }));
      const selected = this.snapshot.selectedId ? null : added[0];
      this.patch({ garments: [...this.snapshot.garments, ...added], selectedId: this.snapshot.selectedId ?? selected?.id ?? null, error: errors.join(' ') || null });
      if (selected) this.onChange(selected);
    } finally {
      if (this.operation === current) { this.operation = null; this.patch({ processing: false }); }
    }
  };

  select = (id: string) => {
    const garment = this.snapshot.garments.find((item) => item.id === id);
    if (!garment || this.snapshot.selectedId === id) return;
    this.patch({ selectedId: id }); this.onChange(garment);
  };
  remove = (id: string) => {
    const index = this.snapshot.garments.findIndex((item) => item.id === id);
    if (index < 0) return;
    const removed = this.snapshot.garments[index];
    const garments = this.snapshot.garments.filter((item) => item.id !== id);
    const wasSelected = this.snapshot.selectedId === id;
    const next = garments[Math.min(index, garments.length - 1)] ?? null;
    this.patch({ garments, selectedId: wasSelected ? next?.id ?? null : this.snapshot.selectedId });
    if (wasSelected) this.onChange(next);
    this.images.revokeURL(removed.previewUrl);
  };
  cancel = () => { this.operation?.abort(); this.operation = null; this.patch({ processing: false, error: null }); };
  clear = () => {
    this.cancel(); const garments = this.snapshot.garments;
    this.patch({ garments: [], selectedId: null }); this.onChange(null);
    garments.forEach((item) => this.images.revokeURL(item.previewUrl));
  };
  dispose = () => {
    this.cancel(); const garments = this.snapshot.garments;
    this.patch({ garments: [], selectedId: null });
    garments.forEach((item) => this.images.revokeURL(item.previewUrl));
  };
}
