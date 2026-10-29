async(page)=>{
  const origin='http://127.0.0.1:8791',check=(value,message)=>{if(!value)throw new Error(message);};
  check(new URL(page.url()).origin===origin,'Isolated preview required');await page.unrouteAll({behavior:'wait'});
  await page.context().addCookies([{name:'yingxiang-locale',value:'zh',url:origin},{name:'yingxiang-theme',value:'light',url:origin}]);
  await page.request.post(origin+'/api/account/logout',{headers:{Origin:origin}});
  await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[],checkoutPosts=[],external=[],stripeHits=[];
  page.on('pageerror',error=>errors.push(error.name));
  page.on('request',request=>{const url=request.url();
    if(url.includes('/api/payments/checkout'))checkoutPosts.push(url);
    if(!url.startsWith(origin)&&!url.startsWith('https://checkout.stripe.com/'))external.push(url);});
  // 官方收银台为明确替身页面：只记录跳转，不联网、不付款。
  await page.route('https://checkout.stripe.com/**',route=>{stripeHits.push(route.request().url());
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Stripe sandbox double</title></head><body><p id="double">Synthetic Stripe sandbox double — no real payment.</p></body></html>'});});
  const dialog=()=>page.locator('dialog[open]');
  const name='scope_pay_'+Date.now().toString(36),password='Synthetic-Only-123';
  async function register(){
    await page.locator('main').getByRole('button',{name:/登录账号/}).click();
    const modal=dialog();await modal.getByRole('button',{name:'创建账号',exact:true}).click();
    await modal.getByRole('textbox',{name:/^账号/}).fill(name);await modal.getByLabel(/^密码/).fill(password);
    await modal.getByRole('checkbox').check();await modal.locator('form button[type=submit]').click();
    await page.getByRole('button',{name:'账号菜单',exact:true}).waitFor();
  }
  async function choosePlan(label){await page.getByRole('button',{name:label,exact:true}).click();await dialog().getByRole('button',{name:/取消|确认并前往支付/}).first().waitFor();}
  async function orders(){return (await page.request.get(origin+'/api/payments/orders')).json();}
  async function waitTitle(expected){await page.waitForFunction(value=>document.title===value,expected,{timeout:10000});}

  // 1. 匿名：价格确认只打开登录，不创建订单；订单页与后台门禁。
  await page.goto(origin+'/pricing');await page.getByRole('heading',{name:'套餐与积分',exact:true}).waitFor();
  await choosePlan('选择创作包');await dialog().getByRole('button',{name:'登录后继续',exact:true}).click();
  await dialog().getByRole('heading',{name:'登录账号',exact:true}).waitFor();
  check(checkoutPosts.length===0,'Anonymous checkout must not post');
  await page.keyboard.press('Escape');
  await page.goto(origin+'/account/orders');await page.getByRole('heading',{name:/登录后查看/}).waitFor();
  await page.goto(origin+'/admin');await page.getByRole('heading',{name:'这里需要管理员权限',exact:true}).waitFor();
  check(await page.locator('main').getByRole('button',{name:'登录账号',exact:true}).count()===1,'Anonymous admin login');

  // 2. 注册合成账号；普通用户进入后台仍被拒绝且无重复登录按钮。
  await page.goto(origin+'/account');await page.getByRole('heading',{name:/登录后查看/}).waitFor();await register();
  await page.goto(origin+'/admin');await page.getByRole('heading',{name:'这里需要管理员权限',exact:true}).waitFor();
  check(await page.locator('main').getByRole('button',{name:'登录账号',exact:true}).count()===0,'Ordinary admin denied without redundant login');

  // 3. 价格确认取消不建单；网络未知不自动重试且复用同一操作编号。
  await page.goto(origin+'/pricing');await choosePlan('选择创作包');
  check((await dialog().innerText()).includes(name)&&(await dialog().innerText()).includes('¥129.00'),'Confirmation shows account and server price');
  await dialog().getByRole('button',{name:'取消',exact:true}).click();await dialog().waitFor({state:'detached'});
  check((await orders()).orders.length===0,'Cancel creates no order');
  let dropResponse=true;
  await page.route('**/api/payments/checkout',async route=>{if(!dropResponse)return route.continue();await route.fetch();await route.abort('failed');});
  await choosePlan('选择创作包');await dialog().getByRole('button',{name:'确认并前往支付',exact:true}).click();
  await dialog().locator('p[role=alert]').waitFor();
  check((await dialog().innerText()).includes('支付准备未完成，请到订单中核查。'),'Unknown checkout message');
  const unknown=(await orders()).orders;check(unknown.length===1&&unknown[0].state==='pending','Unknown result keeps exactly one pending order');
  dropResponse=false;await page.unroute('**/api/payments/checkout');
  await dialog().getByRole('button',{name:'确认并前往支付',exact:true}).click();
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//,{timeout:10000});
  check(stripeHits.length===1,'Single sandbox checkout navigation');
  check((await page.locator('#double').innerText()).includes('no real payment'),'Stripe double page');
  check((await orders()).orders.length===1,'Retry does not create a second order');
  const firstOrder=(await orders()).orders[0].id;

  // 4. 返回页按订单编号查单；查单失败保留列表；替身确认付款后显示已付款与测试积分。
  await page.goto(origin+'/account/orders?payment=returned&orderId='+firstOrder);
  await page.getByRole('table').waitFor();
  check((await page.locator('tbody').innerText()).includes('等待付款确认'),'Return page keeps pending');
  check((await page.locator('tbody').innerText()).includes(firstOrder),'Own order visible');
  await page.route('**/api/payments/reconcile',route=>route.fulfill({status:503,json:{error:{code:'SERVICE_UNAVAILABLE',message:'订单核查暂不可用，请稍后重试。'}}}));
  await page.getByRole('button',{name:'查单',exact:true}).first().click();
  await page.locator('main p[role=alert]').waitFor();
  check((await page.locator('main p[role=alert]').innerText()).includes('订单核查暂不可用，请稍后重试。'),'Reconcile failure message');
  check((await page.locator('tbody').innerText()).includes('等待付款确认'),'Reconcile failure keeps list');
  await page.unroute('**/api/payments/reconcile');
  const settle=await page.request.post(origin+'/api/__migration/sandbox-payment',{headers:{Origin:origin},data:{orderId:firstOrder,status:'paid'}});
  check(settle.ok(),'Synthetic sandbox payment control');
  await page.getByRole('button',{name:'查单',exact:true}).first().click();
  await page.getByText('测试付款已确认',{exact:true}).waitFor();
  const main=await page.locator('main').innerText();
  check(main.includes('测试积分：450')&&main.includes('创作包 · 450 积分 · 实时换装 / 视频换装 / 实时编辑'),'Sandbox credits and scenes');
  check((await (await page.request.get(origin+'/api/payments/orders')).json()).orders[0].state==='paid','Real sandbox order paid state');
  // 第二单只由用户显式点击“继续测试付款”才回到收银台。
  await page.goto(origin+'/pricing');await choosePlan('选择轻享包');
  await dialog().getByRole('button',{name:'确认并前往支付',exact:true}).click();
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//,{timeout:10000});
  check(stripeHits.length===2,'Second sandbox checkout navigation');
  await page.goto(origin+'/account/orders');await page.getByRole('table').waitFor();
  const pendingRow=page.locator('tbody tr').filter({hasText:'轻享包'});
  await pendingRow.getByRole('button',{name:'继续测试付款',exact:true}).click();
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//,{timeout:10000});
  check(stripeHits.length===3,'Resume only on explicit click');
  await page.goto(origin+'/account/orders');await page.getByRole('table').waitFor();
  check(await page.locator('tbody tr').count()===2,'Two sandbox orders');

  // 5. 全部旧路由与404在Vue入口可用。
  const routes=[['/','映想 — 让想象，在眼前发生。'],['/pricing','价格方案 · 映想'],['/help','帮助中心 · 映想'],['/help/feedback','问题反馈 · 映想'],['/privacy','隐私与使用说明 · 映想'],['/terms','用户协议 · 映想'],['/account','个人中心 · 映想'],['/account/usage','使用记录 · 映想'],['/account/orders','我的订单 · 映想'],['/account/security','账号信息 · 映想'],['/admin','管理后台 · 映想'],['/studio','创作空间 · 映想'],['/studio/video','视频换装 · 映想'],['/studio/edit','实时编辑 · 映想'],['/works','我的作品 · 映想'],['/not-a-real-page','页面不存在 · 映想']];
  for(const [path,title] of routes){
    await page.goto(origin+path);await waitTitle(title);
    check(await page.locator('main').count()===1,path+' renders one main');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path+' desktop overflow');
  }
  await page.goto(origin+'/not-a-real-page');await page.getByRole('heading',{name:'页面不存在',exact:true}).waitFor();
  await page.locator('main').getByRole('link',{name:/用户协议/}).waitFor();
  await page.goto(origin+'/studio/video');await page.getByText('生成视频与服装参考图自动保存',{exact:true}).first().waitFor();

  // 6. 管理控制台：真实管理员授权后总览、用户权益写入与确认。
  const promote=await page.request.post(origin+'/api/__migration/identity',{headers:{Origin:origin},data:{username:name,role:'admin',disabled:false}});
  check(promote.ok(),'Synthetic admin promotion');
  await page.goto(origin+'/admin');await page.getByRole('heading',{name:'管理后台',exact:true}).waitFor();
  await page.getByRole('heading',{name:'服务运行边界',exact:true}).waitFor();
  const overview=await page.locator('main').innerText();
  check(overview.includes('注册用户')&&overview.includes('服务运行边界')&&overview.includes('Stripe 沙盒：已开放')&&overview.includes('正式支付未开放'),'Overview statistics and boundaries');
  await page.getByRole('button',{name:'用户与权益',exact:true}).click();
  const userRow=page.locator('tbody tr').filter({hasText:name});await userRow.waitFor();
  await userRow.getByRole('button',{name:'管理',exact:true}).click();
  const editor=page.locator('section[aria-label^="管理账号"]');await editor.waitFor();
  const quotaForm=editor.locator('form').nth(1);
  await quotaForm.getByLabel(/时长/).selectOption('30');await quotaForm.getByLabel(/增减次数/).fill('2');await quotaForm.getByLabel(/操作原因/).fill('合成权益调整回归');
  await quotaForm.getByRole('button',{name:'核对权益调整',exact:true}).click();
  check((await dialog().innerText()).includes('+2')&&(await dialog().innerText()).includes('合成权益调整回归'),'Quota confirmation summary');
  await dialog().getByRole('button',{name:'确认保存',exact:true}).click();
  await page.getByText('管理修改已保存并记录操作日志。',{exact:true}).waitFor();
  const me=await (await page.request.get(origin+'/api/account/me')).json();
  check(me.durations.find(item=>item.seconds===30).remaining===2,'Real quota write');

  // 7. 服务暂停：版本冲突保留确认，真实保存后创作入口状态随管理开关变化。
  await page.getByRole('button',{name:'服务与内容',exact:true}).click();
  await page.getByRole('heading',{name:'暂停新生成',exact:true}).waitFor();
  const servicesForm=page.locator('section').filter({hasText:'暂停新生成'}).locator('form').first();
  await servicesForm.getByLabel('实时换装',{exact:true}).check();await servicesForm.getByLabel('视频换装',{exact:true}).check();
  await servicesForm.getByLabel(/操作原因/).fill('合成维护暂停');
  await servicesForm.getByRole('button',{name:'核对服务修改',exact:true}).click();
  await page.route('**/api/admin/settings/services',route=>route.fulfill({status:409,json:{error:{code:'SETTINGS_CONFLICT',message:'设置已被更新，请刷新后重新确认。'}}}));
  await dialog().getByRole('button',{name:'确认保存',exact:true}).click();
  await dialog().locator('div[role=alert]').waitFor();
  check((await dialog().innerText()).includes('设置已被更新，请刷新后重新确认。'),'Version conflict shown in confirmation');
  const stale=await (await page.request.get(origin+'/api/admin/settings')).json();
  check(stale.services.version===0&&stale.services.studio===false,'Conflict writes nothing');
  await page.unroute('**/api/admin/settings/services');
  await dialog().getByRole('button',{name:'确认保存',exact:true}).click();
  await dialog().waitFor({state:'detached'});
  const saved=await (await page.request.get(origin+'/api/admin/settings')).json();
  check(saved.services.version===1&&saved.services.studio===true&&saved.services.video===true,'Real pause persisted');
  const status=await (await page.request.get(origin+'/api/admin/overview')).json();
  check(status.services.filter(item=>item.scene!=='prompt').every(item=>item.paused),'Overview shows admin pause');
  await page.goto(origin+'/studio/video');await page.getByText('视频生成待开放，可先预览素材。',{exact:true}).first().waitFor();

  // 8. 公告写入后全站显示并可关闭；审计记录原因与变化。
  await page.goto(origin+'/admin');await page.getByRole('button',{name:'服务与内容',exact:true}).click();
  await page.getByRole('heading',{name:'站点公告',exact:true}).waitFor();
  const noticeForm=page.locator('section').filter({hasText:'站点公告'}).locator('form').first();
  await noticeForm.getByLabel('展示公告',{exact:true}).check();
  await noticeForm.getByLabel('中文正文').fill('合成维护公告：管理写入验证。');
  await noticeForm.getByLabel('英文正文').fill('Synthetic maintenance notice: admin write verified.');
  await noticeForm.getByLabel(/操作原因/).fill('合成公告发布');
  await noticeForm.getByRole('button',{name:'核对公告修改',exact:true}).click();
  await dialog().getByRole('button',{name:'确认保存',exact:true}).click();
  await dialog().waitFor({state:'detached'});
  const announcement=await (await page.request.get(origin+'/api/site/announcement')).json();
  check(announcement.enabled&&announcement.zh==='合成维护公告：管理写入验证。','Real announcement persisted');
  await page.goto(origin+'/pricing');await page.getByText('合成维护公告：管理写入验证。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'关闭公告',exact:true}).click();
  check(await page.getByText('合成维护公告：管理写入验证。',{exact:true}).count()===0,'Announcement dismissible');
  await page.goto(origin+'/admin');await page.getByRole('button',{name:'操作日志',exact:true}).click();
  await page.getByRole('heading',{name:'管理操作日志',exact:true}).waitFor();
  await page.locator('main tbody tr').first().waitFor();
  const audit=await page.locator('main').innerText();
  check(audit.includes('quota.adjust')&&audit.includes('services.update')&&audit.includes('announcement.update'),'Audit actions recorded');
  check(audit.includes('合成权益调整回归')&&audit.includes('合成维护暂停')&&audit.includes('合成公告发布'),'Audit reasons recorded');
  await page.locator('details summary').first().click();
  check((await page.locator('pre').first().innerText()).includes('"after"'),'Audit before/after changes');

  // 9. 即时鉴权：撤权后写入返回403，控制台立即隐藏管理数据。
  await page.getByRole('button',{name:'服务与内容',exact:true}).click();
  await page.getByRole('heading',{name:'站点公告',exact:true}).waitFor();
  // 冻结本人账号读取，避免十秒轮询在写入前把控制台替换成门禁；写入本身仍是真实请求。
  const adminMe=await (await page.request.get(origin+'/api/account/me')).json();
  await page.route('**/api/account/me',route=>route.fulfill({json:adminMe}));
  const revoke=await page.request.post(origin+'/api/__migration/identity',{headers:{Origin:origin},data:{username:name,role:'user',disabled:false}});
  check(revoke.ok(),'Synthetic demotion');
  await noticeForm.getByLabel('中文正文').fill('合成撤权后的写入。');
  await noticeForm.getByLabel(/操作原因/).fill('合成撤权写入');
  await noticeForm.getByRole('button',{name:'核对公告修改',exact:true}).click();
  await dialog().getByRole('button',{name:'确认保存',exact:true}).click();
  await page.getByRole('heading',{name:'管理权限已失效',exact:true}).waitFor();
  check(await page.getByRole('button',{name:'用户与权益',exact:true}).count()===0,'Admin data hidden after 403');
  await page.unroute('**/api/account/me');
  check((await (await page.request.get(origin+'/api/site/announcement')).json()).zh==='合成维护公告：管理写入验证。','Denied write did not change announcement');

  check(checkoutPosts.length===3,'Exactly three checkout posts (unknown retry, two purchases)');
  check(external.length===0,'No non-loopback requests besides the Stripe double');
  check(errors.length===0,'Browser runtime errors');
  return {status:'OK',sandboxOrders:2,checkoutPosts:3,unknownReuse:true,reconcileFailure:true,sandboxPaid:true,resumeExplicit:true,routes:routes.length,notFound:true,adminGate:true,quotaWrite:true,versionConflict:true,pauseAffectsEntry:true,announcement:true,audit:true,immediateAuthorization:true,stripeDoubleHits:stripeHits.length,runtimeErrors:errors.length,desktop:true};
}
