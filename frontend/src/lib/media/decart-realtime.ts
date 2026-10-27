import type { ModelDefinition, RealTimeClient, RealTimeClientConnectOptions } from '@decartai/sdk';
import { LocalCamera } from './local-camera';
import { RemotePreview } from './remote-preview';
import type { DurationSec, StudioObservation } from '../studio/policy';
import { ExperienceError } from '../try-on/types';
import { safeConnectionStage, type ConnectionStage } from '../prompt/connection-diagnostics';

export type RealtimeConnector = { model: ModelDefinition; connect: (stream: MediaStream, options: RealTimeClientConnectOptions) => Promise<RealTimeClient> };
export type RealtimeSdkFactory = (provider: () => Promise<string>, onProgress?: (stage: ConnectionStage) => void) => Promise<RealtimeConnector>;
export const browserRequest: typeof fetch = (input, init) => fetch(input, init);
export const sdkFor = (model: 'lucy-vton-3.6' | 'lucy-2.5'): RealtimeSdkFactory => async (apiKeyProvider, onProgress) => {
  const { createDecartClient, models, noopLogger } = await import('@decartai/sdk');
  // 只读取固定消息名，直接丢弃data；不把SDK原始对象或令牌写到console/服务端。
  const progress = (message: string) => { const stage = safeConnectionStage(message); if (stage) onProgress?.(stage); };
  const client = createDecartClient({ apiKeyProvider, telemetry: false, logger: onProgress ? { debug: progress, info: progress, warn: progress, error: progress } : noopLogger });
  return { model: models.realtime(model), connect: (stream, options) => client.realtime.connect(stream, options) };
};
export function safeSdkDiagnostic(error: unknown): string {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const name = 'name' in error ? String(error.name) : '', code = 'code' in error ? String(error.code) : '';
  const codes = new Set(['INVALID_API_KEY', 'TOKEN_EXPIRED', 'TOKEN_INVALID', 'TOKEN_VERIFY_ERROR', 'MODEL_NOT_FOUND', 'INVALID_INPUT', 'UNSUPPORTED_PLATFORM_FEATURE', 'INVALID_OPTIONS', 'LIVEKIT_INITIALIZATION_ERROR', 'WEBRTC_WEBSOCKET_ERROR', 'WEBRTC_ICE_ERROR', 'WEBRTC_TIMEOUT_ERROR', 'WEBRTC_SERVER_ERROR', 'WEBRTC_SIGNALING_ERROR']);
  if (codes.has(code)) return code;
  const message = 'message' in error && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  if (message.includes('websocket')) return 'WEBRTC_WEBSOCKET_ERROR';
  if (message.includes('ice connection failed')) return 'WEBRTC_ICE_ERROR';
  if (message.includes('timeout') || message.includes('timed out')) return 'WEBRTC_TIMEOUT_ERROR';
  if ('source' in error && error.source === 'server') return 'WEBRTC_SERVER_ERROR';
  return ['ChunkLoadError', 'ReferenceError', 'TypeError', 'SyntaxError', 'ZodError'].includes(name) ? name : 'UNKNOWN';
}
export interface RealtimeState { prompt: string; image?: Blob }
export interface RealtimeConnect {
  state: RealtimeState; durationSec: DurationSec; signal: AbortSignal;
  onPhase: (phase: 'requestingCamera' | 'creatingSession' | 'connecting') => void;
  onError?: (error: Error) => void;
  onProgress?: (stage: ConnectionStage) => void;
}
interface Endpoints { status: string; token: string; observation?: string; consentVersion: string }

