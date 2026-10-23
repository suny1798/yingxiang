import { LocalCamera } from '../media/local-camera';
import { RemotePreview } from '../media/remote-preview';
import { browserRequest, DecartRealtime, sdkFor, type RealtimeSdkFactory } from '../media/decart-realtime';
import { PROMPT_POLICY, promptText } from './policy';
export const preparePromptSdk = sdkFor(PROMPT_POLICY.model);
export interface PromptConnectOptions { prompt: string; signal: AbortSignal; onError: (error: Error) => void }
export interface PromptAdapter { connect(options: PromptConnectOptions): Promise<void>; update(prompt: string, signal: AbortSignal): Promise<void>; stop(): void }
export class DecartPromptAdapter extends DecartRealtime implements PromptAdapter {
  constructor(camera: LocalCamera, remote: RemotePreview, request: typeof fetch = browserRequest, factory: RealtimeSdkFactory = preparePromptSdk) {
    super(camera, remote, request, factory, { keepLocalPreview: true }, { status: '/api/prompt/status', token: '/api/prompt/token', consentVersion: PROMPT_POLICY.consentVersion });
  }
  async connect(options: PromptConnectOptions) { await this.connectState({ ...options, state: { prompt: promptText(options.prompt) }, durationSec: PROMPT_POLICY.durationSec, onPhase: () => {} }); }
  async update(prompt: string, signal: AbortSignal) { await this.updateState({ prompt: promptText(prompt) }, signal); }
}
