// 显式运行的回环UI替身，不是业务后端；不读取Cookie／配置／密钥，不调用外部服务。
import { createServer } from 'node:http';
const state={enabled:false,user:null,checkoutMode:'missing',posts:[],reads:0};
function send(response,status,body) {response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(body));}
const server=createServer(async(request,response)=>{
  let data={};
  if(request.method==='POST') {
    let size=0;const chunks=[];
    for await(const part of request) {size+=part.length;if(size>4096){send(response,413,{error:{message:'fixture body too large'}});return;}chunks.push(part);}
    try {data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch {send(response,400,{});return;}
  }
  if(request.url==='/__fixture'&&request.method==='POST') {
    if(typeof data.enabled==='boolean')state.enabled=data.enabled;
    if(data.user===null||data.user==='synthetic-buyer')state.user=data.user;
    if(['missing','unknown','invalid'].includes(data.checkoutMode))state.checkoutMode=data.checkoutMode;
    if(data.reset===true){state.posts=[];state.reads=0;}
    send(response,200,{ok:true});return;
  }
  if(request.url==='/__fixture'&&request.method==='GET'){send(response,200,{...state,realProviderCalls:0});return;}
  if(request.url==='/api/payments/status'&&request.method==='GET'){state.reads++;send(response,200,{testEnabled:state.enabled});return;}
  if(request.url==='/api/account/me'&&request.method==='GET') {
    state.reads++;const user=state.user?{id:'00000000-0000-4000-8000-000000000001',username:state.user,createdAt:'2026-10-28T00:00:00.000Z',role:'user'}:null;
    send(response,200,{user,trial:user?'ready':null,trialLimit:user?1:0,trialRemaining:user?1:0,durations:[15,30,60].map(seconds=>({seconds,limit:user&&seconds===15?1:0,remaining:user&&seconds===15?1:0})),history:[]});return;
  }
  if(request.url==='/api/payments/checkout'&&request.method==='POST') {
    if(!state.enabled||!state.user){send(response,403,{error:{message:'synthetic gate closed'}});return;}
    if(!/^credits-v1-(light|creator|plus)$/.test(data.sku)||!String(data.requestId).match(/^[a-f0-9-]{36}$/i)){send(response,400,{});return;}
    state.posts.push({sku:data.sku,requestId:data.requestId});
    if(state.checkoutMode==='unknown'){send(response,503,{error:{message:'支付准备未完成，请到订单中核查。'}});return;}
    send(response,200,state.checkoutMode==='invalid'?{url:'https://invalid.example'}:{});return;
  }
  send(response,404,{});
});
server.once('error',()=>{console.error('PUBLIC_FIXTURE_START_FAILED');process.exit(1);});
server.listen(8790,'127.0.0.1',()=>console.log('PUBLIC_FIXTURE_LOOPBACK_READY'));
