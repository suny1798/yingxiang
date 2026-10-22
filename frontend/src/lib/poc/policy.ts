/** 用户2026-10-23批准总计最多$5，并明确追加一次诊断；不是每批新增预算或供应商硬预算。 */
export const POC_POLICY = {
  batchId: '2026-10-23-diagnosis-02',
  model: 'lucy-vton-3.6',
  sdk: '0.2.12',
  consentVersion: '2026-10-23-cloud-poc-v1',
  approvedBudgetUsd: 5,
  tokenTtlSec: 10,
  connectionCapSec: 15,
  clientWindowSec: 30,
  standardUsdPerSec: 0.02,
  prompt: 'Replace only the current upper-body clothing with the garment in the reference image. Preserve the person, face, body, pose, background and lighting.',
} as const;

export interface PocStatus {
  enabled: boolean;
  keyConfigured: boolean;
  available: boolean;
  access?: string;
  policy: typeof POC_POLICY;
  state: 'disabled' | 'missing-key' | 'ready' | 'reserved' | 'issued' | 'unknown' | 'finished';
}

export interface PocObservation {
  outcome: 'ended' | 'error';
  firstFrameMs: number | null;
  providerReportedSeconds: number | null;
  localTracksEnded: boolean;
}
