import { ExperienceError, type ConnectOptions, type Garment, type TryOnAdapter } from './types';

/** 可取消的纯本地等待，不访问相机、网络或模型。 */
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('已取消', 'AbortError')); return; }
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class MockTryOnAdapter implements TryOnAdapter {
  readonly mode = 'mock' as const;
  constructor(private readonly delayMs = 500) {}

  async connect({ scenario, signal, onPhase }: ConnectOptions): Promise<void> {
    onPhase('requestingCamera');
    await abortableDelay(this.delayMs, signal);
    if (scenario === 'camera-denied') throw new ExperienceError('CAMERA_DENIED', '尚未获得相机权限。正式使用时，请在浏览器中允许后重试。');
    onPhase('creatingSession');
    await abortableDelay(this.delayMs, signal);
    if (scenario === 'capacity') throw new ExperienceError('CAPACITY_FULL', '体验位置暂时已满，请稍后再来。本次为模拟提示。');
    if (scenario === 'quota') throw new ExperienceError('QUOTA_EXHAUSTED', '今天的体验次数已用完。当前为额度提示演示。');
    onPhase('connecting');
    await abortableDelay(this.delayMs, signal);
    if (scenario === 'connection-error') throw new ExperienceError('UPSTREAM_UNAVAILABLE', '暂时无法连接映想。请检查网络，稍后手动重试。');
  }

  async updateGarment(_garment: Garment, signal: AbortSignal): Promise<void> { await abortableDelay(this.delayMs, signal); }
  async reconnect(signal: AbortSignal): Promise<void> { await abortableDelay(this.delayMs * 2, signal); }
  stop(): void { /* Mock 无媒体资源；取消信号由控制器统一管理。 */ }
}
