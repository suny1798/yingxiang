export const VIDEO_POLICY = {
  model: 'lucy-vton-3.6',
  consentVersion: '2026-10-26-video-save-v1',
  maxBytes: 25 * 1024 * 1024,
  maxSeconds: 30,
  resultWindowMs: 24 * 60 * 60 * 1000,
  usdPerSecond: 0.04,
  prompt: 'Dress the person in the garment from the reference image. Preserve the person, face, body, pose, background and lighting.',
} as const;
export type VideoJobState = 'submitting' | 'unknown' | 'pending' | 'processing' | 'completed' | 'failed';
export interface VideoJobView {
  id: string; title?: string; state: VideoJobState; createdAt: string; expiresAt: string;
  seconds: number; estimateUsd: number; expired: boolean;
  resultSeconds?: number|null;
  resultPending?: boolean;
  billing?: {state:string;reservedCredits:number;chargedCredits:number|null;returnedCredits:number|null}|null;
}
export interface VideoServiceView { available: boolean; message: string; jobs: VideoJobView[] }
export const VIDEO_STATE_LABEL: Record<VideoJobState, string> = {
  submitting: '正在提交', unknown: '提交结果待核查', pending: '排队中', processing: '正在换装', completed: '已完成', failed: '处理失败',
};
