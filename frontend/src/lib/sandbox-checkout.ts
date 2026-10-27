import type { AccountView } from './account';
import { checkoutDestination } from './payments';

export interface CheckoutSnapshot { enabled: boolean; ready: boolean; busy: boolean; error: string }
interface CheckoutDependencies {
  request(url: string, body?: object): Promise<Record<string, unknown>>;
  userId(): string | undefined;
  refresh(): Promise<AccountView | null>;
  openLogin(): void;
  navigate(url: string): void;
  requestId(): string;
}

/** 仅显式确认才POST；未知结果保留同一操作ID，不自动重试或认定付款。 */
export class SandboxCheckout {
  private snapshot: CheckoutSnapshot = { enabled:false,ready:false,busy:false,error:'' };
  private listeners = new Set<() => void>();
  private active = true;
  private inFlight = false;
  private operation: { sku:string; userId:string; requestId:string } | null = null;
  constructor(private readonly dependencies: CheckoutDependencies) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener:()=>void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<CheckoutSnapshot>) {
    if (!this.active) return;
    this.snapshot={...this.snapshot,...value}; this.listeners.forEach(listener=>listener());
  }
  clearError = () => this.update({error:''});
  async load() {
    try { const value=await this.dependencies.request('/api/payments/status'); this.update({enabled:value.testEnabled===true}); }
    catch { this.update({error:'支付服务暂不可用。'}); }
    finally { this.update({ready:true}); }
  }
  async buy(sku: string) {
    if (!this.active || this.inFlight || !this.snapshot.enabled) return;
    const userId=this.dependencies.userId();
    if (!userId) { this.dependencies.openLogin(); return; }
    this.inFlight=true; this.update({busy:true,error:''});
    try {
      const verified=await this.dependencies.refresh();
      if (!this.active) return;
      if (!verified?.user) { this.dependencies.openLogin(); return; }
      if (verified.user.id!==userId || this.dependencies.userId()!==userId) throw new Error('登录状态已变化，请重新确认订单。');
      if (!this.operation || this.operation.sku!==sku || this.operation.userId!==userId)
        this.operation={sku,userId,requestId:this.dependencies.requestId()};
      const result=await this.dependencies.request('/api/payments/checkout',{sku,requestId:this.operation.requestId});
      if (!this.active) return;
      if (this.dependencies.userId()!==userId) throw new Error('登录状态已变化，请重新确认订单。');
      this.dependencies.navigate(checkoutDestination(result.url));
    } catch (error) { this.update({error:error instanceof Error?error.message:'支付准备未完成，请到订单中核查。'}); }
    finally { this.inFlight=false; this.update({busy:false}); }
  }
  dispose() { this.active=false; this.listeners.clear(); }
}
