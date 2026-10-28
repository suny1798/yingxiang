import { defineStore, type Pinia } from 'pinia';
import { QueryClient, type QueryKey } from '@tanstack/vue-query';

/** 仅最小身份协调和弹窗；账号详情归Query，媒体／令牌／素材不进入store。 */
export const useIdentityScopeStore=defineStore('identity-scope',{
  state:()=>({userId:null as string|null,epoch:0,loginOpen:false,blocked:false,transitioning:false}),
});

export function createAppQueryClient() {
  return new QueryClient({defaultOptions:{
    queries:{retry:false,staleTime:0,gcTime:5*60_000,refetchOnWindowFocus:false},
    mutations:{retry:false},
  }});
}

export type IdentityToken=Readonly<{userId:string|null;epoch:number}>;
export class StaleIdentityError extends Error {
  constructor(){super('账号已变化，请重新读取当前状态。');this.name='StaleIdentityError';}
}
const privateQuery=(query:{queryKey:QueryKey})=>query.queryKey[0]==='private';

/** 所有私有查询必须经此边界；Query取消与账号世代检查同时存在。 */
export class SessionScope {
  readonly state:ReturnType<typeof useIdentityScopeStore>;
  private cleanups=new Set<()=>void>();
  constructor(readonly client:QueryClient,pinia:Pinia){this.state=useIdentityScopeStore(pinia);}
  capture():IdentityToken {return {userId:this.state.userId,epoch:this.state.epoch};}
  current(token:IdentityToken){return !this.state.blocked&&token.userId===this.state.userId&&token.epoch===this.state.epoch;}
  assertCurrent(token:IdentityToken){if(!this.current(token))throw new StaleIdentityError();}
  onIdentityChange(cleanup:()=>void){this.cleanups.add(cleanup);return ()=>{this.cleanups.delete(cleanup);};}

  /** 先推进世代，再同步取消／清缓存／停止旧资源。强制刷新用于退出或重新认证。 */
  async changeIdentity(userId:string|null,force=false) {
    if(!force&&userId===this.state.userId)return false;
    this.state.epoch++;this.state.userId=userId;
    const cancelled=this.client.cancelQueries({predicate:privateQuery},{silent:true});
    this.client.removeQueries({predicate:privateQuery});
    let failed=false;
    for(const cleanup of this.cleanups){try{cleanup();}catch{failed=true;}}
    if(failed)this.state.blocked=true;
    await cancelled;
    if(failed)throw new Error('旧账号资源清理未完成，请刷新页面后继续。');
    return true;
  }

  async unauthorized(token:IdentityToken) {
    if(!this.current(token))return false; // 迟到的旧401不得退出新账号。
    return this.changeIdentity(null,true);
  }

  private key(token:IdentityToken,key:QueryKey):QueryKey {
    if(this.state.transitioning)throw new Error('账号操作正在处理中。');
    if(this.state.blocked)throw new Error('旧账号资源清理未完成，请刷新页面后继续。');
    if(!token.userId)throw new Error('请先登录。');
    return ['private',token.userId,token.epoch,...key];
  }

  async query<T>(key:QueryKey,read:(signal:AbortSignal,token:IdentityToken)=>Promise<T>):Promise<T> {
    const token=this.capture();
    const value=await this.client.fetchQuery({queryKey:this.key(token,key),retry:false,
      queryFn:async({signal})=>{const result=await read(signal,token);this.assertCurrent(token);return result;},
    });
    // fetchQuery命中缓存后也必须复核，不能把缓存Promise的迟到值交给新账号界面。
    this.assertCurrent(token);return value;
  }

  async mutate<T>(write:(token:IdentityToken)=>Promise<T>):Promise<T> {
    const token=this.capture();this.key(token,[]);
    const result=await write(token); // 只调用一次；未知结果不自动补发。
    this.assertCurrent(token);return result;
  }
}
