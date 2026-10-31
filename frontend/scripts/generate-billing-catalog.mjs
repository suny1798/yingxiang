import {readFileSync,writeFileSync} from 'node:fs';
const source=new URL('../../backend/src/main/resources/billing-catalog.json',import.meta.url);
const target=new URL('../src/lib/billing-catalog.json',import.meta.url);
const content=JSON.stringify(JSON.parse(readFileSync(source,'utf8')),null,2)+'\n';
if(process.argv.includes('--check')) {
  if(readFileSync(target,'utf8')!==content) throw new Error('计费目录不同步，请运行 npm run billing:sync');
} else writeFileSync(target,content);
