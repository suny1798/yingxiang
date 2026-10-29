import assert from 'node:assert/strict';
import test from 'node:test';
import { access,readFile } from 'node:fs/promises';
import { colorTags,detailTags,filterLooks,freshLooks,garmentTags,libraryLooks,loadLookFiles,lookImage,selectedLookIds,shuffleLooks,tagLabels,toggleLook } from '../src/lib/garment-library';

test('966套素材ID唯一，标签全覆盖，缩略图和参考图齐全',async()=>{
  assert.equal(libraryLooks.length,966);
  assert.equal(new Set(libraryLooks.map(item=>item.id)).size,966);
  const groups=[...colorTags,...garmentTags,...detailTags];
  await Promise.all(libraryLooks.map(async item=>{
    assert.match(item.id,/^(SPR|SUM|AUT|WIN)-\d{4}$/);
    assert.ok(item.tags.length>0&&item.tags.every(tag=>tagLabels[tag]&&groups.includes(tag)));
    await access(`public${lookImage(item.id)}`);await access(`public${lookImage(item.id,true)}`);
    const bytes=await readFile(`public${lookImage(item.id,true)}`);
    assert.equal(bytes.toString('ascii',8,12),'WEBP');
  }));
  assert.equal(new Set(libraryLooks.slice(0,4).map(item=>item.season)).size,4);
  const backendIds=(await readFile('../backend/src/main/resources/garment-library-ids.txt','utf8')).trim().split(/\r?\n/).sort();
  assert.deepEqual(backendIds,libraryLooks.map(item=>item.id).sort());
});
test('新进入序列至少首套不同，且保持全量不重复',()=>{
  const first=freshLooks(libraryLooks,null,()=>0);
  const second=freshLooks(libraryLooks,first[0]!.id,()=>0);
  assert.notEqual(first[0]!.id,second[0]!.id);assert.equal(new Set(second.map(item=>item.id)).size,966);
});
test('季节取并集、标签取交集，关键词支持中文英文及编号',()=>{
  const matches=filterLooks(libraryLooks,{seasons:['春','夏'],tags:['white','skirt'],search:''});
  assert.ok(matches.length>0);
  assert.ok(matches.every(item=>['春','夏'].includes(item.season)&&item.tags.includes('white')&&item.tags.includes('skirt')));
  assert.deepEqual(filterLooks(libraryLooks,{seasons:[],tags:[],search:'白色 半身裙'}),filterLooks(libraryLooks,{seasons:[],tags:['white','skirt'],search:''}));
  assert.equal(filterLooks(libraryLooks,{seasons:[],tags:[],search:'spr-0001'})[0]?.id,'SPR-0001');
  assert.equal(filterLooks(libraryLooks,{seasons:[],tags:[],search:'no such look'}).length,0);
});
test('选择可取消且最多6套，非法／重复URL编号不能生成任意资源地址',()=>{
  const ids=libraryLooks.slice(0,7).map(item=>item.id);
  let chosen:string[]=[];
  for(const id of ids)chosen=toggleLook(chosen,id);
  assert.equal(chosen.length,6);
  chosen=toggleLook(chosen,ids[0]!);assert.equal(chosen.length,5);
  chosen=toggleLook(chosen,ids[6]!);assert.equal(chosen.length,6);
  assert.deepEqual(toggleLook(chosen,'../../secret'),chosen);
  assert.deepEqual(selectedLookIds(`SPR-0001,SPR-0001,../../secret,https://other.test/a,AUT-0001`),['SPR-0001','AUT-0001']);
  assert.deepEqual(selectedLookIds(['SPR-0001']),[]);
  assert.equal(selectedLookIds(ids.join(',')).length,6);
});
test('随机顺序只包含当前筛选衣装、无重复且不改变原清单',()=>{
  const source=filterLooks(libraryLooks,{seasons:['秋'],tags:[],search:''});
  const before=source.map(item=>item.id),shuffled=shuffleLooks(source,()=>0);
  assert.ok(source.length>16);
  assert.notDeepEqual(shuffled.map(item=>item.id),before);
  assert.deepEqual(source.map(item=>item.id),before);
  assert.deepEqual(shuffled.map(item=>item.id).sort(),[...before].sort());
  assert.equal(new Set(shuffled.map(item=>item.id)).size,source.length);
  assert.deepEqual(shuffleLooks([],()=>0),[]);
  assert.deepEqual(shuffleLooks([source[0]!],()=>0),[source[0]]);
});
test('本站完整参考图转File，失败或取消不交付半批',async()=>{
  const urls:string[]=[];
  const request:typeof fetch=async(url,options)=>{urls.push(String(url));assert.equal(options?.credentials,'omit');return new Response(new Blob(['webp'],{type:'image/webp'}));};
  const files=await loadLookFiles(['SPR-0001'],new AbortController().signal,request);
  assert.equal(files[0]?.name,'SPR-0001.webp');assert.equal(files[0]?.type,'image/webp');
  assert.deepEqual(urls,['/assets/garments/full/SPR-0001.webp']);
  await assert.rejects(loadLookFiles(['SPR-0001'],new AbortController().signal,async()=>new Response('fail',{status:404})),/加载失败/);
  await assert.rejects(loadLookFiles(['SPR-0001'],new AbortController().signal,async()=>new Response('not image')),/不可用/);
  const abort=new AbortController();abort.abort();
  await assert.rejects(loadLookFiles(['SPR-0001'],abort.signal,request),{name:'AbortError'});
});
