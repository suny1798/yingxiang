import { composePrompt, MAX_INSTRUCTIONS, type EditInstruction } from '../lib/prompt/composition';
import { promptText } from '../lib/prompt/policy';
import { promptActive, PromptSession } from '../lib/prompt/session';
import type { SessionScope } from './session-scope';

export type PromptView = 'original' | 'generated';
export interface PromptEditorState {
  owner: string | null;
  instructions: readonly EditInstruction[];
  draft: string;
  page: number;
  pageSize: number;
  pages: number;
  currentPage: number;
  view: PromptView;
}
export interface PromptEditorPlatform {
  cameraReady(): boolean;
  closeCamera(): void;
  openLogin(): void;
  hidden(): boolean;
  notify(message: string, kind: 'success' | 'error' | 'info'): void;
  translate(message: string): string;
}

const MAX_MESSAGE = '本次最多保留12条提示词，请先删除不需要的内容。';
const ACCOUNT_MESSAGE = '已清空上一账号的本次提示词。';

/** 组合状态与既有PromptSession之间的Vue编排；不复制模型协议或令牌逻辑。 */
export class PromptEditor {
  private state: PromptEditorState = { owner: null, instructions: [], draft: '', page: 0, pageSize: 3, pages: 1, currentPage: 0, view: 'original' };
  private listeners = new Set<() => void>();
  private sequence = 0;
  private readonly stopIdentity: () => void;
  private disposed = false;

  constructor(private readonly session: PromptSession, private readonly platform: PromptEditorPlatform, private readonly scope: SessionScope) {
    this.state = { ...this.state, owner: scope.capture().userId };
    this.stopIdentity = scope.onIdentityChange(() => this.identityChanged(scope.capture().userId));
  }

  getSnapshot = (): PromptEditorState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<PromptEditorState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private layout(instructions: readonly EditInstruction[], pageSize = this.state.pageSize, page = this.state.page): Pick<PromptEditorState, 'pages' | 'currentPage'> {
    const pages = Math.max(1, Math.ceil(instructions.length / pageSize));
    return { pages, currentPage: Math.min(Math.max(0, page), pages - 1) };
  }
  private update(instructions: readonly EditInstruction[], patch: Partial<PromptEditorState> = {}) {
    this.publish({ instructions, ...this.layout(instructions, patch.pageSize ?? this.state.pageSize, patch.page ?? this.state.page), ...patch });
  }
  private sync(instructions: readonly EditInstruction[]) {
    const prompt = composePrompt(instructions);
    this.session.syncComposition(prompt, instructions.map((item) => item.text));
  }
  private message(message: string, kind: 'success' | 'error' | 'info' = 'info') { this.platform.notify(this.platform.translate(message), kind); }
  private active(): boolean { return promptActive(this.session.getSnapshot().phase); }

  setDraft(draft: string) { this.publish({ draft }); }
  setView(view: PromptView) { this.publish({ view }); }
  setPage(page: number) {
    const currentPage = Math.min(Math.max(0, page), this.state.pages - 1);
    this.publish({ page: currentPage, currentPage });
  }
  setPageSize(pageSize: number) {
    const value = [1, 2, 3].includes(pageSize) ? pageSize : 3;
    this.publish({ pageSize: value, page: 0, ...this.layout(this.state.instructions, value, 0) });
  }
  setConsent(consent: boolean) { this.session.setConsent(consent); }

  add(text: string): boolean {
    try {
      const value = promptText(text);
      if (this.state.instructions.length >= MAX_INSTRUCTIONS) { this.message(MAX_MESSAGE, 'info'); return false; }
      const next = [...this.state.instructions, { id: ++this.sequence, text: value }];
      const page = Math.floor((next.length - 1) / this.state.pageSize);
      this.update(next, { draft: '', page, view: 'generated' });
      this.sync(next);
      this.message(this.active() ? '正在发送完整提示词组合…' : '已加入组合，确认云端处理后可开始编辑。');
      return true;
    } catch (error) {
      this.message(error instanceof Error ? error.message : '提示词未能加入本次组合。', 'error');
      return false;
    }
  }

  remove(id: number): boolean {
    const next = this.state.instructions.filter((item) => item.id !== id);
    if (next.length === this.state.instructions.length) return false;
    this.update(next);
    this.sync(next);
    if (!next.length) {
      this.publish({ view: 'original' });
      this.message('已移除全部提示词，已恢复相机原画。');
    } else {
      this.message(this.active() ? '已移除，正在同步剩余提示词…' : '已从本次组合移除。');
    }
    return true;
  }

  /** 只设置本轮完整组合并交给既有控制器；登录、服务与相机门禁由页面先核对。 */
  start(): boolean {
    if (!this.state.owner) { this.platform.openLogin(); return false; }
    if (!this.platform.cameraReady()) { this.message('请先打开相机并等待预览就绪。'); return false; }
    if (!this.state.instructions.length || !this.session.getSnapshot().consent) return false;
    const instructions = this.state.instructions;
    this.session.setDraft(composePrompt(instructions), instructions.map((item) => item.text));
    this.publish({ view: 'generated' });
    void this.session.start();
    return true;
  }

  closeCamera(message = '相机已关闭，实时编辑随之结束。') {
    this.session.stop(message);
    this.platform.closeCamera();
  }

  /** 切后台/离开页面停止连接与相机；组合仍只在本页内存中，不自动重连。 */
  hidden() {
    if (!this.platform.hidden()) return;
    this.session.stop('页面已离开前台，实时编辑已结束。');
    this.platform.closeCamera();
  }

  private identityChanged(owner: string | null) {
    const previous = this.state.owner;
    this.session.setConsent(false);
    if (previous) {
      this.platform.closeCamera();
      this.update([], { draft: '', page: 0, view: 'original' });
      this.message(ACCOUNT_MESSAGE);
    }
    this.publish({ owner });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopIdentity();
    this.session.dispose();
    this.platform.closeCamera();
    this.listeners.clear();
  }
}
