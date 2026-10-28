async (page) => {
  const origin=new URL(page.url()).origin;
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw new Error('Use isolated local entry');
  const check=(value,message)=>{if(!value)throw new Error(message);};
  const errors=[];page.on('pageerror',error=>errors.push(error.name));
  await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.context().addCookies([{name:'yingxiang-locale',value:'zh',url:origin},{name:'yingxiang-theme',value:'light',url:origin}]);
  const expectedNav=['/','/studio','/works','/pricing','/help'];
  const expectedFooter=['/pricing','/studio','/account','/help','/help/feedback','/privacy','/terms'];
  for(const path of ['/','/pricing','/help','/help/feedback','/privacy','/terms']) {
    const response=await page.goto(origin+path);check(response.status()===200,'Public deep link status');
    await page.locator('main h1').waitFor();
    check(JSON.stringify(await page.getByRole('navigation',{name:'主导航',exact:true}).locator('a').evaluateAll(links=>links.map(link=>link.getAttribute('href'))))===JSON.stringify(expectedNav),'Original main navigation');
    check(JSON.stringify(await page.getByRole('navigation',{name:'页脚导航',exact:true}).locator('a').evaluateAll(links=>links.map(link=>link.getAttribute('href'))))===JSON.stringify(expectedFooter),'Original footer navigation');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Desktop overflow');
  }
  await page.goto(origin+'/help/feedback');
  check(await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('link',{name:'帮助中心',exact:true}).getAttribute('aria-current')==='page','Nested active navigation');
  await page.getByRole('button',{name:'Switch to English',exact:true}).click();
  await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
  check(await page.getByRole('button',{name:'Switch to light mode',exact:true}).getAttribute('aria-pressed')==='true','Theme accessibility');
  await page.reload();
  check(await page.evaluate(()=>document.documentElement.lang==='en'&&document.documentElement.dataset.theme==='dark'),'Cookie preference reload');
  await page.getByRole('navigation',{name:'Footer navigation',exact:true}).getByRole('link',{name:'Privacy & usage',exact:true}).click();
  await page.waitForURL('**/privacy');
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:'output/playwright/public-shell-en-dark.png',fullPage:true});
  check(await page.evaluate(()=>!/[\u3400-\u9fff]/.test([...document.querySelectorAll('header a, footer')].map(node=>node.innerText).join(''))),'English shell text');
  await page.goBack();check(new URL(page.url()).pathname==='/help/feedback','SPA back');
  await page.goForward();check(new URL(page.url()).pathname==='/privacy','SPA forward');
  const missing=await page.goto(origin+'/synthetic-not-a-page');check(missing.status()===404,'Unknown real HTTP404');
  await page.getByRole('heading',{level:1}).waitFor();
  await page.getByRole('button',{name:'切换到中文',exact:true}).click();
  await page.getByRole('button',{name:'切换日间模式',exact:true}).click();

  // 下面公告内容和响应顺序为明确替身；入口HTTP合同由独立Nginx工具验证。
  let reads=0,mode='normal',version=3;
  await page.route('**/api/site/announcement',async route=>{
    reads++;const current=version,currentMode=mode;
    if(currentMode==='slow')await new Promise(resolve=>setTimeout(resolve,250));
    if(currentMode==='failure'){await route.fulfill({status:503,json:{}});return;}
    await route.fulfill({json:currentMode==='malformed'?{enabled:true,version:'bad'}:{enabled:true,version:current,zh:`公告${current} <img src=x onerror=alert(1)>`,en:`Announcement ${current}`}});
  });
  await page.goto(origin+'/help');
  const announcement=page.locator('header [role=status]');
  await announcement.filter({hasText:'公告3'}).waitFor();
  check(await announcement.locator('img').count()===0,'Announcement is plain text');
  await page.getByRole('button',{name:'关闭公告',exact:true}).click();
  const focus=()=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  const waitRead=async()=>{const before=reads;await focus();await page.waitForFunction(()=>true);for(let i=0;i<50&&reads===before;i++)await page.waitForTimeout(20);check(reads===before+1,'Single announcement focus reader');await page.waitForTimeout(50);};
  await waitRead();check(await announcement.count()===0,'Dismissed version remains hidden');
  version=4;await focus();await announcement.filter({hasText:'公告4'}).waitFor();
  version=2;await waitRead();check((await announcement.innerText()).includes('公告4'),'Old version ignored');
  mode='failure';await waitRead();check((await announcement.innerText()).includes('公告4'),'Failure retains announcement');
  mode='malformed';await waitRead();check((await announcement.innerText()).includes('公告4'),'Malformed ignored');
  mode='slow';version=5;await focus();await page.waitForTimeout(40);
  mode='normal';version=6;await focus();await announcement.filter({hasText:'公告6'}).waitFor();await page.waitForTimeout(300);
  check((await announcement.innerText()).includes('公告6'),'Late older response ignored');
  await page.getByRole('button',{name:'Switch to English',exact:true}).click();await announcement.filter({hasText:'Announcement 6'}).waitFor();
  await page.getByRole('button',{name:'切换到中文',exact:true}).click();
  await page.getByRole('button',{name:'关闭公告',exact:true}).click();
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:'output/playwright/public-shell-zh-light.png',fullPage:true});
  const before=reads;
  await page.evaluate(()=>document.querySelector('#app').__vue_app__.unmount());
  await focus();await page.waitForTimeout(100);check(reads===before,'Unmount removes focus reader');
  check(errors.length===0,'Browser runtime errors');
  return {status:'OK',realNginxPublicRoutes:6,unknownHttp404:true,originalNavigation:true,preferences:true,history:true,announcementSynthetic:true,announcementUnmount:true,runtimeErrors:errors.length};
}
