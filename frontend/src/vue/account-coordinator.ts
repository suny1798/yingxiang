import type { AccountView } from '../lib/account';
import { envelopeData, envelopeMessage } from '../lib/api-response';
import { SessionScope } from './session-scope';
import type { IdentitySignal,IdentitySignals } from './identity-signals';

type Snapshot={account:AccountView|null;error:string|null;busy:boolean};
type Request=(url:string,init:RequestInit)=>Promise<Response>;
const readError='暂时无法读取账号，请稍后重试。';
const operationError='账号操作未完成，请刷新状态核查，不要重复提交。';
class AccountOperationError extends Error {}
function accountValue(value:unknown):AccountView {
  const a=value as AccountView;
  if(!a||typeof a!=='object'||!('user' in a)||
    (a.user!==null&&(!a.user||typeof a.user.id!=='string'||!a.user.id||typeof a.user.username!=='string'||!a.user.username||typeof a.user.createdAt!=='string'||(a.user.role!==undefined&&!['user','admin'].includes(a.user.role))))||
    ![null,'ready','review','used'].includes(a.trial)||!Number.isSafeInteger(a.trialLimit)||a.trialLimit<0||!Number.isSafeInteger(a.trialRemaining)||a.trialRemaining<0||
    !Array.isArray(a.durations)||!Array.isArray(a.history))throw new Error(readError);
  return a;
}

