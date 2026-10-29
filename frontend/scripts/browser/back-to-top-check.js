async (page) => {
  const origin='http://127.0.0.1:8787',checks=[],writes=[];
  const check=(value,message)=>{if(!value)throw new Error(message);checks.push(message);};
  page.on('request',request=>{if(request.method()==='POST')writes.push(new URL(request.url()).pathname);});
  const button=()=>page.getByRole('button',{name:'回到顶部',exact:true});
  const synchronize=()=>page.waitForFunction(()=>{
    const expected=document.scrollingElement.scrollHeight>document.documentElement.clientHeight+1;
    return expected===Boolean(document.querySelector('.back-to-top'));
  });
  await page.context().addCookies([{name:'yingxiang-locale',value:'zh',url:origin},{name:'yingxiang-theme',value:'light',url:origin}]);
  await page.setViewportSize({width:1440,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  const paths=['/','/wardrobe','/pricing','/help','/help/feedback','/privacy','/terms','/studio','/studio/video','/studio/edit','/works','/account','/account/usage','/account/orders','/account/security','/admin'];
  const routes=[];
  for(const path of paths){
    await page.goto(origin+path);await page.locator('main').first().waitFor();await page.evaluate(()=>document.fonts.ready);await synchronize();
    const height=await page.evaluate(()=>({page:document.scrollingElement.scrollHeight,viewport:document.documentElement.clientHeight}));
    const visible=await button().count()===1;
    check(visible===(height.page>height.viewport+1),`${path}按文档是否超过一屏显示`);
    if(visible){
      check(await page.evaluate(()=>window.scrollY===0),`${path}长页在顶部也可见`);
      await page.evaluate(()=>window.scrollTo({top:500,behavior:'instant'}));
      check(await page.evaluate(()=>window.scrollY>0),`${path}可滚动`);
      await button().click();await page.waitForFunction(()=>window.scrollY===0);
      check(true,`${path}点击回顶`);
    }
    routes.push({path,...height,visible});
  }
  check(routes.some(item=>item.visible)&&routes.some(item=>!item.visible),'同时覆盖长页与短页');
  await page.goto(origin+'/studio');await synchronize();
  check(await button().count()===0,'固定创作页不显示');
  await page.evaluate(()=>{const filler=document.createElement('div');filler.id='test-overflow';filler.style.height='1400px';document.body.append(filler);});
  await button().waitFor();check(true,'异步内容增高后自动显示');
  await page.evaluate(()=>document.getElementById('test-overflow').remove());await synchronize();
  check(await button().count()===0,'内容缩短后自动隐藏');
  await page.goto(origin+'/privacy');await button().waitFor();
  await page.setViewportSize({width:1440,height:6000});await synchronize();
  check(await button().count()===0,'窗口足以显示全部内容时隐藏');
  await page.setViewportSize({width:1440,height:900});await button().waitFor();check(true,'缩小窗口后恢复');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>window.scrollTo({top:600,behavior:'instant'}));await button().click();
  await page.waitForFunction(()=>window.scrollY===0);check(true,'正常动态偏好平滑回顶');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>window.scrollTo({top:600,behavior:'instant'}));await button().focus();await page.keyboard.press('Enter');
  check(await page.evaluate(()=>window.scrollY===0),'键盘Enter与减少动态立即回顶');
  await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'创作空间',exact:true}).click();await synchronize();
  check(await button().count()===0,'SPA切换短页后隐藏');
  await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'衣装灵感',exact:true}).click();await button().waitFor();
  await page.setViewportSize({width:1280,height:900});
  const overlap=await button().evaluate(element=>{
    const circle=element.getBoundingClientRect(),bar=document.querySelector('[aria-label="已选衣装"]').getBoundingClientRect();
    return circle.left<bar.right&&circle.right>bar.left&&circle.top<bar.bottom&&circle.bottom>bar.top;
  });
  check(!overlap,'1280宽衣装页不遮挡试穿清单');
  await page.screenshot({path:'output/playwright/back-to-top-wardrobe.png'});
  await page.getByRole('button',{name:'切换夜间模式'}).click();await page.getByRole('button',{name:'Switch to English'}).click();
  check(await page.getByRole('button',{name:'Back to top',exact:true}).count()===1,'深色英文名称同步');
  await page.screenshot({path:'output/playwright/back-to-top-dark.png'});
  await page.context().addCookies([{name:'yingxiang-locale',value:'zh',url:origin},{name:'yingxiang-theme',value:'light',url:origin}]);
  check(writes.length===0,'全程0个POST，无生成或支付调用');
  return {checks:checks.length,results:checks,routes,postRequests:writes};
}
