/** 共享图标几何；仅Vue使用，形状与旧React实现逐项一致，不新增图标。 */
export type StudioIconName = 'download' | 'arrow' | 'upload' | 'camera' | 'lock' | 'hanger' | 'check' | 'close' | 'info' | 'sun' | 'switch' | 'mirror' | 'history' | 'fullscreen' | 'fullscreenExit' | 'snapshot' | 'search' | 'sort' | 'star';

export type StudioIconShape =
  | { kind: 'path'; d: string }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number };

export const studioIconShapes: Record<StudioIconName, StudioIconShape[]> = {
  download: [{ kind: 'path', d: 'M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4' }],
  fullscreen: [{ kind: 'path', d: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5' }],
  fullscreenExit: [{ kind: 'path', d: 'M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5' }],
  snapshot: [{ kind: 'path', d: 'M4 7h4l1.5-2h5L16 7h4v12H4z' }, { kind: 'circle', cx: 12, cy: 13, r: 3.5 }, { kind: 'path', d: 'M18 10h.01' }],
  search: [{ kind: 'circle', cx: 10.5, cy: 10.5, r: 6.5 }, { kind: 'path', d: 'm15.5 15.5 5 5' }],
  sort: [{ kind: 'path', d: 'M8 5v14m-4-4 4 4 4-4M16 19V5m-4 4 4-4 4 4' }],
  star: [{ kind: 'path', d: 'm12 3 2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 17.03l-5.5 2.89 1.05-6.12L3.1 9.47l6.15-.9z' }],
  history: [{ kind: 'path', d: 'M3 5v5h5M3.5 10a9 9 0 1 1 1.7 8M12 7v5l3 2' }],
  mirror: [{ kind: 'path', d: 'M12 3v3m0 3v3m0 3v3m0 3v-1M3 7l5 3v7l-5 3zm18 0-5 3v7l5 3z' }],
  arrow: [{ kind: 'path', d: 'M5 12h14m-6-6 6 6-6 6' }],
  upload: [{ kind: 'path', d: 'M12 16V4m-4 4 4-4 4 4M5 15v5h14v-5' }],
  camera: [{ kind: 'path', d: 'M4 7h4l2-3h4l2 3h4v13H4z' }, { kind: 'circle', cx: 12, cy: 13, r: 3.5 }],
  lock: [{ kind: 'rect', x: 5, y: 10, width: 14, height: 11, rx: 3 }, { kind: 'path', d: 'M8 10V7a4 4 0 0 1 8 0v3m-4 5v2' }],
  hanger: [{ kind: 'path', d: 'M9.5 6a2.5 2.5 0 1 1 4.3 1.7L12 9v2l9 6v2H3v-2l9-6' }],
  check: [{ kind: 'path', d: 'm5 12 4 4L19 6' }],
  close: [{ kind: 'path', d: 'm6 6 12 12M18 6 6 18' }],
  info: [{ kind: 'circle', cx: 12, cy: 12, r: 9 }, { kind: 'path', d: 'M12 11v6m0-10v1' }],
  sun: [{ kind: 'circle', cx: 12, cy: 12, r: 4 }, { kind: 'path', d: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5' }],
  switch: [{ kind: 'path', d: 'M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4' }],
};
