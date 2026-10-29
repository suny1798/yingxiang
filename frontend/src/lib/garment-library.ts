import catalog from './garment-catalog.json';
import { MAX_GARMENTS } from './limits';

export type LibraryLook = { id: string; season: string; tags: string[] };
export const tagLabels: Record<string,string> = catalog.labels;
export const seasons = ['春','夏','秋','冬'] as const;
// 四季交错，避免首次进入只能看到春装；保持各季内部原顺序。
const bySeason = seasons.map(season => catalog.items.filter(item => item.season === season));
export const libraryLooks: LibraryLook[] = Array.from({length: Math.max(...bySeason.map(items => items.length))}, (_,index) => bySeason.flatMap(items => items[index] ? [items[index]!] : [])).flat();
const lookup = new Map(libraryLooks.map(item => [item.id,item]));
export const lookById = (id:string) => lookup.get(id);
export const lookImage = (id:string, full=false) => `/assets/garments/${full?'full':'thumb'}/${id}.webp`;
export const garmentTags = ['dress','skirt','shirt','blouse','camisole','sweater','cardigan','jacket','coat','hoodie','vest','pants','jeans','shorts'];
export const colorTags = ['white','ivory','cream','beige','black','grey','brown','pink','red','burgundy','yellow','green','mint','blue','navy','purple','orange','khaki','olive','gold','silver'];
export const detailTags = Object.keys(tagLabels).filter(tag => !garmentTags.includes(tag) && !colorTags.includes(tag));
export function lookTitle(item:LibraryLook, english=false) {
  const tags = item.tags.filter(tag => garmentTags.includes(tag)).slice(0,2);
  return tags.map(tag => english ? tag : tagLabels[tag] ?? tag).join(english?' & ':' · ') || item.id;
}
export function filterLooks(items:readonly LibraryLook[], filters:{seasons:readonly string[];tags:readonly string[];search:string}) {
  const words=filters.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => (!filters.seasons.length || filters.seasons.includes(item.season)) && filters.tags.every(tag => item.tags.includes(tag)) && words.every(word => `${item.id} ${item.season} ${item.tags.join(' ')} ${item.tags.map(tag=>tagLabels[tag]).join(' ')} ${{春:'spring',夏:'summer',秋:'autumn',冬:'winter'}[item.season]??''}`.toLowerCase().includes(word)));
}
export function selectedLookIds(value:unknown):string[] {
  if(typeof value!=='string')return [];
  return [...new Set(value.split(',').filter(id=>lookup.has(id)))].slice(0,MAX_GARMENTS);
}
export function toggleLook(ids:readonly string[],id:string):string[] {
  if(ids.includes(id))return ids.filter(value=>value!==id);
  return lookup.has(id)&&ids.length<MAX_GARMENTS?[...ids,id]:[...ids];
}
/** 洗牌整个筛选结果；四行之后的滚动追加沿用本轮顺序，避免重复衣装。 */
export function shuffleLooks(items:readonly LibraryLook[],random= Math.random):LibraryLook[] {
  const result=[...items];
  for(let index=result.length-1;index>0;index--){
    const swap=Math.floor(random()*(index+1));
    [result[index],result[swap]]=[result[swap]!,result[index]!];
  }
  return result;
}
/** 只读取本站已知素材。任一失败不交付半批；中止后不得向已离开的页面导入。 */
export async function loadLookFiles(ids:readonly string[],signal:AbortSignal,request:typeof fetch=fetch):Promise<File[]> {
  return Promise.all(selectedLookIds(ids.join(',')).map(async id=>{
    const response=await request(lookImage(id,true),{signal,credentials:'omit'});
    if(!response.ok)throw new Error('衣装图片加载失败，请返回衣装灵感重试。');
    const blob=await response.blob();
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    if(!blob.type.startsWith('image/')||blob.size>10*1024*1024||blob.size===0)throw new Error('衣装图片不可用，请重新选择。');
    return new File([blob],`${id}.webp`,{type:blob.type});
  }));
}
