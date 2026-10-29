<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { colorTags, detailTags, filterLooks, garmentTags, libraryLooks, lookById, lookImage, lookTitle, seasons, shuffleLooks, tagLabels, toggleLook, type LibraryLook } from '../../lib/garment-library';
import { preferences, t } from '../preferences';
import { MAX_GARMENTS } from '../../lib/limits';
import s from './wardrobe.module.css';

const router=useRouter();
const search=ref(''), selectedSeasons=ref<string[]>([]), selectedTags=ref<string[]>([]), chosen=ref<string[]>([]), onlyChosen=ref(false), message=ref('');
const english=computed(()=>preferences.locale.value==='en');
const filtered=computed(()=>filterLooks(onlyChosen.value?libraryLooks.filter(item=>chosen.value.includes(item.id)):libraryLooks,{seasons:selectedSeasons.value,tags:selectedTags.value,search:search.value}));
const randomized=ref<LibraryLook[]|null>(null);
const ordered=computed(()=>{if(!randomized.value)return filtered.value;const eligible=new Set(filtered.value.map(item=>item.id));return randomized.value.filter(item=>eligible.has(item.id));});
const rows=ref(4),columns=ref(4),grid=ref<HTMLElement|null>(null),loadTrigger=ref<HTMLElement|null>(null);
const visible=computed(()=>ordered.value.slice(0,rows.value*columns.value));
const hasMore=computed(()=>visible.value.length<filtered.value.length);
let scrollObserver:IntersectionObserver|undefined,resizeObserver:ResizeObserver|undefined;
function updateColumns(){if(grid.value)columns.value=getComputedStyle(grid.value).gridTemplateColumns.split(' ').length;}
function loadMore(){if(hasMore.value&&!document.hidden&&!dialog.value?.open)rows.value+=2;}
onMounted(()=>{
  updateColumns();
  resizeObserver=new ResizeObserver(updateColumns);
  if(grid.value)resizeObserver.observe(grid.value);
  scrollObserver=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))loadMore();},{rootMargin:'0px 0px 240px 0px'});
  if(loadTrigger.value)scrollObserver.observe(loadTrigger.value);
});
watch(grid,(next,previous)=>{if(previous)resizeObserver?.unobserve(previous);if(next){updateColumns();resizeObserver?.observe(next);}},{flush:'post'});
watch(loadTrigger,(next,previous)=>{if(previous)scrollObserver?.unobserve(previous);if(next)scrollObserver?.observe(next);},{flush:'post'});
onUnmounted(()=>{scrollObserver?.disconnect();resizeObserver?.disconnect();});
const selected=computed(()=>chosen.value.map(id=>lookById(id)!));
const groups=[{name:'服装',tags:garmentTags},{name:'颜色',tags:colorTags},{name:'材质与细节',tags:detailTags}];
const failed=ref(new Set<string>()), retry=ref(0), fullFailed=ref(false);
const expanded=ref<Record<string,boolean>>({'服装':true});
const dialog=ref<HTMLDialogElement|null>(null), preview=ref<LibraryLook|null>(null);
const label=(tag:string)=>english.value?tag:tagLabels[tag]??tag;
const seasonLabel=(season:string)=>english.value?({春:'Spring',夏:'Summer',秋:'Autumn',冬:'Winter'}[season]??season):`${season}装`;
const title=(item:LibraryLook)=>lookTitle(item,english.value);
watch([search,selectedSeasons,selectedTags,onlyChosen],async()=>{
  rows.value=4;randomized.value=null;
  await nextTick();
  const heading=document.getElementById('looks-heading');
  if(heading&&heading.getBoundingClientRect().top<100)heading.scrollIntoView({block:'start',behavior:'instant'});
});
async function randomize(){
  randomized.value=shuffleLooks(filtered.value);rows.value=4;message.value='';
  await nextTick();
  const heading=document.getElementById('looks-heading');
  if(heading&&heading.getBoundingClientRect().top<100)heading.scrollIntoView({block:'start',behavior:'instant'});
}
function toggle(values:string[],value:string){return values.includes(value)?values.filter(item=>item!==value):[...values,value];}
function select(id:string){
  if(chosen.value.length===MAX_GARMENTS&&!chosen.value.includes(id)){message.value=t('最多选择6套，请先移除一套。');return;}
  chosen.value=toggleLook(chosen.value,id);message.value='';
}
function clearFilters(){search.value='';selectedSeasons.value=[];selectedTags.value=[];onlyChosen.value=false;}
async function openPreview(item:LibraryLook){preview.value=item;fullFailed.value=false;await nextTick();dialog.value?.showModal();}
function closePreview(){dialog.value?.close();}
function goCreate(ids=chosen.value){if(!ids.length)return;closePreview();void router.push({path:'/studio',query:{looks:ids.join(',')}});}
function imageFailed(id:string){failed.value=new Set([...failed.value,id]);}
function retryImage(id:string){const next=new Set(failed.value);next.delete(id);failed.value=next;retry.value++;}
</script>

