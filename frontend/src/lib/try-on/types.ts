export type Phase = 'idle' | 'imageReady' | 'requestingCamera' | 'creatingSession' | 'connecting' | 'live' | 'updatingGarment' | 'reconnecting' | 'ended' | 'error';
export type Scenario = 'normal' | 'camera-denied' | 'capacity' | 'quota' | 'connection-error';
export type SampleId = 'shirt' | 'knit' | 'jacket';
export type View = 'generated' | 'original';

export interface Garment {
  id: string;
  name: string;
  previewUrl: string;
  sampleId?: SampleId;
  blob?: Blob;
}

export interface SessionSnapshot {
  phase: Phase;
  garment: Garment | null;
  consent: boolean;
  scenario: Scenario;
  view: View;
  deadlineAt: number | null;
  remainingSeconds: number;
  message: string | null;
}

export interface ConnectOptions {
  garment: Garment;
  scenario: Scenario;
  signal: AbortSignal;
  onPhase: (phase: 'requestingCamera' | 'creatingSession' | 'connecting') => void;
  onError?: (error: Error) => void;
}

export interface TryOnAdapter {
  readonly mode: 'mock' | 'real';
  readonly hasLocalCamera?: boolean;
  readonly initialView?: View;
  connect(options: ConnectOptions): Promise<void>;
  updateGarment(garment: Garment, signal: AbortSignal): Promise<void>;
  reconnect(signal: AbortSignal): Promise<void>;
  stop(): void;
}

export const ACTIVE_PHASES: ReadonlySet<Phase> = new Set(['requestingCamera', 'creatingSession', 'connecting', 'live', 'updatingGarment', 'reconnecting']);

export const PHASE_LABELS: Record<Phase, string> = {
  idle: '等待开始', imageReady: '参考图已就绪', requestingCamera: '等待相机授权',
  creatingSession: '正在检查体验资格', connecting: '正在连接映想', live: '画面体验中 · 模拟',
  updatingGarment: '正在更新参考图', reconnecting: '正在恢复画面', ended: '体验已结束', error: '暂时无法开启',
};

export class ExperienceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ExperienceError'; }
}
