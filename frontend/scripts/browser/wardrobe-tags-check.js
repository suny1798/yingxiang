async (page) => {
  const origin='http://127.0.0.1:8787',results=[],writes=[];
  const check=(value,message)=>{if(!value)throw new Error(message);results.push(message);};
  page.on('request',request=>{if(request.method()==='POST')writes.push(request.url());});
  await page.context().addCookies([{name:'yingxiang-locale',value:'zh',url:origin},{name:'yingxiang-theme',value:'light',url:origin}]);
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/wardrobe');await page.locator('[data-tag-group="颜色"]').waitFor();await page.evaluate(()=>document.fonts.ready);
  const stats=group=>group.evaluate(fieldset=>{
    const tags=fieldset.querySelector('[id^=tag-group]'),toggle=fieldset.querySelector('[aria-expanded]');
    const visible=[...tags.querySelectorAll('button')].filter(button=>!button.inert);
    return {rows:new Set(visible.map(button=>button.offsetTop)).size,hidden:tags.querySelectorAll('[inert]').length,expanded:toggle.getAttribute('aria-expanded'),gap:toggle.getBoundingClientRect().top-tags.getBoundingClientRect().bottom,count:visible.length};
  });
  const colors=page.locator('[data-tag-group="颜色"]'),details=page.locator('[data-tag-group="材质与细节"]'),garments=page.locator('[data-tag-group="服装"]');
  for(const [group,name] of [[colors,'颜色'],[details,'材质与细节']]){
    const initial=await stats(group);check(initial.rows===2&&initial.expanded==='false',`${name}默认展示两行`);
    check(initial.hidden>0,`${name}超出两行的标签不进入键盘与辅助导航`);
    check(initial.gap>=16,`${name}标签与展开操作间距16px`);
    await group.getByRole('button',{name:'展开全部标签',exact:true}).click();
    const expanded=await stats(group);check(expanded.rows>2&&expanded.hidden===0,`${name}可展开全部标签`);
    check(expanded.gap>=16,`${name}收起按钮与标签间距16px`);
    await group.getByRole('button',{name:'收起标签',exact:true}).click();
    check((await stats(group)).rows===2,`${name}收起后保留两行`);
  }
  check((await stats(garments)).expanded==='true','服装继续默认展开全部');
  check((await stats(garments)).gap>=16,'服装收起按钮间距16px');
  await colors.getByRole('button',{name:'白色',exact:true}).click();
  check(await colors.getByRole('button',{name:'白色',exact:true}).getAttribute('aria-pressed')==='true','预览行标签可筛选并高亮');
  check(await page.locator('#looks-heading').innerText().then(text=>Number(text.split(' ').pop())<966),'标签筛选实际缩小结果');
  await page.getByRole('button',{name:'重置',exact:true}).click();
  check(await colors.getByRole('button',{name:'白色',exact:true}).getAttribute('aria-pressed')==='false','重置清除选中');
  await page.screenshot({path:'output/playwright/wardrobe-tags-two-rows.png'});
  await page.getByRole('button',{name:'Switch to English'}).click();await page.evaluate(()=>document.fonts.ready);
  for(const group of [colors,details])check((await stats(group)).rows===2,'英文标签仍默认两行');
  await page.setViewportSize({width:1200,height:1000});
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-tag-group]')].every(fieldset=>{const tags=fieldset.querySelector('[id^=tag-group]');return [...tags.querySelectorAll('button')].every(button=>button.inert===(fieldset.querySelector('[aria-expanded]').getAttribute('aria-expanded')==='false'&&button.offsetTop+button.offsetHeight>tags.clientHeight+1));}));
  for(const group of [colors,details])check((await stats(group)).rows===2,'窄桌面标签仍默认两行');
  check(writes.length===0,'全程0个POST');
  await page.context().addCookies([{name:'yingxiang-locale',value:'zh',url:origin}]);
  return {checks:results.length,results,postRequests:writes};
}
