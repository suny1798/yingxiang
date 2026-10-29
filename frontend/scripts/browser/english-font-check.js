async (page) => {
  const origin='http://127.0.0.1:8787';
  const check=(value,message)=>{if(!value)throw new Error(message);};
  await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.context().addCookies([{name:'yingxiang-locale',value:'en',url:origin},{name:'yingxiang-theme',value:'light',url:origin}]);
  const paths=['/','/pricing','/help','/help/feedback','/privacy','/terms','/studio','/studio/video','/studio/edit','/works','/account','/account/orders','/account/usage','/account/security','/admin'];
  const results=[];
  for(const path of paths){
    await page.goto(origin+path);
    await page.locator('main').first().waitFor();
    await page.waitForFunction(()=>document.documentElement.lang==='en');
    await page.evaluate(()=>document.fonts.ready);
    const result=await page.evaluate(()=>{
      const items=[...document.querySelectorAll('header a,main h1,main h2,main h3,main p,main button,main input,main textarea')]
        .filter(el=>el.getClientRects().length && /[A-Za-z]/.test(el.textContent||el.getAttribute('placeholder')||''));
      return {overflow:document.documentElement.scrollWidth>innerWidth,count:items.length,
        inconsistent:items.filter(el=>!getComputedStyle(el).fontFamily.startsWith('Inter,')).map(el=>({tag:el.tagName,font:getComputedStyle(el).fontFamily})),
        headings:items.filter(el=>/^H[1-6]$/.test(el.tagName)).every(el=>getComputedStyle(el).fontWeight==='600')};
    });
    check(!result.overflow,path+' overflow');
    check(result.count>0 && result.inconsistent.length===0,path+' inconsistent fonts '+JSON.stringify(result.inconsistent));
    check(result.headings,path+' heading weight');
    results.push({path,elements:result.count});
  }
  await page.goto(origin+'/');await page.locator('main').first().waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await page.getByRole('heading',{name:'Local preview, cloud processing, and saved creations'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'output/playwright/english-font-home.png'});
  await page.goto(origin+'/pricing');await page.locator('main').first().waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:'output/playwright/english-font-pricing.png'});
  await page.context().addCookies([{name:'yingxiang-locale',value:'zh',url:origin}]);
  await page.goto(origin+'/');await page.locator('main').first().waitFor();
  const chinese=await page.evaluate(()=>({lang:document.documentElement.lang,display:getComputedStyle(document.querySelector('main h1')).fontFamily,overflow:document.documentElement.scrollWidth>innerWidth}));
  check(chinese.lang==='zh-CN' && chinese.display.includes('Noto Sans SC') && !chinese.overflow,'Chinese sans-serif font stack');
  await page.context().addCookies([{name:'yingxiang-locale',value:'en',url:origin}]);
  await page.goto(origin+'/');await page.locator('main').first().waitFor();
  await page.getByRole('heading',{name:'Local preview, cloud processing, and saved creations'}).scrollIntoViewIfNeeded();
  await page.evaluate(()=>document.fonts.ready);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');await cdp.send('CSS.enable');
  const {root}=await cdp.send('DOM.getDocument');
  const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'main h1'});
  const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
  check(fonts.some(font=>font.familyName.startsWith('Inter') && font.isCustomFont),'actual self-hosted Inter rendering');
  await cdp.detach();
  return {routes:results,checkedElements:results.reduce((n,r)=>n+r.elements,0),renderedFonts:fonts.map(font=>font.familyName),chineseSansSerif:true,viewport:'1440x1000',modelCalls:0,payments:0};
}
