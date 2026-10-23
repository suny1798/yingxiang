import { LocalCamera } from './local-camera';

export interface CameraPreviewState { phase: 'off' | 'requesting' | 'ready' | 'error'; message: string | null }

/** 独立的本地相机生命周期；不依赖账号、服装图、SDK或网络。 */
export class CameraPreviewSession {
  private snapshot: CameraPreviewState = { phase: 'off', message: null };
  private listeners = new Set<() => void>();
  private operation: AbortController | null = null;
  constructor(readonly camera: LocalCamera) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(phase: CameraPreviewState['phase'], message: string | null = null) {
    this.snapshot = { phase, message }; this.listeners.forEach((listener) => listener());
  }
  async start(): Promise<void> {
    if (this.operation) return;
    const operation = new AbortController(); this.operation = operation;
    this.publish('requesting');
    const fail = (error: Error) => {
      if (this.operation !== operation) return;
      this.operation = null; this.publish('error', error.message);
    };
    try {
      await this.camera.start(operation.signal, fail);
      if (this.operation === operation && !operation.signal.aborted) this.publish('ready');
    } catch (error) {
      if (this.operation !== operation || operation.signal.aborted) return;
      fail(error instanceof Error ? error : new Error('相机暂不可用，请重试。'));
    }
  }
  stop(): void {
    const operation = this.operation; this.operation = null;
    operation?.abort(); this.camera.stop(); this.publish('off');
  }
}