/** 两个实时场景共享SDK与克隆流生命周期；模型和门禁由场景固定。 */
export class DecartRealtime {
  private work: { signal: AbortSignal; attemptId: string; access: string; issued: boolean; result: StudioObservation['outcome']; seconds: number | null; input: MediaStream | null; unwatch: (() => void) | null } | null = null;
  private client: RealTimeClient | null = null;
  lastObservation: StudioObservation | null = null;
  constructor(readonly camera: LocalCamera, readonly remote: RemotePreview, private readonly request: typeof fetch, private readonly factory: RealtimeSdkFactory, private readonly mediaOptions: { keepLocalPreview?: boolean }, private readonly endpoints: Endpoints) {}
  async connectState(options: RealtimeConnect): Promise<void> {
    options.signal.throwIfAborted();
    const work = { signal: options.signal, attemptId: crypto.randomUUID(), access: '', issued: false, result: 'ended' as StudioObservation['outcome'], seconds: null as number | null, input: null as MediaStream | null, unwatch: null as (() => void) | null };
    this.work = work; this.lastObservation = null;
    const progress = (stage: ConnectionStage) => { if (this.work === work && !work.signal.aborted) options.onProgress?.(stage); };
    let stage: 'camera' | 'status' | 'sdk' | 'connection' = 'camera';
    let safeFailure: ExperienceError | null = null, connectionReady = false;
    const fail = (error: Error) => { if (this.work !== work || work.signal.aborted) return; work.result = 'error'; options.onError?.(error); };
    const onAbort = () => { if (options.signal.reason instanceof ExperienceError) work.result = 'error'; this.stop(); }; options.signal.addEventListener('abort', onAbort, { once: true });
    try {
      if (this.mediaOptions.keepLocalPreview) {
        const preview = this.camera.getSnapshot();
        if (!preview || !this.camera.isReady()) throw new ExperienceError('PREVIEW_REQUIRED', '请先打开相机并等待预览就绪。');
        work.input = preview.clone();
        work.unwatch = this.camera.subscribe(() => { if (this.camera.getSnapshot() !== preview) fail(new ExperienceError('CAMERA_ENDED', '相机已关闭，生成随之结束。')); });
      } else { options.onPhase('requestingCamera'); await this.camera.start(options.signal, fail); }
      stage = 'status'; options.signal.throwIfAborted(); options.onPhase('creatingSession');
      progress('checkingService');
      const statusResponse = await this.request(this.endpoints.status, { cache: 'no-store', signal: options.signal });
      const status = await statusResponse.json() as { available: boolean; access?: string };
      if (!statusResponse.ok || !status.available || !status.access) throw new ExperienceError('SERVICE_NOT_READY', '当前云端体验尚未就绪，请检查服务状态后再开启。');
      work.access = status.access;
      let credentialRequested = false; stage = 'sdk';
      progress('preparingSdk');
      const sdk = await this.factory(async () => {
        if (credentialRequested || options.signal.aborted || this.work !== work) throw new Error('unauthorized: 本轮禁止再次连接');
        credentialRequested = true; work.issued = true;
        progress('requestingToken');
        const response = await this.request(this.endpoints.token, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Access': work.access }, body: JSON.stringify({ attemptId: work.attemptId, consentVersion: this.endpoints.consentVersion, durationSec: options.durationSec }), signal: options.signal });
        const value = await response.json();
        if (!response.ok || typeof value.apiKey !== 'string' || value.durationSec !== options.durationSec) {
          safeFailure = new ExperienceError('TOKEN_UNAVAILABLE', value.error?.message ?? '本轮令牌未能取得，请核对用量后再处理。'); throw safeFailure;
        }
        options.signal.throwIfAborted(); progress('tokenReady'); return value.apiKey as string;
      }, options.onProgress ? progress : undefined);
      options.signal.throwIfAborted(); options.onPhase('connecting'); stage = 'connection';
      const playing = this.remote.prepare(options.signal, fail); void playing.catch(() => {});
      const local = work.input ?? this.camera.getSnapshot(); if (!local) throw new ExperienceError('CAMERA_ENDED', '相机已关闭。');
      const client = await sdk.connect(local, {
        model: sdk.model, resolution: '720p', retries: 0, capacityRetryBudgetMs: 0, mirror: false,
        initialState: { prompt: { text: options.state.prompt, enhance: false }, ...(options.state.image ? { image: options.state.image } : {}) },
        onRemoteStream: (stream) => { if (this.work !== work || options.signal.aborted) stream.getTracks().forEach((track) => track.stop()); else { progress('remoteStream'); this.remote.offer(stream); } },
        onQueuePosition: () => progress('queued'),
        onConnectionChange: (state) => {
          if (state === 'connected' || state === 'generating') progress(state);
          if (state === 'reconnecting') fail(new ExperienceError('CONNECTION_ENDED', '模型连接已中断，本轮停止，不自动重新建连。'));
          else if (state === 'disconnected' && connectionReady) queueMicrotask(() => fail(new ExperienceError('CONNECTION_ENDED', '模型连接已中断，本轮停止，不自动重新建连。')));
        },
      });
      if (this.work !== work || options.signal.aborted) { client.disconnect(); return; }
      this.client = client; connectionReady = true;
      client.on('error', (error) => fail(new ExperienceError('MODEL_ERROR', `模型返回错误（${safeSdkDiagnostic(error)}），本轮已停止。请核对供应商用量。`)));
      client.on('sessionEnded', () => fail(new ExperienceError('SESSION_ENDED', '供应商已结束连接，请核对用量及账户提示。')));
      client.on('generationTick', ({ seconds }) => { if (this.work === work && Number.isFinite(seconds) && seconds >= 0) work.seconds = seconds; });
      await playing; options.signal.throwIfAborted(); progress('playing');
    } catch (error) {
      if (this.work === work && !options.signal.aborted) work.result = 'error';
      if (safeFailure) throw safeFailure;
      if (error instanceof ExperienceError || options.signal.aborted) throw error;
      const message = stage === 'sdk' ? '当前浏览器未能初始化模型SDK，尚未进入签发步骤。' : stage === 'status' ? '未能读取服务状态，尚未进入签发步骤。' : stage === 'camera' ? '相机准备发生异常，尚未进入签发步骤。' : '真实模型连接未完成，请核对网络、模型权限及供应商用量。';
      throw new ExperienceError('MODEL_CONNECT_FAILED', `${message}（${safeSdkDiagnostic(error)}）本轮已停止。`);
    } finally { options.signal.removeEventListener('abort', onAbort); }
  }
  async updateState(state: RealtimeState, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!this.client) throw new ExperienceError('CONNECTION_ENDED', '连接已结束。');
    try { await this.client.set({ prompt: state.prompt, ...(state.image ? { image: state.image } : {}), enhance: false }); }
    catch (error) { throw new ExperienceError('MODEL_UPDATE_FAILED', `指令更新未完成（${safeSdkDiagnostic(error)}），本次连接已停止。`); }
  }
  stop(): void {
    const work = this.work; this.work = null;
    const localTracks = this.camera.getSnapshot()?.getTracks() ?? [];
    try { this.client?.disconnect(); } catch { /* 断开异常也要继续释放轨道。 */ }
    this.client = null; const firstFrameMs = this.remote.firstFrameMs;
    work?.unwatch?.(); work?.input?.getTracks().forEach((track) => track.stop()); this.remote.stop();
    if (!this.mediaOptions.keepLocalPreview) this.camera.stop();
    if (!work) return;
    const observation: StudioObservation = { outcome: work.result, firstFrameMs, providerReportedSeconds: work.seconds, localTracksEnded: localTracks.every((track) => track.readyState === 'ended') };
    this.lastObservation = observation;
    if (this.endpoints.observation && work.issued && work.access) void this.request(this.endpoints.observation, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Studio-Access': work.access }, body: JSON.stringify({ attemptId: work.attemptId, ...observation }) }).catch(() => {});
  }
}
