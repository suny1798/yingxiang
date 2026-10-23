import { LocalCamera } from '../media/local-camera';
import { RemotePreview } from '../media/remote-preview';
import { browserRequest, DecartRealtime, sdkFor } from '../media/decart-realtime';
import { STUDIO_POLICY, isDurationSec } from '../studio/policy';
import { ExperienceError, type ConnectOptions, type Garment, type TryOnAdapter } from './types';
export { safeSdkDiagnostic, type RealtimeConnector, type RealtimeSdkFactory } from '../media/decart-realtime';
export const prepareRealtimeSdk = sdkFor(STUDIO_POLICY.model);

export class DecartTryOnAdapter extends DecartRealtime implements TryOnAdapter {
  readonly mode = 'real' as const;
  readonly initialView = 'generated' as const;
  constructor(camera: LocalCamera, remote: RemotePreview, request: typeof fetch = browserRequest, factory = prepareRealtimeSdk, mediaOptions: { keepLocalPreview?: boolean } = {}) {
    super(camera, remote, request, factory, mediaOptions, { status: '/api/studio/status', token: '/api/studio/token', observation: '/api/studio/observation', consentVersion: STUDIO_POLICY.consentVersion });
  }
  async connect(options: ConnectOptions): Promise<void> {
    const durationSec = options.durationSec ?? STUDIO_POLICY.clientWindowSec;
    if (!isDurationSec(durationSec)) throw new ExperienceError('INVALID_DURATION', '请选择15秒、30秒或1分钟。');
    if (!options.garment.blob) throw new ExperienceError('REAL_IMAGE_REQUIRED', '请上传有使用权的真实服装图片，示意素材不用于模型测试。');
    await this.connectState({ ...options, durationSec, state: { prompt: STUDIO_POLICY.prompt, image: options.garment.blob } });
  }
  async updateGarment(garment: Garment, signal: AbortSignal): Promise<void> {
    if (!garment.blob) throw new ExperienceError('REAL_IMAGE_REQUIRED', '模型测试只接受本地上传的有效服装图片。');
    await this.updateState({ prompt: STUDIO_POLICY.prompt, image: garment.blob }, signal);
  }
}
