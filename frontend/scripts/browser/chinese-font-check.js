async (page) => {
  const origin='http://127.0.0.1:8787';
  const check=(value,message)=>{if(!value)throw new Error(message);};
  const failures=[];
  page.on('requestfailed',request=>{if(request.url().includes('/assets/fonts/'))failures.push(request.url());});
  page.on('response',response=>{if(response.url().includes('/assets/fonts/') && response.status()>=400)failures.push(response.status()+' '+response.url());});
  await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.context().addCookies([{name:'yingxiang-locale',value:'zh',url:origin},{name:'yingxiang-theme',value:'light',url:origin}]);
  const paths=['/','/pricing','/help','/help/feedback','/privacy','/terms','/studio','/studio/video','/studio/edit','/works','/account','/account/orders','/account/usage','/account/security','/admin'];
  const results=[];
  for(const path of paths){
    await page.goto(origin+path);
    await page.locator('main').first().waitFor();
    await page.waitForFunction(()=>document.documentElement.lang==='zh-CN');
    await page.evaluate(()=>document.fonts.ready);
    const result=await page.evaluate(()=>{
      const items=[...document.querySelectorAll('header a,main h1,main h2,main h3,main p,main button,main input,main textarea')]
        .filter(el=>el.getClientRects().length && /[\u3400-\u9fff]/u.test(el.textContent||el.getAttribute('placeholder')||''));
      return {overflow:document.documentElement.scrollWidth>innerWidth,count:items.length,
        inconsistent:items.filter(el=>!getComputedStyle(el).fontFamily.includes('Noto Sans SC') || /Songti|STSong|SimSun|serif(?!-)/.test(getComputedStyle(el).fontFamily.replaceAll('sans-serif',''))).map(el=>({tag:el.tagName,font:getComputedStyle(el).fontFamily})),
        headings:items.filter(el=>/^H[1-6]$/.test(el.tagName)).every(el=>getComputedStyle(el).fontWeight==='600')};
    });
    check(!result.overflow,path+' overflow');
    check(result.count>0 && result.inconsistent.length===0,path+' font mismatch '+JSON.stringify(result.inconsistent));
    check(result.headings,path+' heading weight');
    results.push({path,elements:result.count});
  }
  await page.goto(origin+'/');await page.locator('main h1').waitFor();
  await page.evaluate(()=>document.fonts.ready);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');await cdp.send('CSS.enable');
  const {root}=await cdp.send('DOM.getDocument');
  const actual=[];
  for(const selector of ['header a','main h1','main p']){
    const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});
    const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
    check(fonts.some(font=>font.familyName.startsWith('Noto Sans SC') && font.isCustomFont),selector+' not rendering self-hosted Chinese font');
    actual.push({selector,fonts:fonts.map(font=>font.familyName)});
  }
  await cdp.detach();
  await page.screenshot({path:'output/playwright/chinese-font-home.png'});
  await page.goto(origin+'/pricing');await page.locator('main').first().waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:'output/playwright/chinese-font-pricing.png'});
  await page.context().addCookies([{name:'yingxiang-theme',value:'dark',url:origin}]);
  await page.reload();await page.locator('main').first().waitFor();await page.evaluate(()=>document.fonts.ready);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'dark theme overflow');
  await page.screenshot({path:'output/playwright/chinese-font-pricing-dark.png'});
  check(failures.length===0,'font requests failed '+JSON.stringify(failures));
  const loadedFonts=await page.evaluate(()=>performance.getEntriesByType('resource').filter(item=>item.name.includes('/assets/fonts/')).map(item=>item.name));
  check(loadedFonts.every(url=>url.startsWith(origin+'/')),'fonts must be same-origin');
  await page.context().addCookies([{name:'yingxiang-theme',value:'light',url:origin}]);
  return {routes:results,checkedElements:results.reduce((n,r)=>n+r.elements,0),renderedFonts:actual,loadedFontResources:loadedFonts.length,failedFontRequests:failures.length,viewport:'1440x1000',modelCalls:0,payments:0};
}
