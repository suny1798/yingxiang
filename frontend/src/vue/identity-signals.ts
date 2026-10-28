export type IdentitySignal={phase:'changing'|'settled';id:string};
export interface IdentitySignals {
  publish(signal:IdentitySignal):void;
  subscribe(listener:(signal:IdentitySignal)=>void):()=>void;
  close():void;
}
/** 只传阶段和临时随机标记；不广播用户、Cookie、令牌或服务端详情。 */
export function createIdentitySignals():IdentitySignals|undefined {
  try {
    if(typeof BroadcastChannel==='undefined')return;
    const channel=new BroadcastChannel('yingxiang-account-coordination-v1');
    return {
      publish(signal){try{channel.postMessage(signal);}catch{/* 不以广播失败冒充认证失败。 */}},
      subscribe(listener){
        const read=(event:MessageEvent)=>{const value=event.data;if(value&&['changing','settled'].includes(value.phase)&&typeof value.id==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(value.id))listener({phase:value.phase,id:value.id});};
        channel.addEventListener('message',read);return ()=>channel.removeEventListener('message',read);
      },
      close(){channel.close();},
    };
  }catch{/* 不支持时仍使用focus／周期读取，不增加持久化身份数据。 */}
}
