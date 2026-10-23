import type { ModelDefinition, RealTimeClient, RealTimeClientConnectOptions } from '@decartai/sdk';
import { LocalCamera } from '../media/local-camera';
import { RemotePreview } from '../media/remote-preview';
import { STUDIO_POLICY, isDurationSec, type StudioObservation, type StudioStatus } from '../studio/policy';
import { ExperienceError, type ConnectOptions, type Garment, type TryOnAdapter } from './types';

export type RealtimeConnector = { model: ModelDefinition; connect: (stream: MediaStream, options: RealTimeClientConnectOptions) => Promise<RealTimeClient> };
export type RealtimeSdkFactory = (provider: () => Promise<string>) => Promise<RealtimeConnector>;
// 原生window.fetch不能作为适配器实例的方法调用，否则部分浏览器会抛Illegal invocation。
const browserRequest: typeof fetch = (input, init) => fetch(input, init);
export const prepareRealtimeSdk: RealtimeSdkFactory = async (apiKeyProvider) => {
  const { createDecartClient, models, noopLogger } = await import('@decartai/sdk');
  const client = createDecartClient({ apiKeyProvider, telemetry: false, logger: noopLogger });
  return { model: models.realtime(STUDIO_POLICY.model), connect: (stream, options) => client.realtime.connect(stream, options) };
};

export function safeSdkDiagnostic(error: unknown): string {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const name = 'name' in error ? String(error.name) : '';
  const code = 'code' in error ? String(error.code) : '';
  const codes = new Set(['INVALID_API_KEY', 'TOKEN_EXPIRED', 'TOKEN_INVALID', 'TOKEN_VERIFY_ERROR', 'MODEL_NOT_FOUND', 'INVALID_INPUT', 'UNSUPPORTED_PLATFORM_FEATURE', 'INVALID_OPTIONS', 'LIVEKIT_INITIALIZATION_ERROR', 'WEBRTC_WEBSOCKET_ERROR', 'WEBRTC_ICE_ERROR', 'WEBRTC_TIMEOUT_ERROR', 'WEBRTC_SERVER_ERROR', 'WEBRTC_SIGNALING_ERROR']);
  if (codes.has(code)) return code;
  // SDK建连拒绝也可能是普通Error；只归类固定特征，绝不输出原始消息或cause。
  const message = 'message' in error && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  if (message.includes('websocket')) return 'WEBRTC_WEBSOCKET_ERROR';
  if (message.includes('ice connection failed')) return 'WEBRTC_ICE_ERROR';
  if (message.includes('timeout') || message.includes('timed out')) return 'WEBRTC_TIMEOUT_ERROR';
  if ('source' in error && error.source === 'server') return 'WEBRTC_SERVER_ERROR';
  if (['ChunkLoadError', 'ReferenceError', 'TypeError', 'SyntaxError', 'ZodError'].includes(name)) return name;
  return 'UNKNOWN';
}

export class DecartTryOnAdapter implements TryOnAdapter {
  readonly mode = 'real' as const;
  readonly initialView = 'generated' as const;
  private work: { signal: AbortSignal; attemptId: string; access: string; issued: boolean; result: StudioObservation['outcome']; seconds: number | null; input: MediaStream | null; unwatch: (() => void) | null } | null = null;
  private client: RealTimeClient | null = null;
  lastObservation: StudioObservation | null = null;
  constructor(readonly camera: LocalCamera, readonly remote: RemotePreview, private readonly request: typeof fetch = browserRequest, private readonly factory = prepareRealtimeSdk, private readonly mediaOptions: { keepLocalPreview?: boolean } = {}) {}

