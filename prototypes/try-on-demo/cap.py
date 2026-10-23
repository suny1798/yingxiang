import asyncio, os, sys, time
from playwright.async_api import async_playwright

# 分段截帧：已有的帧跳过，可多次运行续上。用法：python3 cap.py <秒数预算>
async def main():
    comp = os.path.abspath('comp.html'); N = 270; fps = 30
    budget = float(sys.argv[1]) if len(sys.argv) > 1 else 90
    t0 = time.time()
    os.makedirs('frames', exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 1600, 'height': 900})
        await pg.goto('file://' + comp); await pg.evaluate('window.__ready')
        for i in range(N):
            f = f'frames/{i:04d}.png'
            if os.path.exists(f): continue
            if time.time() - t0 > budget: break
            await pg.evaluate(f'window.__seek({i / fps})')
            await pg.screenshot(path=f + '.tmp.png', type='png'); os.rename(f + '.tmp.png', f)
        await b.close()
    print(len([x for x in os.listdir('frames') if x.endswith('.png') and '.tmp' not in x]), 'frames')

asyncio.run(main())
