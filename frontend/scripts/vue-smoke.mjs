import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../',import.meta.url));
const assets = await readdir(new URL('../dist/assets/',import.meta.url));
const sdk = assets.find(name=>name.startsWith('sdk-') && name.endsWith('.js'));
assert.ok(sdk, 'Missing SDK build entry');
assert.ok((await stat(new URL(`../dist/assets/${sdk}`,import.meta.url))).size > 1000, 'SDK was removed by tree shaking');
const allJs = (await Promise.all(assets.filter(name=>name.endsWith('.js')).map(name=>readFile(new URL(`../dist/assets/${name}`,import.meta.url),'utf8')))).join('\n');
assert.ok(!allJs.includes('SYNTHETIC_VITE_SECRET_CANARY'), 'Server-only secret entered bundle');
const reservation=createServer().listen(0,'127.0.0.1'); await once(reservation,'listening');
const port=reservation.address().port; await new Promise(resolve=>reservation.close(resolve));
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:'ignore'});
try {
  const end=Date.now()+30_000;
  while (true) {
    try { if ((await fetch(`http://127.0.0.1:${port}/terms`,{signal:AbortSignal.timeout(1000)})).status===200) break; } catch {}
    assert.equal(child.exitCode,null,'Preview process exited'); assert.ok(Date.now()<end,'Preview start timed out');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  for (const path of ['/terms','/terms#scope','/privacy','/privacy#records','/not-a-real-page']) {
    const response=await fetch(`http://127.0.0.1:${port}${path}`); const html=await response.text();
    assert.equal(response.status,200); assert.ok(html.includes('id="app"')); assert.ok(html.includes('type="module"'));
    for (const [,asset] of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g))
      assert.equal((await fetch(`http://127.0.0.1:${port}${asset}`)).status,200);
  }
  console.log(JSON.stringify({status:'OK',staticRoutes:5,sdkBundleNonEmpty:true,previewOnly:true}));
} finally {
  if (child.exitCode===null) { child.kill(); await once(child,'exit'); }
}
