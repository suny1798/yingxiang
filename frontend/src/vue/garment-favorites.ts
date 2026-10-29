import type { SessionScope } from './session-scope';
import { lookById } from '../lib/garment-library';

export type GarmentFavoritesState={ids:string[];loading:boolean;busyId:string|null;error:string|null;owner:string|null};
export type GarmentFavoritesPlatform={
  read(signal:AbortSignal,owner:string):Promise<{ids:string[]}>;
  write(signal:AbortSignal,owner:string,id:string,favorite:boolean):Promise<{id:string;favorite:boolean}>;
  login():void;
};
/** 只展示服务器已确认收藏；账号世代切换立即清空，中止旧读取／写入，不自动重试mutation。 */
export class GarmentFavorites {
  private state:GarmentFavoritesState={ids:[],loading:false,busyId:null,error:null,owner:null};
  private listeners=new Set<()=>void>();
  private readAbort:AbortController|undefined;
  private writeAbort:AbortController|undefined;
  private disposed=false;
  private stopIdentity:()=>void;
  constructor(private scope:SessionScope,private platform:GarmentFavoritesPlatform){
    this.stopIdentity=scope.onIdentityChange(()=>{this.readAbort?.abort();this.writeAbort?.abort();this.publish({ids:[],owner:null,loading:false,busyId:null,error:null});void this.refresh();});
  }
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private publish(patch:Partial<GarmentFavoritesState>){if(this.disposed)return;this.state={...this.state,...patch};this.listeners.forEach(listener=>listener());}
  async refresh(){
    this.readAbort?.abort();const token=this.scope.capture();
    if(this.disposed||!token.userId||this.scope.state.transitioning||this.scope.state.blocked)return;
    const current=new AbortController();this.readAbort=current;this.publish({loading:true,error:null,owner:token.userId});
    try{
      const result=await this.platform.read(current.signal,token.userId);
      if(!this.scope.current(token)||current.signal.aborted||this.disposed)return;
      this.publish({ids:[...new Set(result.ids.filter(id=>Boolean(lookById(id))))]});
    }catch(error){
      if(!this.scope.current(token)||current.signal.aborted||this.disposed)return;
      if((error as {status?:number}).status===401)await this.scope.unauthorized(token);
      else this.publish({error:'暂时无法读取衣装收藏，请重试。'});
    }finally{if(this.readAbort===current){this.readAbort=undefined;this.publish({loading:false});}}
  }
  async toggle(id:string){
    if(this.disposed||!lookById(id)||this.state.busyId||this.state.loading||this.scope.state.transitioning||this.scope.state.blocked)return;
    const token=this.scope.capture();if(!token.userId){this.platform.login();return;}
    // 初次读取失败时不能按“未收藏”猜测写入；先让用户核对服务器状态。
    if(this.state.error)return;
    this.readAbort?.abort();
    const current=new AbortController();this.writeAbort=current;
    const favorite=!this.state.ids.includes(id);this.publish({busyId:id,error:null});
    try{
      const result=await this.platform.write(current.signal,token.userId,id,favorite);
      if(!this.scope.current(token)||current.signal.aborted||this.disposed)return;
      if(result.id!==id||result.favorite!==favorite)throw new Error('Unexpected response');
      this.publish({ids:favorite?[id,...this.state.ids.filter(value=>value!==id)]:this.state.ids.filter(value=>value!==id)});
    }catch(error){
      if(!this.scope.current(token)||current.signal.aborted||this.disposed)return;
      if((error as {status?:number}).status===401)await this.scope.unauthorized(token);
      else this.publish({error:'收藏保存未确认，请重新读取收藏状态后再操作。'});
    }finally{if(this.writeAbort===current){this.writeAbort=undefined;this.publish({busyId:null});}}
  }
  dispose(){this.disposed=true;this.readAbort?.abort();this.writeAbort?.abort();this.stopIdentity();this.listeners.clear();}
}