<template>
  <main :class="s.page">
    <section :class="s.intro" aria-labelledby="library-title">
      <div :class="s.introCopy"><p :class="s.eyebrow">{{t('衣装灵感')}} <span>／ LOOKBOOK</span></p><h1 id="library-title">{{t('下一套，')}}<br/>{{t('换个想象。')}}</h1><p>{{t('从喜欢的衣装开始，让灵感走进画面。')}}<br/>{{t('挑选参考图，带入创作空间试穿。')}}</p><a href="#looks-heading" :class="s.explore">{{t('探索全部衣装')}} <span>↓</span></a></div>
      <div :class="s.editorial" :aria-label="t('四季衣装精选')"><div v-for="(id,index) in ['SPR-0007','AUT-0001','WIN-0001']" :key="id" :class="s.editorialLook"><button type="button" :aria-label="`${t('预览衣装')} ${id}`" @click="openPreview(lookById(id)!)"><img :src="lookImage(id)" alt="" fetchpriority="high"/><span>{{['SPRING','AUTUMN','WINTER'][index]}}</span></button></div><p>{{t('四季衣装，自由入镜。')}} <span>✳</span></p></div>
    </section>
    <div :class="s.library">
      <aside :class="s.filters" :aria-label="t('筛选衣装')">
        <div :class="s.filterHeading"><h2>{{t('筛选衣装')}}</h2><button type="button" @click="clearFilters">{{t('重置')}}</button></div>
        <p :class="s.filterNote">{{t('季节可多选，标签需同时满足。')}}</p>
        <fieldset><legend>{{t('季节')}}</legend><div :class="s.seasons"><button v-for="season in seasons" :key="season" type="button" :aria-pressed="selectedSeasons.includes(season)" @click="selectedSeasons=toggle(selectedSeasons,season)">{{seasonLabel(season)}}<span>{{libraryLooks.filter(item=>item.season===season).length}}</span></button></div></fieldset>
        <fieldset v-for="group in groups" :key="group.name"><legend>{{t(group.name)}}</legend><details :class="s.tagDetails" :open="expanded[group.name]" @toggle="event=>expanded[group.name]=(event.target as HTMLDetailsElement).open"><summary>{{t(expanded[group.name]?'收起标签':'展开全部标签')}}</summary><div :class="s.tags"><button v-for="tag in group.tags" :key="tag" type="button" :aria-pressed="selectedTags.includes(tag)" @click="selectedTags=toggle(selectedTags,tag)">{{label(tag)}}</button></div></details></fieldset>
        <p :class="s.sourceNote">{{t('图片用作换装参考，非实际生成效果。')}}</p>
      </aside>
      <section :class="s.results" aria-labelledby="looks-heading">
        <div :class="s.toolbar"><div><h2 id="looks-heading">{{t(onlyChosen?'已选衣装':randomized?'随机衣装':'全部衣装')}} <span>{{filtered.length}}</span></h2><p>{{t('找到心动的一套，再让它出现在你身上。')}}</p></div><div :class="s.browseActions"><button type="button" :class="s.randomButton" :disabled="!filtered.length" :title="t('按当前筛选随机展示四行衣装')" @click="randomize"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 6h3c4 0 8 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 4-3 6-6s4-6 6-6h3m-4-4 4 4-4 4"/></svg>{{t('随机一组')}}</button><label :class="s.search"><span aria-hidden="true">⌕</span><input v-model="search" type="search" :aria-label="t('搜索衣装')" :placeholder="t('搜索颜色、服装或编号')"/></label></div></div>
        <div v-if="selectedSeasons.length||selectedTags.length||search||onlyChosen" :class="s.applied"><span>{{t('正在筛选')}}</span><button v-for="season in selectedSeasons" :key="season" @click="selectedSeasons=toggle(selectedSeasons,season)">{{seasonLabel(season)}} ×</button><button v-for="tag in selectedTags" :key="tag" @click="selectedTags=toggle(selectedTags,tag)">{{label(tag)}} ×</button><button v-if="onlyChosen" @click="onlyChosen=false">{{t('只看已选')}} ×</button><button @click="clearFilters">{{t('清空条件')}}</button></div>
        <div v-if="visible.length" ref="grid" :class="s.grid">
          <article v-for="item in visible" :key="item.id" :class="[s.card,{[s.selected]:chosen.includes(item.id)}]" :data-look="item.id">
            <div :class="s.imageWrap"><button :class="s.previewButton" type="button" :aria-label="`${t('预览衣装')} ${item.id}`" @click="openPreview(item)"><img v-if="!failed.has(item.id)" :key="retry" :src="lookImage(item.id)+(retry?'?r='+retry:'')" :alt="`${seasonLabel(item.season)} ${title(item)} ${item.id}`" loading="lazy" width="384" height="576" @error="imageFailed(item.id)"/><span v-else :class="s.imageError">{{t('图片未能加载')}}</span><span :class="s.previewHint">{{t('查看大图')}} ↗</span></button><span :class="s.seasonBadge">{{seasonLabel(item.season)}}</span><button :class="s.selectButton" type="button" :aria-label="`${t(chosen.includes(item.id)?'取消选择':'选择衣装')} ${item.id}`" :aria-pressed="chosen.includes(item.id)" @click="select(item.id)">{{chosen.includes(item.id)?'✓':'+'}}</button><button v-if="failed.has(item.id)" :class="s.retry" @click="retryImage(item.id)">{{t('重新加载')}}</button></div>
            <div :class="s.cardHeading"><h3>{{title(item)}}</h3><span>{{item.id}}</span></div><div :class="s.cardTags"><button v-for="tag in item.tags.slice(0,3)" :key="tag" type="button" :aria-pressed="selectedTags.includes(tag)" @click="selectedTags=toggle(selectedTags,tag)">{{label(tag)}}</button><button type="button" :aria-label="`${t('查看全部标签')} ${item.id}`" @click="openPreview(item)">+{{item.tags.length-3}}</button></div>
          </article>
        </div>
        <div v-else :class="s.empty"><span>✳</span><h3>{{t('还没找到这一套灵感')}}</h3><p>{{t('试着减少几个标签，或换一个搜索词。')}}</p><button :class="s.primary" @click="clearFilters">{{t('查看全部衣装')}}</button></div>
        <div v-if="filtered.length" :class="s.loadProgress"><span role="status">{{t('已展示 {0} / {1} 套').replace('{0}',String(visible.length)).replace('{1}',String(filtered.length))}}</span><div v-if="hasMore" ref="loadTrigger" data-load-more><span>{{t('向下滚动，发现更多衣装')}} ↓</span><button type="button" @click="loadMore">{{t('加载更多衣装')}}</button></div><span v-else>{{t('全部衣装已展示')}}</span></div>
      </section>
    </div>
    <div :class="s.selectionBar" :aria-label="t('已选衣装')"><div :class="s.selectionIntro"><strong>{{t('我的试穿清单')}} <span>{{chosen.length}} / {{MAX_GARMENTS}}</span></strong><span>{{t('选择喜欢的衣装，一起带入创作空间。')}}</span></div><div :class="s.thumbnails"><div v-for="item in selected" :key="item.id"><img :src="lookImage(item.id)" :alt="item.id"/><button type="button" :aria-label="`${t('移除已选')} ${item.id}`" @click="select(item.id)">×</button></div><span v-if="!chosen.length" :class="s.selectionPlaceholder">＋</span></div><button :class="s.textButton" type="button" :aria-pressed="onlyChosen" @click="onlyChosen=!onlyChosen">{{t(onlyChosen?'查看全部':'只看已选')}}</button><button :class="s.textButton" type="button" :disabled="!chosen.length" @click="chosen=[];message=''">{{t('清空')}}</button><button :class="s.primary" :disabled="!chosen.length" @click="goCreate()">{{t('去创作空间试穿')}} <span>↗</span></button><p v-if="message" role="status" :class="s.selectionMessage">{{message}}</p></div>
    <dialog ref="dialog" :class="s.dialog" aria-labelledby="look-preview-title" @click="event=>{if(event.target===dialog)closePreview();}"><div v-if="preview" :class="s.dialogContent"><div :class="s.dialogImage"><img v-if="!fullFailed" :src="lookImage(preview.id,true)+(retry?'?r='+retry:'')" :alt="title(preview)" @error="fullFailed=true"/><div v-else :class="s.previewError" role="alert"><p>{{t('图片未能加载')}}</p><button :class="s.secondary" type="button" @click="fullFailed=false;retry++">{{t('重新加载')}}</button></div></div><div :class="s.dialogInfo"><button :class="s.close" type="button" :aria-label="t('关闭预览')" @click="closePreview">×</button><p :class="s.eyebrow">{{seasonLabel(preview.season)}} ／ {{preview.id}}</p><h2 id="look-preview-title">{{title(preview)}}</h2><p>{{t('把喜欢的风格，穿进下一帧。')}}</p><div :class="s.tags"><button v-for="tag in preview.tags" :key="tag" type="button" :aria-pressed="selectedTags.includes(tag)" @click="selectedTags=toggle(selectedTags,tag);closePreview()">{{label(tag)}}</button></div><p :class="s.sourceNote">{{t('点击标签，发现更多同类衣装。')}}</p><div :class="s.dialogActions"><button :class="s.primary" type="button" :disabled="fullFailed" @click="goCreate([preview.id])">{{t('穿这套，去创作')}} ↗</button><button :class="s.secondary" type="button" :aria-pressed="chosen.includes(preview.id)" @click="select(preview.id)">{{t(chosen.includes(preview.id)?'从清单移除':'加入试穿清单')}}</button><p v-if="message" role="status">{{message}}</p></div></div></div></dialog>
  </main>
</template>
