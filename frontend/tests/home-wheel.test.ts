import assert from 'node:assert/strict';
import test from 'node:test';
import { bindHeroWheel } from '../src/lib/public-home';

function environment(run:(env:{wheel:(value?:object)=>{prevented:boolean};scrolls:object[];timers:Map<number,()=>void>;setModal:(value:boolean)=>void;stop:()=>void})=>void,reduced=false) {
  const keys=['window','document','Element','performance','setTimeout','clearTimeout'] as const;
  const saved=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const listeners=new Map<string,(event:WheelEvent)=>void>(),timers=new Map<number,()=>void>(),scrolls:object[]=[];
  let modal=false,next=0;
  class Element { constructor(private editable=false){} closest(){return this.editable?{}:null;} }
  const values={window:{innerWidth:1440,scrollY:0,addEventListener:(name:string,handler:(event:WheelEvent)=>void)=>listeners.set(name,handler),removeEventListener:(name:string)=>listeners.delete(name),scrollTo:(value:object)=>scrolls.push(value)},
    document:{querySelector:(selector:string)=>selector==='header'?{getBoundingClientRect:()=>({height:88})}:modal?{}:null},Element,performance:{now:()=>0},
    setTimeout:(callback:()=>void)=>{timers.set(++next,callback);return next;},clearTimeout:(id:number)=>timers.delete(id)};
  try {
    for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:values[key]});
    const hero={getBoundingClientRect:()=>({bottom:1000})} as HTMLElement,content={getBoundingClientRect:()=>({top:900})} as HTMLElement;
    const stop=bindHeroWheel(hero,content,reduced);
    run({wheel(value={}){const result={prevented:false};listeners.get('wheel')?.({deltaX:0,deltaY:100,ctrlKey:false,defaultPrevented:false,target:new Element(),preventDefault(){result.prevented=true;},...value} as unknown as WheelEvent);return result;},scrolls,timers,setModal(value){modal=value;},stop});
  } finally {
    for(const key of keys) {const descriptor=saved[key];if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
}

test('首页滚轮不抢占缩放／横向／向上／模态和已处理事件',()=>{
  environment(({wheel,scrolls,setModal,stop})=>{
    for(const value of [{ctrlKey:true},{deltaX:200},{deltaY:-100},{defaultPrevented:true}])assert.equal(wheel(value).prevented,false);
    setModal(true);assert.equal(wheel().prevented,false);setModal(false);assert.equal(scrolls.length,0);stop();
  });
});

test('首页只定位一次，减少动作即时定位，离开清除监听和释放计时器',()=>{
  for(const reduced of [false,true])environment(({wheel,scrolls,timers,stop})=>{
    assert.equal(wheel().prevented,true);assert.equal(wheel().prevented,true);
    assert.deepEqual(scrolls,[{top:812,behavior:reduced?'instant':'smooth'}]);assert.equal(timers.size,1);
    stop();assert.equal(timers.size,0);assert.equal(wheel().prevented,false);assert.equal(scrolls.length,1);
  },reduced);
});
