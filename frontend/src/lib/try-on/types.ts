import type { DurationSec } from '../studio/policy';

export type Phase = 'idle' | 'imageReady' | 'requestingCamera' | 'creatingSession' | 'connecting' | 'live' | 'updatingGarment' | 'ended' | 'error';
export type View = 'generated' | 'original';

export interface Garment {
  id: string;
  name: string;
  previewUrl: string;
  blob?: Blob;
}

export interface SessionSnapshot {
  phase: Phase;
  garment: Garment | null;
  consent: boolean;
  view: View;
  deadlineAt: number | null;
  remainingSeconds: number;
  durationSec: DurationSec;
  message: string | null;
}

export interface ConnectOptions {
  garment: Garment;
  durationSec?: DurationSec;
  signal: AbortSignal;
  onPhase: (phase: 'requestingCamera' | 'creatingSession' | 'connecting') => void;
  onError?: (error: Error) => void;
}

export interface TryOnAdapter {
  readonly mode: 'real';
  readonly initialView?: View;
  /** 远端生成视频实际播放后才完成；仅取得令牌或收到流不算就绪。 */
  connect(options: ConnectOptions): Promise<void>;
  updateGarment(garment: Garment, signal: AbortSignal): Promise<void>;
  stop(): void;
}

export const ACTIVE_PHASES: ReadonlySet<Phase> = new Set(['requestingCamera', 'creatingSession', 'connecting', 'live', 'updatingGarment']);

export const PHASE_LABELS: Record<Phase, string> = {
  idle: '等待开始', imageReady: '参考图已就绪', requestingCamera: '等待相机授权',
  creatingSession: '正在准备体验', connecting: '正在连接映想', live: '映想画面已就绪',
  updatingGarment: '正在更新参考图', ended: '体验已结束', error: '暂时无法开启',
};

export class ExperienceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ExperienceError'; }
}