  async connect(options: ConnectOptions): Promise<void> {
    const durationSec = options.durationSec ?? STUDIO_POLICY.clientWindowSec;
    if (!isDurationSec(durationSec)) throw new ExperienceError('INVALID_DURATION', '请选择15秒、30秒或1分钟。');
    if (!options.garment.blob) throw new ExperienceError('REAL_IMAGE_REQUIRED', '请上传有使用权的真实上衣图片，示意素材不用于模型测试。');
    const work = { signal: options.signal, attemptId: crypto.randomUUID(), access: '', issued: false, result: 'ended' as StudioObservation['outcome'], seconds: null as number | null, input: null as MediaStream | null, unwatch: null as (() => void) | null };
    this.work = work; this.lastObservation = null;
    let stage: 'camera' | 'status' | 'sdk' | 'connection' = 'camera';
    let safeFailure: ExperienceError | null = null;
    let connectionReady = false;
    const fail = (error: Error) => { if (this.work !== work || work.signal.aborted) return; work.result = 'error'; options.onError?.(error); };
    const onAbort = () => this.stop(); options.signal.addEventListener('abort', onAbort, { once: true });
    try {
      if (this.mediaOptions.keepLocalPreview) {
        const preview = this.camera.getSnapshot();
        if (!preview || !this.camera.isReady()) throw new ExperienceError('PREVIEW_REQUIRED', '请先打开相机并等待预览就绪。');
        // SDK只持有克隆轨道，生成结束不能关闭用户仍在看的本地原画。
        work.input = preview.clone();
        work.unwatch = this.camera.subscribe(() => {
          if (this.camera.getSnapshot() !== preview) fail(new ExperienceError('CAMERA_ENDED', '相机已关闭，换装随之结束。'));
        });
      } else {
        options.onPhase('requestingCamera');
        await this.camera.start(options.signal, fail);
      }
      stage = 'status';
      options.signal.throwIfAborted(); options.onPhase('creatingSession');
      const statusResponse = await this.request('/api/studio/status', { cache: 'no-store', signal: options.signal });
      const status = await statusResponse.json() as StudioStatus;
      if (!statusResponse.ok || !status.available || !status.access) throw new ExperienceError('SERVICE_NOT_READY', '当前云端体验尚未就绪，请检查服务状态后再开启。');
      work.access = status.access;
      let credentialRequested = false;
      stage = 'sdk';
      const sdk = await this.factory(async () => {
        // SDK重连与内部请求不得获取第二个令牌，也不得复用首个令牌。
        if (credentialRequested || options.signal.aborted || this.work !== work) throw new Error('unauthorized: 本轮禁止再次连接');
        credentialRequested = true; work.issued = true;
        const response = await this.request('/api/studio/token', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Access': work.access },
          body: JSON.stringify({ attemptId: work.attemptId, consentVersion: STUDIO_POLICY.consentVersion, durationSec }), signal: options.signal });
        const value = await response.json();
        if (!response.ok || typeof value.apiKey !== 'string' || value.durationSec !== durationSec) {
          safeFailure = new ExperienceError('TOKEN_UNAVAILABLE', value.error?.message ?? '本轮令牌未能取得，请核对用量后再处理。');
          throw safeFailure;
        }
        options.signal.throwIfAborted(); return value.apiKey as string;
      });
      options.signal.throwIfAborted(); options.onPhase('connecting');
      stage = 'connection';
      const playing = this.remote.prepare(options.signal, fail);
      // SDK连接尚未返回时取消，播放等待也会拒绝；立即接住，避免未处理拒绝。
      void playing.catch(() => {});
      const local = work.input ?? this.camera.getSnapshot();
      if (!local) throw new Error('相机已关闭。');
      const client = await sdk.connect(local, {
        model: sdk.model, resolution: '720p', retries: 0, capacityRetryBudgetMs: 0, mirror: false,
        initialState: { prompt: { text: STUDIO_POLICY.prompt, enhance: false }, image: options.garment.blob },
        onRemoteStream: (stream) => {
          if (this.work !== work || options.signal.aborted) stream.getTracks().forEach((track) => track.stop());
          else this.remote.offer(stream);
        },
        onConnectionChange: (state) => {
          // 首次建连失败会先发disconnected再reject；让catch保留其脱敏错误类别。
          if (state === 'reconnecting') fail(new ExperienceError('CONNECTION_ENDED', '模型连接已中断，本轮停止，不自动重新建连。'));
          else if (state === 'disconnected' && connectionReady) queueMicrotask(() => fail(new ExperienceError('CONNECTION_ENDED', '模型连接已中断，本轮停止，不自动重新建连。')));
        },
      });
      if (this.work !== work || options.signal.aborted) { client.disconnect(); return; }
      this.client = client;
      connectionReady = true;
      client.on('error', (error) => fail(new ExperienceError('MODEL_ERROR', `模型返回错误（${safeSdkDiagnostic(error)}），本轮已停止。请检查账户、网络及供应商用量。`)));
      client.on('sessionEnded', () => fail(new ExperienceError('SESSION_ENDED', '供应商已结束连接，本轮测试停止。请核对用量及账户提示。')));
      client.on('generationTick', ({ seconds }) => { if (this.work === work && Number.isFinite(seconds) && seconds >= 0) work.seconds = seconds; });
      await playing; options.signal.throwIfAborted();
    } catch (error) {
      if (this.work === work && !options.signal.aborted) work.result = 'error';
      if (safeFailure) throw safeFailure;
      if (error instanceof ExperienceError || options.signal.aborted) throw error;
      const suffix = `（${safeSdkDiagnostic(error)}）`;
      const message = stage === 'sdk' ? '当前浏览器未能初始化模型SDK，尚未进入签发步骤。' : stage === 'status' ? '未能读取本机验证状态，尚未进入签发步骤。' : stage === 'camera' ? '相机准备发生异常，尚未进入签发步骤。' : '真实模型连接未完成，请核对网络、模型权限及供应商用量。';
      throw new ExperienceError('MODEL_CONNECT_FAILED', `${message}${suffix} 本轮已停止。`);
    } finally { options.signal.removeEventListener('abort', onAbort); }
  }
  async updateGarment(garment: Garment, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!this.client || !garment.blob) throw new ExperienceError('REAL_IMAGE_REQUIRED', '模型测试只接受本地上传的有效服装图片。');
    await this.client.set({ prompt: STUDIO_POLICY.prompt, image: garment.blob, enhance: false });
  }
  stop(): void {
    const work = this.work; this.work = null;
    const localTracks = this.camera.getSnapshot()?.getTracks() ?? [];
    try { this.client?.disconnect(); } catch { /* 仍必须继续清理本地媒体。 */ }
    this.client = null;
    const firstFrameMs = this.remote.firstFrameMs;
    work?.unwatch?.();
    work?.input?.getTracks().forEach((track) => track.stop());
    this.remote.stop();
    if (!this.mediaOptions.keepLocalPreview) this.camera.stop();
    if (!work) return;
    const observation: StudioObservation = { outcome: work.result, firstFrameMs, providerReportedSeconds: work.seconds, localTracksEnded: localTracks.every((track) => track.readyState === 'ended') };
    this.lastObservation = observation;
    if (work.issued && work.access) void this.request('/api/studio/observation', { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-Studio-Access': work.access }, body: JSON.stringify({ attemptId: work.attemptId, ...observation }) }).catch(() => {});
  }
}
