async (page) => {
  const origin='http://127.0.0.1:8787',checks=[],writes=[],routes=[];
  const check=(value,message)=>{if(!value)throw new Error(message);checks.push(message);};
  page.on('request',request=>{if(request.method()==='POST')writes.push(new URL(request.url()).pathname);});
  const button=()=>page.getByRole('button',{name:'回到顶部',exact:true});
  const synchronize=()=>page.waitForFunction(()=>Boolean(document.querySelector('.back-to-top'))===(document.scrollingElement.scrollHeight>document.documentElement.clientHeight+1&&window.scrollY>160));
  await page.context().addCookies([{name:'yingxiang-locale',value:'zh',url:origin},{name:'yingxiang-theme',value:'light',url:origin}]);
  await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'reduce'});
  for(const path of ['/','/wardrobe','/pricing','/help','/help/feedback','/privacy','/terms','/studio','/studio/video','/studio/edit','/works','/account','/account/usage','/account/orders','/account/security','/admin']){
    await page.goto(origin+path);await page.locator('main').first().waitFor();await page.evaluate(()=>document.fonts.ready);await synchronize();
    check(await button().count()===0,`${path}顶部默认隐藏`);
    const room=await page.evaluate(()=>document.scrollingElement.scrollHeight-innerHeight);
    if(room>160){
      await page.evaluate(()=>window.scrollTo({top:100,behavior:'instant'}));await synchronize();
      check(await button().count()===0,`${path}轻微滚动仍隐藏`);
      await page.evaluate(()=>window.scrollTo({top:500,behavior:'instant'}));await button().waitFor();
      check(true,`${path}滚动下方后显示`);
      const centered=await button().evaluate(el=>{const r=el.getBoundingClientRect();return Math.abs((r.top+r.bottom)/2-innerHeight/2)<1;});
      check(centered,`${path}悬浮于右侧中部`);
      await button().click();await page.waitForFunction(()=>window.scrollY===0);await synchronize();
      check(await button().count()===0,`${path}回顶后隐藏`);
    }
    routes.push({path,room});
  }
  await page.goto(origin+'/studio');await synchronize();
  await page.evaluate(()=>{const filler=document.createElement('div');filler.id='test-overflow';filler.style.height='1400px';document.body.append(filler);});
  await synchronize();check(await button().count()===0,'内容增高但未滚动时仍隐藏');
  await page.evaluate(()=>window.scrollTo({top:500,behavior:'instant'}));await button().waitFor();
  await page.evaluate(()=>document.getElementById('test-overflow').remove());await synchronize();
  check(await button().count()===0,'内容缩短后隐藏');
  await page.goto(origin+'/privacy');await page.evaluate(()=>window.scrollTo({top:500,behavior:'instant'}));await button().waitFor();
  await page.setViewportSize({width:1440,height:6000});await synchronize();check(await button().count()===0,'窗口容纳全文后隐藏');
  await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>window.scrollTo({top:600,behavior:'instant'}));await button().waitFor();await button().click();
  await page.waitForFunction(()=>window.scrollY===0);await synchronize();check(await button().count()===0,'平滑回顶结束且按钮消失');
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.scrollTo({top:600,behavior:'instant'}));await button().waitFor();await button().focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.scrollY===0);await synchronize();check(await button().count()===0,'键盘Enter立即回顶并隐藏');
  await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'衣装灵感',exact:true}).click();await synchronize();
  check(await button().count()===0,'SPA新页顶部不残留按钮');
  await page.getByRole('searchbox',{name:'搜索衣装'}).fill('SPR-0001');
  const gap=await page.locator('main').evaluate(main=>Number.parseFloat(getComputedStyle(main).paddingBottom));
  check(Math.abs(gap-32)<1,'衣装列表尾部空padding从150px收紧到32px');
  await page.evaluate(()=>window.scrollTo({top:document.scrollingElement.scrollHeight,behavior:'instant'}));await button().waitFor();
  const footerGap=await page.evaluate(()=>document.scrollingElement.scrollHeight-(document.querySelector('footer').getBoundingClientRect().bottom+scrollY));
  check(Math.abs(footerGap)<1,'衣装页脚之后没有额外空白');
  check(await page.locator('div[aria-label="已选衣装"]').evaluate(bar=>bar.getBoundingClientRect().bottom<=document.querySelector('footer').getBoundingClientRect().top),'试穿清单在页尾正常占位，不遮挡页脚');
  await page.screenshot({path:'output/playwright/back-to-top-wardrobe-bottom.png'});
  await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>window.scrollTo({top:500,behavior:'instant'}));await button().waitFor();
  const overlap=await button().evaluate(el=>{const circle=el.getBoundingClientRect(),bar=document.querySelector('[aria-label="已选衣装"]').getBoundingClientRect();return circle.left<bar.right&&circle.right>bar.left&&circle.top<bar.bottom&&circle.bottom>bar.top;});
  check(!overlap,'衣装页右侧中部避开底部试穿清单');
  await page.getByRole('button',{name:'切换夜间模式'}).click();await page.getByRole('button',{name:'Switch to English'}).click();
  await page.evaluate(()=>window.scrollTo({top:500,behavior:'instant'}));await page.getByRole('button',{name:'Back to top',exact:true}).waitFor();
  check(await page.getByRole('button',{name:'Back to top',exact:true}).count()===1,'英文深色正常显示');
  await page.screenshot({path:'output/playwright/back-to-top-centered-dark.png'});
  await page.context().addCookies([{name:'yingxiang-locale',value:'zh',url:origin},{name:'yingxiang-theme',value:'light',url:origin}]);
  await page.goto(origin+'/');await page.evaluate(()=>window.scrollTo({top:document.scrollingElement.scrollHeight,behavior:'instant'}));
  const homeGap=await page.evaluate(()=>document.scrollingElement.scrollHeight-(document.querySelector('footer').getBoundingClientRect().bottom+scrollY));
  check(Math.abs(homeGap)<1,'首页页脚之后没有额外空白');
  await page.screenshot({path:'output/playwright/back-to-top-home-bottom.png'});
  check(writes.length===0,'全程0个POST，无模型／支付调用');
  return {checks:checks.length,results:checks,routes,postRequests:writes};
}
