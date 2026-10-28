// 实际Nginx＋原始HTTP替身合同。只使用随机回环端口和自建临时prefix。
import assert from 'node:assert/strict';
import { createServer as httpServer, request } from 'node:http';
import { createServer as netServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
const root=fileURLToPath(new URL('../',import.meta.url));
const nginx=process.env.MIGRATION_NGINX_BIN??'nginx';
const version=spawnSync(nginx,['-v'],{encoding:'utf8',windowsHide:true});
assert.equal(version.status,0,'Nginx unavailable; set MIGRATION_NGINX_BIN');
const nginxVersion=(version.stderr+version.stdout).match(/nginx\/[\d.]+/)?.[0];
assert.ok(nginxVersion,'Nginx version unavailable');
const runtime=await mkdtemp(join(tmpdir(),'yingxiang-nginx-'));
const safePath=value=>{const path=resolve(value).replaceAll('\\','/');assert.ok(!/["$\r\n]/.test(path),'Unsupported runtime path');return path;};
let gateway,upstream,checks=0,echoPosts=0,ambiguousPosts=0;
const data=Buffer.from('0123456789abcdefghijklmnopqrstuv');
const send=(response,status,body,headers={})=>{response.writeHead(status,{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});response.end(body);};
function json(response,status,body,headers={}) {send(response,status,JSON.stringify(body),{'Content-Type':'application/json',...headers});}
async function http(port,path,{method='GET',headers={},body,chunked=false}={}) {
  return new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path,method,headers,timeout:5000},response=>{
      const chunks=[];response.on('data',part=>chunks.push(part));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));response.on('error',reject);
    });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Entry request deadline')));
    if(chunked&&body){req.write(body.subarray(0,3));req.write(body.subarray(3));req.end();}else req.end(body);
  });
}
async function waitReady(port) {
  const end=Date.now()+10000;
  while(Date.now()<end) {try {if((await http(port,'/__entry_live')).status===204)return;}catch{} await new Promise(resolve=>setTimeout(resolve,100));}
  throw new Error('Nginx startup deadline; inspect temporary error log');
}
async function cleanup() {
  if(gateway&&gateway.exitCode===null) {
    spawnSync(nginx,['-p',runtime+'/', '-c','nginx.conf','-s','quit'],{windowsHide:true,stdio:'ignore',timeout:3000});
    await Promise.race([once(gateway,'exit'),new Promise(resolve=>setTimeout(resolve,3000))]);
    if(gateway.exitCode===null) {
      // 只终止仍由本脚本持有的子进程；不按名称停止其他Nginx实例。
      if(process.platform==='win32')spawnSync('taskkill',['/PID',String(gateway.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:3000});
      else gateway.kill('SIGKILL');
      await Promise.race([once(gateway,'exit'),new Promise(resolve=>setTimeout(resolve,3000))]);
    }
  }
  if(upstream?.listening){upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));}
  const target=resolve(runtime),parent=resolve(tmpdir());
  assert.ok(target.startsWith(parent+sep)&&target!==parent&&target.split(sep).at(-1).startsWith('yingxiang-nginx-'),'Runtime cleanup escaped temp');
  await rm(target,{recursive:true,force:true});
}
try {
  upstream=httpServer(async(req,res)=>{
    try {
      if(req.url.startsWith('/api/fixture-echo')) {
        const chunks=[];for await(const part of req)chunks.push(part);const bytes=Buffer.concat(chunks);if(req.method==='POST')echoPosts++;
        json(res,200,{url:req.url,method:req.method,host:req.headers.host,origin:req.headers.origin??null,cookie:req.headers.cookie??null,
          forwarded:req.headers.forwarded??null,xff:req.headers['x-forwarded-for'],xfh:req.headers['x-forwarded-host'],xfp:req.headers['x-forwarded-proto'],realIp:req.headers['x-real-ip'],
          signature:req.headers['stripe-signature'],owner:req.headers['x-work-owner'],attempt:req.headers['x-video-attempt'],contentType:req.headers['content-type'],
          hash:createHash('sha256').update(bytes).digest('hex'),length:bytes.length},{'Set-Cookie':['yingxiang_session=synthetic; HttpOnly; Path=/; SameSite=Lax','yingxiang-theme=dark; Path=/; SameSite=Lax'],'X-Powered-By':'synthetic-upstream'});return;
      }
      if(req.url==='/api/fixture-ambiguous'){ambiguousPosts++;req.socket.destroy();return;}
      if(req.url.startsWith('/api/fixture-status/')){const status=Number(req.url.split('/').at(-1));json(res,status,{error:{code:'SYNTHETIC_DENIAL',retryable:false}},{'Retry-After':'7'});return;}
      if(req.url==='/api/fixture-file') {
        const range=req.headers.range,ifRange=req.headers['if-range'];let start=0,end=data.length-1,status=200;
        if(range&&(!ifRange||ifRange==='"synthetic-etag"')) {
          const match=range.match(/^bytes=(\d+)-(\d+)$/);start=Number(match?.[1]);end=Number(match?.[2]);
          if(!match||start>end||start>=data.length){send(res,416,'',{'Content-Range':`bytes */${data.length}`});return;}
          end=Math.min(end,data.length-1);status=206;
        }
        const bytes=data.subarray(start,end+1);send(res,status,req.method==='HEAD'?undefined:bytes,{'Content-Type':'video/mp4','Content-Length':bytes.length,'Content-Disposition':'attachment; filename="synthetic.mp4"','ETag':'"synthetic-etag"','Accept-Ranges':'bytes',...(status===206?{'Content-Range':`bytes ${start}-${end}/${data.length}`}:{})});return;
      }
      if(req.url==='/api/account/me'){json(res,200,{user:null,trial:null,trialLimit:0,trialRemaining:0,durations:[15,30,60].map(seconds=>({seconds,limit:0,remaining:0})),history:[]});return;}
      if(req.url==='/api/payments/status'){json(res,200,{testEnabled:false});return;}
      if(req.url==='/api/site/announcement'){json(res,200,{enabled:false,version:0,zh:'',en:''});return;}
      json(res,404,{error:{code:'NOT_FOUND',message:'synthetic unknown API',retryable:false},requestId:'synthetic'});
    }catch {if(!res.headersSent)json(res,503,{error:{code:'SERVICE_UNAVAILABLE'}});}
  });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const reservation=netServer().listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  await mkdir(join(runtime,'logs'));await mkdir(join(runtime,'body'));await mkdir(join(runtime,'proxy'));await mkdir(join(runtime,'temp'));
  const template=await readFile(join(root,'deploy/nginx.local.conf.template'),'utf8');
  const config=template.replaceAll('@RUNTIME@',safePath(runtime)).replaceAll('@DIST@',safePath(join(root,'dist'))).replaceAll('@PORT@',String(port)).replaceAll('@UPSTREAM@',String(upstream.address().port));
  await writeFile(join(runtime,'nginx.conf'),config);
  const validate=spawnSync(nginx,['-p',runtime+'/', '-c','nginx.conf','-t'],{windowsHide:true,cwd:runtime,encoding:'utf8'});
  assert.equal(validate.status,0,`Generated Nginx configuration rejected: ${validate.stderr}`);
  gateway=spawn(nginx,['-p',runtime+'/', '-c','nginx.conf'],{windowsHide:true,cwd:runtime,stdio:'ignore'});
  await waitReady(port);
  if(process.argv.includes('--browser-window')) {
    console.log(JSON.stringify({browserOrigin:`http://127.0.0.1:${port}`,syntheticUpstream:true,maximumSeconds:180}));
    // 给桌面浏览器走查保留有限窗口，到期后自动执行合同并清理。
    await new Promise(resolve=>setTimeout(resolve,180000));
  }
  const check=(value,message)=>{assert.ok(value,message);checks++;};
  const index=await readFile(join(root,'dist/index.html'));
  for(const path of ['/','/pricing','/help','/help/feedback','/privacy','/terms','/terms?synthetic=1']) {
    const value=await http(port,path);check(value.status===200&&value.body.equals(index),'Known public route must serve built entry');check(value.headers['cache-control']==='no-store','HTML cache');
  }
  const unknown=await http(port,'/synthetic-not-a-page');check(unknown.status===404&&unknown.body.equals(index),'Unknown page HTTP404 with app entry');
  const assets=await readdir(join(root,'dist/assets'));const script=assets.find(name=>/^app-.+\.js$/.test(name));assert.ok(script);
  const asset=await http(port,'/assets/'+script);check(asset.status===200&&asset.headers['content-type'].includes('javascript'),'Script MIME');check(asset.headers['cache-control'].includes('immutable'),'Fingerprint cache');
  const conditional=await http(port,'/assets/'+script,{headers:{'If-None-Match':asset.headers.etag}});check(conditional.status===304,'Static conditional response');
  const missing=await http(port,'/assets/synthetic-missing-12345678.js');check(missing.status===404&&!missing.body.equals(index)&&missing.headers['cache-control']==='no-store','Missing asset must not serve entry');
  for(const path of ['/api','/api/synthetic-not-found']) {const value=await http(port,path);check(value.status===404&&JSON.parse(value.body).error.code==='NOT_FOUND','Unknown API stays upstream JSON');}
  const body=Buffer.from('  {"synthetic":"\u8863\u670d"}\n\x00');
  const headers={Origin:`http://127.0.0.1:${port}`,Cookie:'synthetic-cookie=value','Content-Type':'multipart/form-data; boundary=synthetic-boundary','Stripe-Signature':'synthetic-signature','X-Work-Owner':'synthetic-owner','X-Video-Attempt':'synthetic-attempt',Forwarded:'for=6.6.6.6','X-Forwarded-For':'6.6.6.6','X-Forwarded-Host':'forged.invalid','X-Forwarded-Proto':'https','X-Real-IP':'6.6.6.6'};
  const echo=await http(port,'/api/fixture-echo',{method:'POST',headers,body,chunked:true});const value=JSON.parse(echo.body);
  check(value.hash===createHash('sha256').update(body).digest('hex')&&value.length===body.length,'Raw chunked bytes');
  check(value.host===`127.0.0.1:${port}`&&value.origin===headers.Origin&&value.cookie===headers.Cookie,'Host Origin Cookie');
  check(value.forwarded===null&&value.xff==='127.0.0.1'&&value.xfh===value.host&&value.xfp==='http'&&value.realIp==='127.0.0.1','Forwarding spoof removed');
  check(value.signature===headers['Stripe-Signature']&&value.owner===headers['X-Work-Owner']&&value.attempt===headers['X-Video-Attempt']&&value.contentType===headers['Content-Type'],'Business headers and multipart boundary');
  check(echo.headers['set-cookie'].length===2&&echo.headers['set-cookie'][0].includes('HttpOnly'),'Set-Cookie');
  check(echo.headers['cache-control']==='no-store'&&echo.headers['x-content-type-options']==='nosniff'&&!echo.headers['x-powered-by'],'Private response headers');
  const query=await http(port,'/api/fixture-echo?synthetic=a%2Bb&duplicate=1&duplicate=2');check(JSON.parse(query.body).url==='/api/fixture-echo?synthetic=a%2Bb&duplicate=1&duplicate=2','Raw query preservation');
  for(const status of [401,403,409,429,503]){const value=await http(port,`/api/fixture-status/${status}`);check(value.status===status&&JSON.parse(value.body).error.code==='SYNTHETIC_DENIAL'&&value.headers['retry-after']==='7','Upstream business denial preserved');}
  for(const method of ['GET','HEAD']) {const value=await http(port,'/api/fixture-file',{method,headers:{Range:'bytes=3-7','If-Range':'"synthetic-etag"'}});check(value.status===206&&value.headers['content-range']===`bytes 3-7/${data.length}`&&value.headers['content-length']==='5','Range status and lengths');check(method==='HEAD'?value.body.length===0:value.body.equals(data.subarray(3,8)),'Range body');check(value.headers.etag==='"synthetic-etag"'&&value.headers['content-disposition'].includes('synthetic.mp4'),'Range metadata');}
  check((await http(port,'/api/fixture-file',{headers:{Range:'bytes=999-1000'}})).status===416,'Invalid range');
  check((await http(port,'/api/fixture-file',{headers:{Range:'bytes=3-7','If-Range':'"different"'}})).status===200,'If-Range fallback');
  for(const host of [`127.0.0.1:${port}`,`localhost:${port}`])check((await http(port,'/terms',{headers:{Host:host}})).status===200,'Allowed local Host');
  check((await http(port,'/terms',{headers:{Host:'forged.invalid','X-Forwarded-Host':`127.0.0.1:${port}`}})).status===403,'Wrong Host cannot borrow forwarded host');
  const over=await http(port,'/api/fixture-echo',{method:'POST',headers:{'Content-Length':'36704257'}});check(over.status===413&&JSON.parse(over.body).error.code==='BODY_TOO_LARGE'&&echoPosts===1,'Outer body bound');
  const ambiguous=await http(port,'/api/fixture-ambiguous',{method:'POST',body:Buffer.from('{}')});check(ambiguous.status===503&&ambiguousPosts===1,'Ambiguous POST must not retry');
  upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));const down=await http(port,'/api/account/me');check(down.status===503&&JSON.parse(down.body).error.code==='SERVICE_UNAVAILABLE'&&down.headers['cache-control']==='no-store','Upstream down is controlled503');
}finally {await cleanup();}
console.log(JSON.stringify({status:'OK',checks,nginxVersion,echoPosts,ambiguousPosts,realProviderCalls:0,temporaryPrefixRemoved:true}));
