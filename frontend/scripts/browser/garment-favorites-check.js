async (page) => {
  const origin='http://127.0.0.1:8787',phase=new URL(page.url()).searchParams.get('favorite-test'),checks=[],writes=[];
  const check=(value,message)=>{if(!value)throw new Error(message);checks.push(message);};
  page.on('request',request=>{if(request.method()==='POST')writes.push(new URL(request.url()).pathname);});
  await page.context().addCookies([{name:'yingxiang-locale',value:'zh',url:origin},{name:'yingxiang-theme',value:'light',url:origin}]);
  await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'reduce'});
  const tabs=()=>page.getByRole('group',{name:'衣装收藏筛选'});
  const dialog=()=>page.getByRole('dialog');
  async function open(id){
    await tabs().getByRole('button',{name:'全部衣装',exact:true}).click();
    await page.getByRole('searchbox',{name:'搜索衣装'}).fill(id);
    await page.locator(`article[data-look="${id}"]`).getByRole('button',{name:`预览衣装 ${id}`,exact:true}).click();
    await dialog().waitFor();
  }
  async function close(){await dialog().getByRole('button',{name:'关闭预览',exact:true}).click();}
  async function listFavorites(){await page.getByRole('searchbox',{name:'搜索衣装'}).fill('');await tabs().getByRole('button',{name:/我的收藏/}).click();}
  if(phase==='guest'){
    await page.goto(origin+'/wardrobe');await page.locator('article[data-look]').first().waitFor();
    const ids=await page.locator('article[data-look]').evaluateAll(items=>items.map(item=>item.dataset.look));
    await page.reload();await page.locator('article[data-look]').first().waitFor();
    const next=await page.locator('article[data-look]').evaluateAll(items=>items.map(item=>item.dataset.look));
    check(ids[0]!==next[0]&&next.length===16,'刷新自动随机四行且首套不同');
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'首页',exact:true}).click();
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'衣装灵感',exact:true}).click();
    const reenter=await page.locator('article[data-look]').first().getAttribute('data-look');
    check(reenter!==next[0],'重新进入自动换一组');
    await page.locator('[data-load-more]').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelectorAll('article[data-look]').length===24);
    check(await page.locator('article[data-look]').evaluateAll(items=>new Set(items.map(item=>item.dataset.look)).size===24),'随机滚动追加无重复');
    await open('SPR-0001');await dialog().getByRole('button',{name:'收藏衣装',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('dialog[open]').length===2);
    check(true,'访客详情收藏提示登录，不自动保存');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    check(writes.length===0,'访客随机浏览与收藏提示0个POST');
  }else{
    const read=page.waitForResponse(response=>response.url().endsWith('/api/garments/favorites')&&response.status()===200);
    await page.goto(origin+'/wardrobe');await read;
    if(phase==='a'){
      await open('SPR-0001');await dialog().getByRole('button',{name:'收藏衣装',exact:true}).click();
      await dialog().getByRole('button',{name:'取消收藏衣装',exact:true}).waitFor();
      check(true,'详情收藏在实际Java接口确认后显示已收藏');await close();
      await listFavorites();check(await page.locator('article[data-look="SPR-0001"]').count()===1,'我的收藏显示实际已收藏衣装');
      const reloadRead=page.waitForResponse(response=>response.url().endsWith('/api/garments/favorites')&&response.status()===200);await page.reload();await reloadRead;
      await listFavorites();check(await page.locator('article[data-look="SPR-0001"]').count()===1,'刷新后收藏保留');
      await open('AUT-0001');await dialog().getByRole('button',{name:'收藏衣装',exact:true}).click();await dialog().getByRole('button',{name:'取消收藏衣装',exact:true}).waitFor();await close();
      await listFavorites();check(await page.locator('article[data-look]').count()===2,'多套收藏可集中查看');
      await page.getByRole('searchbox',{name:'搜索衣装'}).fill('AUT-0001');check(await page.locator('article[data-look]').count()===1,'收藏可叠加搜索');
      await open('SPR-0001');await dialog().getByRole('button',{name:'取消收藏衣装',exact:true}).click();await dialog().getByRole('button',{name:'收藏衣装',exact:true}).waitFor();await close();
      await listFavorites();check(await page.locator('article[data-look]').count()===1&&await page.locator('article[data-look="AUT-0001"]').count()===1,'取消收藏立即从收藏列表移除');
      await page.screenshot({path:'output/playwright/garment-favorites-list.png'});
      await open('SPR-0001');await page.route('**/api/garments/SPR-0001/favorite',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:50300,data:null,message:'unavailable'})}));
      await dialog().getByRole('button',{name:'收藏衣装',exact:true}).click();await dialog().getByRole('alert').waitFor();
      check(await dialog().getByRole('button',{name:'收藏衣装',exact:true}).getAttribute('aria-pressed')==='false','写入失败不伪报已收藏');
      await page.unroute('**/api/garments/SPR-0001/favorite');await dialog().getByRole('button',{name:'重新读取收藏',exact:true}).click();await dialog().getByRole('button',{name:'收藏衣装',exact:true}).waitFor({state:'visible'});
      await page.waitForFunction(()=>!document.querySelector('dialog[open] [role=alert]'));
      check(true,'重新读取收藏核对后恢复操作');await close();
      await open('AUT-0001');await page.screenshot({path:'output/playwright/garment-favorite-detail.png'});await close();
    }else if(phase==='b'){
      await listFavorites();check(await page.locator('article[data-look]').count()===0,'另一账号看不到账号A收藏');
      await open('SPR-0001');await dialog().getByRole('button',{name:'收藏衣装',exact:true}).click();await dialog().getByRole('button',{name:'取消收藏衣装',exact:true}).waitFor();await close();
      await listFavorites();check(await page.locator('article[data-look="SPR-0001"]').count()===1,'另一账号可独立收藏同一衣装');
    }else{
      await listFavorites();check(await page.locator('article[data-look]').count()===1&&await page.locator('article[data-look="AUT-0001"]').count()===1,'切回账号A仅恢复A的收藏');
    }
    check(writes.every(path=>/^\/api\/garments\/(SPR|SUM|AUT|WIN)-\d{4}\/favorite$/.test(path)),'仅衣装收藏写入，无相机／模型／支付请求');
  }
  return {phase,checks:checks.length,results:checks,postPaths:writes};
}