/** 唯一账号读取／认证协调器；服务器详情进入Query，Pinia只协调身份和弹窗。 */
export class AccountCoordinator {
  private snapshot:Snapshot={account:null,error:null,busy:false};
  private listeners=new Set<()=>void>();
  private revision=0;
  private pending:Promise<AccountView|null>|null=null;
  private readController:AbortController|null=null;
  private mutationController:AbortController|null=null;
  private active=true;
  private stopScope:()=>void;
  private stopSignals:(()=>void)|undefined;
  private localBusy=false;
  private remote=new Map<string,ReturnType<typeof setTimeout>>();
  constructor(readonly scope:SessionScope,private request:Request=(url,init)=>fetch(url,init),private signals?:IdentitySignals,private remoteTimeoutMs=60_000){
    this.stopScope=scope.onIdentityChange(()=>this.publish({account:null,error:null}));
    this.stopSignals=signals?.subscribe(signal=>this.receive(signal));
  }
  getSnapshot=()=>this.snapshot;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
  private publish(value:Partial<Snapshot>){if(!this.active)return;this.snapshot={...this.snapshot,...value};this.listeners.forEach(listener=>listener());}
  private abortRead(){this.revision++;this.readController?.abort();this.pending=null;}
  private updateBusy(){const busy=this.localBusy||this.remote.size>0;this.scope.state.transitioning=busy;this.publish({busy});}
  private receive(signal:IdentitySignal){
    if(!this.active)return;
    if(signal.phase==='settled'){
      const timer=this.remote.get(signal.id);if(!timer)return;
      clearTimeout(timer);this.remote.delete(signal.id);this.updateBusy();
      if(!this.snapshot.busy)void this.revalidate();return;
    }
    if(this.remote.has(signal.id)||this.remote.size>=32)return;
    this.remote.set(signal.id,setTimeout(()=>this.receive({phase:'settled',id:signal.id}),this.remoteTimeoutMs));
    this.abortRead();this.updateBusy();
    void this.scope.changeIdentity(null,true).then(()=>{if(!this.snapshot.busy)void this.revalidate();}).catch(()=>this.publish({error:'旧账号资源清理未完成，请刷新页面后继续。'}));
  }
  private read=():Promise<AccountView|null>=>{
    if(!this.active||this.scope.state.blocked||this.remote.size)return Promise.resolve(null);
    this.abortRead();const operation=this.revision,token=this.scope.capture(),controller=new AbortController();this.readController=controller;
    const pending=(async()=>{
      try {
        const response=await Promise.resolve().then(()=>this.request('/api/account/me',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)])}));
        if(response.status===401){
          if(!this.active||operation!==this.revision||!this.scope.current(token))return null;
          const clearing=this.scope.unauthorized(token),confirmed=this.scope.capture();await clearing;
          if(!this.active||operation!==this.revision||!this.scope.current(confirmed))return null;
          const anonymous:AccountView={user:null,trial:null,trialLimit:0,trialRemaining:0,durations:[],history:[]};
          this.publish({account:anonymous,error:null});return anonymous;
        }
        if(!response.ok)throw new Error(readError);
        const account=accountValue(envelopeData(await response.json()));
        if(!this.active||operation!==this.revision||!this.scope.current(token))return null;
        const previous=this.snapshot.account?.user;
        const roleChanged=!!previous&&previous.id===account.user?.id&&(previous.role??'user')!==(account.user.role??'user');
        const changing=this.scope.changeIdentity(account.user?.id??null,roleChanged),confirmed=this.scope.capture();await changing;
        if(!this.active||operation!==this.revision||!this.scope.current(confirmed))return null;
        if(account.user)this.scope.client.setQueryData(['private',account.user.id,confirmed.epoch,'account'],account);
        this.publish({account,error:null});return account;
      }catch {
        if(this.active&&operation===this.revision)this.publish({error:this.scope.state.blocked?'旧账号资源清理未完成，请刷新页面后继续。':readError});return null;
      }finally {if(operation===this.revision){this.pending=null;this.readController=null;}}
    })();this.pending=pending;return pending;
  };
  refresh=()=>this.snapshot.busy?Promise.resolve(null):this.read();
  revalidate=()=>this.snapshot.busy?Promise.resolve(null):this.pending??this.read();

  async authenticate(register:boolean,username:string,password:string){
    return this.authentication(register?'register':'login',{username,password});
  }
  async logout(){await this.authentication('logout');}
  private async authentication(action:'login'|'register'|'logout',body?:{username:string;password:string}) {
    if(!this.active||this.snapshot.busy)throw new Error('账号操作正在处理中。');
    const signalId=this.signals?crypto.randomUUID():undefined;
    this.localBusy=true;this.updateBusy();this.abortRead();this.publish({error:null});
    if(signalId)this.signals!.publish({phase:'changing',id:signalId});
    const controller=new AbortController();this.mutationController=controller;
    try {
      // 在任何写入前隔离旧身份；失败后只能以新的服务器读取恢复显示。
      await this.scope.changeIdentity(null,true);
      const response=await this.request(`/api/account/${action}`,{method:'POST',cache:'no-store',credentials:'same-origin',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)]),
        ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
      if(!response.ok){
        let message=operationError;
        try {const text=envelopeMessage(await response.json());if(typeof text==='string'&&text.length<=500)message=text;}catch{}
        throw new AccountOperationError(message);
      }
      if(!this.active)throw new Error(operationError);
      const verified=await this.read();
      if(!verified||(action==='logout'?!!verified.user:!verified.user||verified.user.username.toLowerCase()!==body!.username.trim().toLowerCase()))throw new Error(operationError);
      this.scope.state.loginOpen=false;return verified;
    }catch(error){
      // 不补发POST；仅核查当前Cookie。成功与否仍按本次写入和本人再确认判断。
      if(this.active)await this.read();
      throw new Error(this.scope.state.blocked?'旧账号资源清理未完成，请刷新页面后继续。':error instanceof AccountOperationError?error.message:operationError);
    }finally {this.mutationController=null;this.localBusy=false;this.updateBusy();if(signalId)this.signals!.publish({phase:'settled',id:signalId});}
  }
  async dispose(){this.active=false;this.abortRead();this.mutationController?.abort();this.listeners.clear();this.stopScope();this.stopSignals?.();this.signals?.close();for(const timer of this.remote.values())clearTimeout(timer);this.remote.clear();this.scope.state.transitioning=false;await this.scope.changeIdentity(null,true);}
}
