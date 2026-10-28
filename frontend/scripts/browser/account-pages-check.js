async(page)=>{
  const origin='http://127.0.0.1:8791',check=(value,message)=>{if(!value)throw new Error(message);};
  check(new URL(page.url()).origin===origin,'Isolated preview required');await page.unrouteAll({behavior:'wait'});
  await page.context().addCookies([{name:'yingxiang-locale',value:'zh',url:origin},{name:'yingxiang-theme',value:'light',url:origin}]);
  await page.request.post(origin+'/api/account/logout',{headers:{Origin:origin}});
  await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.name));
  for(const path of ['/account','/account/usage','/account/security']){await page.goto(origin+path);await page.getByRole('heading',{name:/登录后查看/}).waitFor();}
  await page.goto(origin+'/admin');await page.getByRole('heading',{name:'这里需要管理员权限',exact:true}).waitFor();check(await page.locator('main').getByRole('button',{name:'登录账号',exact:true}).count()===1,'Anonymous admin login');
  const names=['alpha_page_','beta_page_'].map(prefix=>prefix+Date.now().toString(36)),password='Synthetic-Only-123';
  async function register(name){await page.locator('main').getByRole('button',{name:/登录账号/}).click();const dialog=page.locator('dialog[open]');await dialog.getByRole('button',{name:'创建账号',exact:true}).click();await dialog.getByRole('textbox',{name:/^账号/}).fill(name);await dialog.getByLabel(/^密码/).fill(password);await dialog.getByRole('checkbox').check();await dialog.locator('form button[type=submit]').click();await page.getByRole('button',{name:'账号菜单',exact:true}).waitFor();}
  await page.goto(origin+'/account');await page.getByRole('heading',{name:/登录后查看/}).waitFor();await register(names[0]);
  await page.getByRole('heading',{name:new RegExp(names[0])}).waitFor();
  const actual=await (await page.request.get(origin+'/api/account/me')).json();check(actual.trialRemaining===1,'Actual account benefits');
  await page.getByRole('navigation',{name:'个人中心导航',exact:true}).getByRole('link',{name:'使用记录',exact:true}).click();await page.getByRole('heading',{name:'暂无使用记录',exact:true}).waitFor();
  await page.getByRole('navigation',{name:'个人中心导航',exact:true}).getByRole('link',{name:'账号信息',exact:true}).click();await page.locator('main dd').getByText(names[0],{exact:true}).waitFor();
  check((await page.locator('main').innerText()).includes('暂不支持找回，请妥善保存密码。'),'Existing account settings boundary');
  await page.goto(origin+'/admin');await page.getByRole('heading',{name:'这里需要管理员权限',exact:true}).waitFor();check(await page.locator('main').getByRole('button',{name:'登录账号',exact:true}).count()===0,'User denied without redundant login');
  // 历史和异常显示分支为明确DTO替身，不创建生成会话或改动真实账本。
  let mode='normal',value={...actual,trial:'review',trialRemaining:0,history:[
    {id:'synthetic-review',createdAt:'2026-10-28T00:00:00.000Z',durationSec:15,state:'review'},
    {id:'synthetic-ended',createdAt:'2026-10-28T00:00:00.000Z',durationSec:30,state:'used',outcome:'ended'},
    {id:'synthetic-error',createdAt:'2026-10-28T00:00:00.000Z',durationSec:60,state:'used',outcome:'error'},
    {id:'synthetic-issued',createdAt:'2026-10-28T00:00:00.000Z',durationSec:15,state:'used'},
  ],durations:[{seconds:15,limit:1,remaining:0},{seconds:30,limit:2,remaining:2},{seconds:60,limit:1,remaining:1}]};
  await page.route('**/api/account/me',route=>route.fulfill(mode==='failure'?{status:503,json:{error:{code:'SERVICE_UNAVAILABLE'}}}:{json:value}));
  await page.goto(origin+'/account/usage');await page.getByRole('table').waitFor();
  check(await page.locator('tbody tr').count()===4,'Four history states');
  for(const state of ['待核查','已结束','连接异常','已申请连接'])check((await page.locator('main').innerText()).includes(state),'History state '+state);
  check((await page.locator('main time').first().innerText()).includes('08:00'),'Shanghai display time');
  await page.getByRole('navigation',{name:'个人中心导航',exact:true}).getByRole('link',{name:'权益概览',exact:true}).click();check((await page.locator('main').innerText()).includes('上次连接状态待核查'),'Review benefit state');
  await page.screenshot({path:'output/playwright/account-overview-review.png'});
  value={...value,trial:'used'};await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('免费体验已使用，可查看使用记录或了解积分方案。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Switch to English',exact:true}).click();await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
  check(await page.evaluate(()=>!/[\u3400-\u9fff]/.test(document.querySelector('main').innerText)),'English account content');
  await page.screenshot({path:'output/playwright/account-overview-en-dark.png'});
  const prefs=await page.evaluate(()=>{const state=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value;return {keys:Object.keys(state.preferences).sort(),locale:state.preferences.locale,theme:state.preferences.theme};});
  check(JSON.stringify(prefs.keys)===JSON.stringify(['locale','theme'])&&prefs.locale==='en'&&prefs.theme==='dark','Pinia only locale/theme preference state');
  await page.getByRole('button',{name:'切换到中文',exact:true}).click();await page.getByRole('button',{name:'切换日间模式',exact:true}).click();
  mode='failure';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('heading',{name:'账号信息读取失败。',exact:true}).waitFor();
  await page.unroute('**/api/account/me');await page.locator('main').getByRole('button',{name:'重新读取',exact:true}).click();await page.getByRole('heading',{name:new RegExp(names[0])}).waitFor();
  await page.getByRole('navigation',{name:'个人中心导航',exact:true}).getByRole('link',{name:'账号信息',exact:true}).click();await page.locator('main').getByRole('button',{name:'退出登录',exact:true}).click();await page.getByRole('heading',{name:/登录后查看/}).waitFor();
  await register(names[1]);await page.locator('main dd').getByText(names[1],{exact:true}).waitFor();check(!(await page.locator('main').innerText()).includes(names[0]),'No prior account detail after switch');
  for(const path of ['/account','/account/usage','/account/security']){await page.goto(origin+path);await page.getByRole('heading',{name:'个人中心',exact:true}).waitFor();check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Desktop overflow');}
  check(errors.length===0,'Browser runtime errors');
  return {status:'OK',actualAccountPages:3,anonymousGate:true,ordinaryAdminDenied:true,historyDtoSynthetic:true,errorRecovery:true,accountSwitch:true,preferencesInPinia:true,desktop:true,runtimeErrors:errors.length};
}
