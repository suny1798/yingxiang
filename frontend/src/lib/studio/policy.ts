export const DURATION_OPTIONS = [15, 30, 60] as const;
export type DurationSec = typeof DURATION_OPTIONS[number];
export const isDurationSec = (value: unknown): value is DurationSec => typeof value === 'number' && DURATION_OPTIONS.some((seconds) => seconds === value);
export const durationLabel = (seconds: DurationSec) => seconds === 60 ? '1分钟' : `${seconds}秒`;

/** 默认免费15秒；长时连接必须有服务端发放的对应档位权益。 */
export const STUDIO_POLICY = {
  batchId: 'studio-manual-v1',
  model: 'lucy-vton-3.6',
  sdk: '0.2.12',
  consentVersion: '2026-10-23-preview-cloud-v2',
  approvedBudgetUsd: 5,
  tokenTtlSec: 10,
  connectionCapSec: 15,
  clientWindowSec: 15,
  durationOptions: DURATION_OPTIONS,
  standardUsdPerSec: 0.02,
  prompt: 'Replace only the current upper-body clothing with the garment in the reference image. Preserve the person, face, body, pose, background and lighting.',
} as const;

export interface StudioStatus {
  enabled: boolean;
  keyConfigured: boolean;
  available: boolean;
  access?: string;
  policy: typeof STUDIO_POLICY;
  state: 'disabled' | 'missing-key' | 'ready';
}

export interface StudioObservation {
  outcome: 'ended' | 'error';
  firstFrameMs: number | null;
  providerReportedSeconds: number | null;
  localTracksEnded: boolean;
}
