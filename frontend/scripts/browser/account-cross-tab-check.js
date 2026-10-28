async(page)=>{
  const origin='http://127.0.0.1:8791',check=(value,message)=>{if(!value)throw new Error(message);};
  check(new URL(page.url()).origin===origin,'Use isolated Vue preview');await page.unrouteAll({behavior:'wait'});
  const errors=[],onError=error=>errors.push(error.name);page.on('pageerror',onError);
  await page.context().addCookies([{name:'yingxiang-locale',value:'zh',url:origin},{name:'yingxiang-theme',value:'light',url:origin}]);
  // 故意保留与Cookie不同的同值localStorage，验证没有storage事件时也能同步。
  await page.evaluate(()=>{localStorage.setItem('yingxiang-locale','en');localStorage.setItem('yingxiang-theme','dark');window.__identityObserver?.close();});
  await page.request.post(origin+'/api/account/logout',{headers:{Origin:origin}});
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/account');
  const names=['scope_a_','scope_b_'].map(prefix=>prefix+Date.now().toString(36)),password='Synthetic-Only-123';
  const state=tab=>tab.evaluate(()=>{const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value['identity-scope'];return {epoch:s.epoch,userId:s.userId,transitioning:s.transitioning};});
  const api=async(path,body)=>{const response=await page.request.post(origin+path,{headers:{Origin:origin},data:body});check(response.ok(),'Synthetic identity control');};
  const focus=tab=>tab.evaluate(()=>window.dispatchEvent(new Event('focus')));
  async function credentials(tab,name,register=false){await tab.getByRole('button',{name:'登录 / 注册',exact:true}).click();const dialog=tab.locator('dialog[open]');if(register){await dialog.getByRole('button',{name:'创建账号',exact:true}).click();await dialog.getByRole('checkbox').check();}await dialog.getByRole('textbox',{name:/^账号/}).fill(name);await dialog.getByLabel(/^密码/).fill(password);await dialog.locator('form button[type=submit]').click();}
  async function logout(tab){await tab.getByRole('button',{name:'账号菜单',exact:true}).click();await tab.getByRole('button',{name:'退出登录',exact:true}).click();await tab.getByRole('button',{name:'登录 / 注册',exact:true}).waitFor();}
  const welcome=(tab,name)=>tab.getByRole('heading',{name:new RegExp(name)}).waitFor();
  await page.getByRole('button',{name:'登录 / 注册',exact:true}).waitFor();await credentials(page,names[0],true);await welcome(page,names[0]);
  const initial=await state(page);
  await api('/api/__migration/identity',{username:names[0],role:'admin'});await focus(page);
  await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('link',{name:'管理后台',exact:true}).waitFor();check((await state(page)).epoch>initial.epoch,'Promotion increments epoch');
  check((await page.request.get(origin+'/api/admin/overview')).status()===200,'Actual admin authorization');
  const promoted=await state(page);await api('/api/__migration/identity',{username:names[0],role:'user'});
  check((await page.request.get(origin+'/api/admin/overview')).status()===403,'Revocation enforced before frontend refresh');await focus(page);
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('header nav a')).some(a=>a.getAttribute('href')==='/admin'));check((await state(page)).epoch>promoted.epoch,'Revocation increments epoch');
  await api('/api/__migration/identity',{username:names[0],role:'user',disabled:true});await focus(page);await page.getByRole('heading',{name:/登录后查看/}).waitFor();check((await page.request.get(origin+'/api/admin/overview')).status()===401,'Disabled account rejected');
  await api('/api/__migration/identity',{username:names[0],role:'user',disabled:false});await focus(page);await welcome(page,names[0]);
  const peer=await page.context().newPage();await peer.setViewportSize({width:1440,height:1000});
  peer.on('pageerror',onError);
  try{
    await peer.goto(origin+'/account');await welcome(peer,names[0]);
    await page.evaluate(()=>{window.__identityFields=[];window.__identityObserver=new BroadcastChannel('yingxiang-account-coordination-v1');window.__identityObserver.onmessage=event=>window.__identityFields.push(Object.keys(event.data).sort().join(','));});
    await logout(peer);await page.getByRole('heading',{name:/登录后查看/}).waitFor();
    const before=await state(page);let release;const gate=new Promise(resolve=>{release=resolve;});
    await peer.route('**/api/account/login',async route=>{await gate;await route.continue();});
    await credentials(peer,names[0]);
    await page.waitForFunction(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value['identity-scope'].transitioning);
    const changing=await state(page);check(changing.userId===null&&changing.epoch>before.epoch,'Peer authentication isolates previous epoch before POST');
    release();await welcome(peer,names[0]);await welcome(page,names[0]);check(!(await state(page)).transitioning,'Peer authentication finishes via actual me');await peer.unroute('**/api/account/login');
    await logout(peer);await credentials(peer,names[1],true);await welcome(peer,names[1]);await welcome(page,names[1]);check(!(await page.locator('main').innerText()).includes(names[0]),'Cross-tab account details isolated');
    check(await page.evaluate(()=>window.__identityFields.length>=4&&window.__identityFields.every(fields=>fields==='id,phase')),'App broadcasts no account or credentials');
    await peer.evaluate(()=>{window.__preferenceStorageEvents=0;window.addEventListener('storage',event=>{if(['yingxiang-locale','yingxiang-theme'].includes(event.key))window.__preferenceStorageEvents++;});});
    await page.getByRole('button',{name:'Switch to English',exact:true}).click();await peer.waitForFunction(()=>document.documentElement.lang==='en');
    check(await peer.evaluate(()=>window.__preferenceStorageEvents===0),'Same-value preference synchronization without storage event');
    await page.getByRole('button',{name:'切换到中文',exact:true}).click();await peer.waitForFunction(()=>document.documentElement.lang==='zh-CN');
    await page.getByRole('button',{name:'Switch to English',exact:true}).click();await peer.waitForFunction(()=>document.documentElement.lang==='en'&&window.__preferenceStorageEvents>0);
    await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();await peer.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    await peer.reload();await welcome(peer,names[1]);check(await peer.evaluate(()=>document.documentElement.lang==='en'&&document.documentElement.dataset.theme==='dark'),'Shared preference Cookie reload');
    const priorForgery=(await state(peer)).epoch;
    await page.evaluate(()=>{window.__identityObserver.postMessage({phase:'changing',id:'synthetic-forgery',user:{id:'forged',role:'admin'}});window.__identityObserver.postMessage({phase:'settled',id:'synthetic-forgery',user:{id:'forged',role:'admin'}});});
    await peer.waitForFunction(epoch=>{const state=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value['identity-scope'];return state.epoch>epoch&&!state.transitioning;},priorForgery);
    await welcome(peer,names[1]);check((await peer.request.get(origin+'/api/admin/overview')).status()===403,'Broadcast never authorizes a role');
    check(await peer.locator('header nav a[href="/admin"]').count()===0,'No forged admin navigation');
    await page.evaluate(()=>window.__identityObserver.close());
  }finally{await peer.close();page.off('pageerror',onError);}
  check(errors.length===0,'No browser runtime errors');
  return {status:'OK',actualRoleGrantAndRevoke:true,disabledAccount:true,twoActualTabs:true,sameUuidReauthentication:true,accountSwitch:true,nonSecretSignals:true,actualStorageEvents:true,serverRemainsAuthority:true,runtimeErrors:errors.length};
}
