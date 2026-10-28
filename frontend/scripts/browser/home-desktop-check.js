async (page) => {
  await page.addInitScript(() => {
    const pending=new Set();window.__homeActiveTimers=pending;
    const schedule=window.setTimeout.bind(window),cancel=window.clearTimeout.bind(window);
    window.setTimeout=(callback,delay,...args)=>{
      if(delay!==6000||typeof callback!=='function')return schedule(callback,delay,...args);
      let id;id=schedule(()=>{pending.delete(id);callback(...args);},delay);pending.add(id);return id;
    };
    window.clearTimeout=id=>{pending.delete(id);cancel(id);};
  });
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:8791/');
  const active=()=>page.locator('[data-home-hero] [data-active=true]').getAttribute('aria-label');
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  check(await active()==='1 / 4','Initial slide');
  await page.getByRole('button',{name:/Next background|下一张背景/}).click();
  check(await active()==='2 / 4','Next slide');
  await page.keyboard.press('ArrowLeft');check(await active()==='1 / 4','Keyboard left');
  await page.keyboard.press('ArrowLeft');check(await active()==='4 / 4','Wrap previous');
  await page.waitForTimeout(6500);check(await active()==='4 / 4','Reduced motion must not autoplay');
  check(await page.evaluate(()=>window.__homeActiveTimers.size===0),'Reduced motion timer');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>document.querySelector('[data-home-hero] [data-active=true]').getAttribute('aria-label')!=='4 / 4',null,{timeout:8000});
  const after=await active();
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(6500);check(await active()===after,'Hidden document must not autoplay');
  check(await page.evaluate(()=>window.__homeActiveTimers.size===0),'Hidden timer');
  await page.evaluate(()=>{Reflect.deleteProperty(document,'hidden');document.dispatchEvent(new Event('visibilitychange'));});
  await page.getByRole('navigation',{name:/Footer navigation|页脚导航/}).getByRole('link',{name:/Privacy & usage|隐私与使用说明/}).click();
  check(await page.evaluate(()=>window.__homeActiveTimers.size===0),'Unmount timer cleanup');
  check(await page.evaluate(()=>window.dispatchEvent(new WheelEvent('wheel',{deltaY:100,cancelable:true}))),'Unmount wheel cleanup');
  return {status:'OK',manual:true,keyboard:true,reducedMotion:true,autoplay:true,syntheticHidden:true,unmountTimers:true,unmountWheel:true};
}
