import { LocalCamera } from '../media/local-camera';
import { MockTryOnAdapter } from './mock-adapter';
import { ExperienceError, type ConnectOptions, type Garment, type TryOnAdapter } from './types';

/** 真实本地相机 + 模拟生成；不向模型或业务服务发送媒体。 */
export class LocalPreviewAdapter implements TryOnAdapter {
  readonly mode = 'mock' as const;
  readonly hasLocalCamera = true;
  private mock = new MockTryOnAdapter();
  constructor(readonly camera: LocalCamera) {}
  async connect(options: ConnectOptions): Promise<void> {
    options.onPhase('requestingCamera');
    if (options.scenario === 'camera-denied') throw new ExperienceError('CAMERA_DENIED', '这是相机拒绝的模拟提示，未申请真实相机。请选择正常流程后重试。');
    await this.camera.start(options.signal, (error) => options.onError?.(error));
    options.signal.throwIfAborted();
    await this.mock.connect({ ...options, onPhase: (phase) => { if (phase !== 'requestingCamera') options.onPhase(phase); } });
  }
  updateGarment(garment: Garment, signal: AbortSignal) { return this.mock.updateGarment(garment, signal); }
  reconnect(signal: AbortSignal) { return this.mock.reconnect(signal); }
  stop() { this.camera.stop(); this.mock.stop(); }
}
