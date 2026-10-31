async (page) => {
  const origin=new URL(page.url()).origin;
  if(origin!=='http://127.0.0.1:8787')throw new Error('Use the switched 8787 entry');
  const check=(value,message)=>{if(!value)throw new Error(message);};
  const errors=[];page.on('pageerror',error=>errors.push(error.name));
  await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.context().addCookies([{name:'yingxiang-locale',value:'zh',url:origin},{name:'yingxiang-theme',value:'light',url:origin}]);
  const publicPages=[['/','映想 — 让想象，在眼前发生。','让想象，'],['/pricing','价格方案 · 映想','充值与积分'],['/help','帮助中心 · 映想','使用指南与常见问题'],['/help/feedback','问题反馈 · 映想','整理问题反馈'],['/privacy','隐私与使用说明 · 映想','隐私与使用说明'],['/terms','用户协议 · 映想','用户协议']];
  const privatePages=[['/account','个人中心 · 映想','登录后查看'],['/account/usage','使用记录 · 映想','登录后查看'],['/account/orders','我的订单 · 映想','登录后查看'],['/account/security','账号信息 · 映想','登录后查看'],['/admin','管理后台 · 映想','这里需要管理员权限'],['/studio','创作空间 · 映想',''],['/studio/video','视频换装 · 映想',''],['/studio/edit','实时编辑 · 映想',''],['/works','我的作品 · 映想','登录后查看作品']];
  const layout=async(path,title,marker)=>{
    const response=await page.goto(origin+path);check(response.status()===200,path+' status');
    await page.locator('main').first().waitFor();
    check(await page.title()===title,path+' title '+await page.title());
    check(await page.getByRole('navigation',{name:'主导航',exact:true}).count()===1,path+' single site nav');
    check(await page.locator('main').count()===1,path+' single main');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path+' desktop overflow');
    if(marker)check(await page.locator('main').innerText().then(text=>text.includes(marker)),path+' gate text');
  };
  for(const [path,title,marker] of publicPages){
    await layout(path,title,marker);
    check(await page.locator('meta[name="robots"]').getAttribute('content')==='index, follow',path+' robots');
    check(await page.locator('meta[property="og:title"]').getAttribute('content')===title,path+' og:title');
  }
  for(const [path,title,marker] of privatePages){
    await layout(path,title,marker);
    check(await page.locator('meta[name="robots"]').getAttribute('content')==='noindex, nofollow',path+' noindex');
    check(await page.locator('header nav a').count()>0,path+' navigation');
  }
  const missing=await page.goto(origin+'/synthetic-not-a-page');
  check(missing.status()===404,'Unknown path HTTP404');
  await page.locator('main h1').waitFor();
  check((await page.locator('main h1').innerText()).includes('页面不存在'),'404 page copy');
  check(await page.locator('meta[name="robots"]').getAttribute('content')==='noindex, nofollow','404 noindex');
  // 语言与主题在真实入口刷新后保持（Cookie写回127.0.0.1）。
  await page.goto(origin+'/pricing');
  await page.getByRole('button',{name:'Switch to English',exact:true}).click();
  await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
  await page.reload();
  check(await page.evaluate(()=>document.documentElement.lang==='en'&&document.documentElement.dataset.theme==='dark'),'Preference cookies persist');
  check(await page.title()==='价格方案 · Yingxiang','English client title');
  await page.screenshot({path:'output/playwright/m09d-entry-pricing-en-dark.png',fullPage:true});
  await page.getByRole('button',{name:'切换到中文',exact:true}).click();
  await page.getByRole('button',{name:'切换日间模式',exact:true}).click();
  await page.screenshot({path:'output/playwright/m09d-entry-pricing.png',fullPage:true});
  // SPA前进后退与登录弹窗可用，不提交任何账号请求。
  await page.goto(origin+'/');
  await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('link',{name:'价格方案',exact:true}).click();
  await page.waitForURL('**/pricing');
  await page.goBack();check(new URL(page.url()).pathname==='/','SPA back');
  await page.goForward();check(new URL(page.url()).pathname==='/pricing','SPA forward');
  await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button',{name:'关闭账号',exact:true}).click();
  check(await page.getByRole('dialog').count()===0,'Login dialog closes');
  // 无JavaScript时六页正文仍可见（HTTP已逐页核对，这里核对桌面渲染与溢出）。
  const browser=page.context().browser();
  let noJsPages=0;
  if(browser){
    const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:1440,height:1000}});
    try{
      const plain=await context.newPage();
      for(const [path,title,marker] of publicPages){
        const response=await plain.goto(origin+path);check(response.status()===200,path+' no-js status');
        check(await plain.title()===title,path+' no-js title');
        check((await plain.locator('body').innerText()).includes(marker),path+' no-js body');
        check(await plain.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path+' no-js overflow');
        noJsPages++;
      }
      await plain.goto(origin+'/pricing');
      await plain.screenshot({path:'output/playwright/m09d-entry-nojs-pricing.png',fullPage:true});
    }finally{await context.close();}
  }
  await page.goto(origin+'/admin');
  await page.screenshot({path:'output/playwright/m09d-entry-admin-gate.png',fullPage:true});
  const result={status:'OK',origin,publicPages:publicPages.length,privateRoutes:privatePages.length,noJsPages,pageErrors:errors};
  await page.evaluate(value=>{window.__entryCheck=value;},result);
  return result;
}
