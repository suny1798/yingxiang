<script setup lang="ts">
import { computed,nextTick,ref,watch } from 'vue';
import { useAccountView } from '../use-account';
import { useWorksIndex } from '../use-works-index';
import { useFrameTools } from '../use-frame-tools';
import { useOrientedDownload } from '../use-oriented-download';
import { sessionScope } from '../runtime';
import { preferences,t } from '../preferences';
import StudioIcon from '../StudioIcon.vue';
import MediaTools from '../MediaTools.vue';
import MirrorButton from '../MirrorButton.vue';
import WorkPrompts from '../WorkPrompts.vue';
import type { WorkItem } from '../../lib/api-schema';
import type { WorkChange,WorkKind,WorkSort } from '../works-index';
import { notify } from '../../lib/notices';
import s from '../../components/site/works-page.module.css';
const kinds={all:'全部作品',realtime:'实时换装',video:'视频换装',edit:'实时编辑'} as const;
const states={capturing:'正在生成并保存',waiting:'生成中',saving:'后台保存中',ready:'已保存',failed:'保存未完成'} as const;
const kindEntries=Object.entries(kinds) as Array<[WorkKind,string]>;
const {state,index}=useWorksIndex(),{snapshot}=useAccountView();
const account=computed(()=>snapshot.value.account),owner=computed(()=>account.value?.user?.id??null);
const list=computed(()=>state.value.owner===owner.value?state.value.list:null);
const hasFilters=computed(()=>Boolean(state.value.query||state.value.favoritesOnly));
const emptyTitle=computed(()=>hasFilters.value?'没有找到匹配的作品。':state.value.kind==='all'?'暂无作品':'这个分类暂无作品。');
const emptyDetail=computed(()=>hasFilters.value?(state.value.favoritesOnly&&!state.value.query?'当前分类没有已收藏作品，可取消“仅看收藏”后查看全部。':'请尝试其他名称，或清除搜索与收藏条件。'):'完成一次创作后，生成视频与使用的服装参考图会显示在这里。');
const date=(value:string)=>new Intl.DateTimeFormat(preferences.locale.value==='en'?'en-US':'zh-CN',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
function safeName(value:string){return value.replace(/[<>:"/\\|?*]+/g,'_').replace(/\s+/g,' ').trim();}
function fileStamp(value:string){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));const pick=(type:string)=>parts.find(part=>part.type===type)?.value??'';return `${pick('year')}${pick('month')}${pick('day')}-${pick('hour')}${pick('minute')}`;}
function fileStem(){const item=selected.value;if(!item)return '映想-作品';const kind=kinds[item.kind],name=safeName(item.title)||kind;return `${name===kind?kind:`${name}-${kind}`}-${fileStamp(item.createdAt)}`;}
async function downloadReference(){
  const ref=largeReference.value;if(!ref||referenceBusy.value)return;
  referenceBusy.value=true;
  try{
    const response=await fetch(ref.url,{cache:'no-store'});
    if(!response.ok)throw new Error();
    const blob=await response.blob();
    const extension=blob.type==='image/jpeg'?'jpg':blob.type==='image/webp'?'webp':'png';
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`${fileStem()}-服装参考图-${referenceIndex.value+1}.${extension}`;
    document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);
    notify(t('已下载服装参考图。'),'success');
  }catch{notify(t('图片下载未完成，请稍后重试。'),'error');}
  finally{referenceBusy.value=false;}
}
const creatorHref=()=>state.value.kind==='video'?'/studio/video':'/studio';
const selected=ref<WorkItem|null>(null),dialog=ref<HTMLDialogElement|null>(null),player=ref<HTMLElement|null>(null),playerVideo=ref<HTMLVideoElement|null>(null);
const title=ref(''),confirmDelete=ref(false),referenceIndex=ref(0),playbackError=ref(false),mediaReady=ref(false),referenceOpen=ref(false),referenceBusy=ref(false);
const {snapshot:frame,toggleMirror,toggleFullscreen,capture}=useFrameTools({stage:()=>player.value,video:()=>playerVideo.value,stem:()=>fileStem(),mirrored:false});
const {busy:downloadBusy,download,cancel:cancelDownload}=useOrientedDownload(()=>selected.value?.contentUrl??null,()=>fileStem(),()=>owner.value);
const busy=computed(()=>state.value.detailBusy||downloadBusy.value),saving=computed(()=>Boolean(selected.value&&['capturing','waiting','saving'].includes(selected.value.state)));
const largeReference=computed(()=>{const references=selected.value?.references??[];return references[Math.min(referenceIndex.value,references.length-1)]??null;});
const referenceText=computed(()=>selected.value?.kind==='edit'?'本次使用提示词创作，没有服装参考图。':'这件作品没有留存服装参考图。');
const deleteText=computed(()=>selected.value?.kind==='edit'?'删除这件作品的视频和全部提示词记录？此操作无法恢复。':'删除这件作品的视频和全部参考图？此操作无法恢复。');
function openLogin(){sessionScope.state.loginOpen=true;}
function onSearch(event:Event){index.setSearchInput((event.target as HTMLInputElement).value);}
function onSort(event:Event){index.setSort((event.target as HTMLSelectElement).value as WorkSort);}
function toggleFavorite(item:WorkItem){void index.toggleFavorite(item);}
function open(item:WorkItem){selected.value=item;title.value=item.title;referenceIndex.value=0;playbackError.value=false;mediaReady.value=false;confirmDelete.value=false;referenceOpen.value=false;}
function close(){cancelDownload();referenceOpen.value=false;dialog.value?.close();selected.value=null;confirmDelete.value=false;}
function onCancel(event:Event){event.preventDefault();close();}
function onClosed(){selected.value=null;referenceOpen.value=false;}
function playbackFailed(){mediaReady.value=false;playbackError.value=true;}
function reloadPlayback(){playbackError.value=false;mediaReady.value=false;}
async function change(body:WorkChange){const item=selected.value;if(!item||busy.value)return;const result=await index.change(item.id,body);if(!result)return;if('action' in body&&body.action==='delete'){close();return;}if('id' in result){selected.value=result;title.value=result.title;}}
function rename(){const value=title.value.trim();if(!value||value===selected.value?.title)return;void change({title:value});}
function removeWork(){void change({action:'delete'});}
function retry(){void change({action:'retry'});}
function favoriteSelected(){if(selected.value)void index.toggleFavorite(selected.value);}
watch(selected,async value=>{if(!value)return;await nextTick();if(dialog.value&&!dialog.value.open)dialog.value.showModal();});
watch(()=>state.value.list,value=>{if(!value||!selected.value)return;const item=value.items.find(entry=>entry.id===selected.value!.id);if(item)selected.value=item;});
</script>
<template>
  <main :class="s.page">
    <header :class="s.heading"><div><p>{{t('映想 · 作品存档')}}</p><h1>{{t('我的作品')}}<span aria-hidden="true">✳</span></h1><p>{{t('查看已保存的视频、服装参考图与提示词记录。')}}</p></div><RouterLink to="/studio" :class="s.primary">{{t('继续创作')}}<span aria-hidden="true">↗</span></RouterLink></header>
    <div :class="s.toolbar"><div role="group" :aria-label="t('作品分类')"><button v-for="[key,label] in kindEntries" :key="key" type="button" :aria-pressed="state.kind===key" @click="index.setKind(key)">{{t(label)}}</button></div><span>{{t('生成视频与服装参考图自动保存')}}</span></div>
    <div v-if="owner" :class="s.indexBar"><form :class="s.search" role="search" @submit.prevent="index.submitSearch()"><StudioIcon name="search"/><input type="search" :value="state.searchInput" maxlength="60" :aria-label="t('按作品名称搜索')" :placeholder="t('搜索作品名称…')" @input="onSearch"/><button type="submit">{{t('搜索')}}</button><button v-if="state.query" type="button" :class="s.clearSearch" @click="index.clearSearch()">{{t('清除')}}</button></form><div :class="s.indexActions"><label :class="s.sort"><StudioIcon name="sort"/><span :class="s.visuallyHidden">{{t('作品排序')}}</span><select :aria-label="t('作品排序')" :value="state.sort" @change="onSort"><option value="newest">{{t('最新创建')}}</option><option value="oldest">{{t('最早创建')}}</option><option value="title">{{t('按名称排序')}}</option></select></label><button type="button" :class="s.favoritesFilter" :aria-pressed="state.favoritesOnly" @click="index.toggleFavorites()"><StudioIcon name="star"/>{{t('仅看收藏')}}</button></div></div>
    <div v-if="!account&&!snapshot.error" :class="s.empty" role="status">{{t('正在读取账号…')}}</div>
    <div v-else-if="!owner" :class="s.empty"><span aria-hidden="true">✳</span><h2>{{t('登录后查看作品')}}</h2><p>{{t(snapshot.error??'作品按账号独立保存，登录后可回放和下载。')}}</p><button type="button" :class="s.primary" @click="openLogin">{{t('登录 / 注册')}}</button></div>
    <div v-else-if="state.loading&&!list" :class="s.empty" role="status">{{t('正在整理你的作品…')}}</div>
    <div v-else-if="state.error&&!list" :class="s.empty" role="alert"><h2>{{t('暂时无法读取作品')}}</h2><p>{{t(state.error)}}</p><button type="button" :class="s.primary" @click="index.refresh()">{{t('重新加载')}}</button></div>
    <div v-else-if="!list?.total" :class="s.empty"><span :class="s.emptyFrame" aria-hidden="true">{{hasFilters?'✳':'▷'}}</span><h2>{{t(emptyTitle)}}</h2><p>{{t(emptyDetail)}}</p><button v-if="hasFilters" type="button" :class="s.primary" @click="index.clearFilters()">{{t('清除筛选条件')}}</button><RouterLink v-else :class="s.primary" :to="creatorHref()">{{t('进入创作空间')}} ↗</RouterLink></div>
    <template v-else>
      <div :class="s.collectionHeading"><span>{{t(hasFilters?'筛选结果':state.sort==='title'?'按名称浏览':state.sort==='oldest'?'从最早开始':'最近创作')}}</span><span>{{list.total}} {{t('件作品')}}</span></div>
      <p v-if="state.error" :class="s.error" role="alert">{{t(state.error)}} <button type="button" @click="index.refresh()">{{t('刷新')}}</button></p>
      <div :class="s.grid"><article v-for="item in list.items" :key="item.id" :class="s.card">
        <button type="button" :class="s.preview" :aria-label="`${t('查看作品')}：${item.title}`" @click="open(item)">
          <video v-if="item.contentUrl" :src="`${item.contentUrl}#t=0.1`" muted playsinline preload="metadata" aria-hidden="true"/>
          <div v-else :class="s.pending"><span aria-hidden="true">{{item.state==='failed'?'!':'✳'}}</span><span>{{t(states[item.state])}}</span></div>
          <span :class="s.badge">{{t(kinds[item.kind])}}</span><span v-if="item.contentUrl" :class="s.play" aria-hidden="true">▷</span><span :class="s.length">{{item.seconds>0?`${item.seconds.toFixed(2)}s`:'—'}}</span>
        </button>
        <button type="button" :class="[s.favoriteButton,s.cardFavorite]" :aria-label="t(item.favorite?'取消收藏':'收藏作品')" :aria-pressed="item.favorite" :title="t(item.favorite?'取消收藏':'收藏作品')" :disabled="state.favoriteBusy!==null" @click="toggleFavorite(item)"><StudioIcon name="star"/><span :class="s.favoriteLabel">{{t(item.favorite?'已收藏':'收藏')}}</span></button>
        <div :class="s.cardBody"><div :class="s.title"><button type="button" class="work-card-title" @click="open(item)">{{item.title}}</button><span :data-state="item.state">{{t(states[item.state])}}</span></div><time :datetime="item.createdAt">{{date(item.createdAt)}}</time>
          <div :class="s.references"><div><img v-for="ref in item.references.slice(0,4)" :key="ref.id" :src="ref.url" alt="" loading="lazy"/></div><span>{{item.references.length?`${t('服装参考')} · ${item.references.length}`:t(item.kind==='edit'?'提示词创作':'暂无服装参考图')}}</span><button type="button" @click="open(item)">{{t('查看')}} ↗</button></div>
        </div>
      </article></div>
      <nav :class="s.pagination" :aria-label="t('作品分页')"><button type="button" :disabled="list.page===1" @click="index.setPage(list.page-1)">{{t('上一页')}}</button><span>{{list.page}} / {{list.pages}}</span><button type="button" :disabled="list.page===list.pages" @click="index.setPage(list.page+1)">{{t('下一页')}}</button></nav>
    </template>
    <p :class="s.footnote">{{t('保存完成的作品可随时回看；仅当前账号可访问，删除后将移除本站保存的文件。')}}</p>
    <dialog v-if="selected" ref="dialog" :class="s.dialog" aria-labelledby="work-title" @cancel="onCancel" @close="onClosed">
      <div :class="s.dialogHeading"><div><p>{{t(kinds[selected.kind])}} · {{date(selected.createdAt)}}</p><h2 id="work-title">{{selected.title}}</h2></div><button type="button" :aria-label="t('关闭作品详情')" @click="close">×</button></div>
      <div :class="s.detailGrid">
        <div ref="player" data-preview-stage :class="s.player">
          <video v-if="selected.contentUrl&&!playbackError" ref="playerVideo" :key="selected.id" :src="selected.contentUrl" :data-mirrored="frame.mirrored" controls controlsList="nodownload" playsinline preload="metadata" :aria-label="t('作品视频')" @loadeddata="mediaReady=true" @error="playbackFailed"/>
          <div v-else :class="s.pending"><span aria-hidden="true">{{selected.state==='failed'||playbackError?'!':'✳'}}</span><h3>{{t(playbackError?'视频暂时无法播放':states[selected.state])}}</h3><button v-if="playbackError" type="button" @click="reloadPlayback">{{t('重新加载')}}</button></div>
          <MediaTools :fullscreen="frame.fullscreen" :supported="frame.supported" :capturing="frame.capturing" :disabled="!mediaReady||playbackError" @fullscreen="toggleFullscreen" @capture="capture"/>
        </div>
        <WorkPrompts v-if="selected.kind==='edit'&&owner" :key="selected.id" :id="selected.id" :owner="owner" :saving="saving"/>
        <aside v-else :class="s.referencePanel"><h3>{{t('服装参考')}}<span>{{selected.references.length}}</span></h3>
          <template v-if="largeReference"><button type="button" :class="s.referenceLargeButton" :aria-label="t('查看服装参考图大图')" @click="referenceOpen=true"><img :class="s.referenceLarge" :src="largeReference.url" :alt="t('本次使用的服装参考图')"/></button><div v-if="selected.references.length>1" :class="s.referenceChoices" role="group" :aria-label="t('选择服装参考图')"><button v-for="(ref,index) in selected.references" :key="ref.id" type="button" :aria-pressed="index===referenceIndex" @click="referenceIndex=index"><img :src="ref.url" alt=""/></button></div></template>
          <p v-else>{{t(referenceText)}}</p>
        </aside>
      </div>
      <p v-if="selected.message" :class="s.detailMessage" role="status">{{t(selected.message)}}</p>
      <div :class="s.detailsMeta"><span>{{t(states[selected.state])}} · {{selected.extension.toUpperCase()}}{{selected.bytes>0?` · ${(selected.bytes/1024/1024).toFixed(1)} MB`:''}}</span><div>
        <button v-if="selected.canRetry" type="button" :class="s.secondary" :disabled="busy" @click="retry">{{t('重试保存')}}</button>
        <button type="button" :class="[s.favoriteButton,s.detailFavorite]" :aria-label="t(selected.favorite?'取消收藏':'收藏作品')" :aria-pressed="selected.favorite" :disabled="state.favoriteBusy!==null" @click="favoriteSelected"><StudioIcon name="star"/><span>{{t(selected.favorite?'已收藏':'收藏')}}</span></button>
        <template v-if="selected.contentUrl"><MirrorButton :mirrored="frame.mirrored" :disabled="downloadBusy" @toggle="toggleMirror"/><button type="button" :class="s.primary" @click="downloadBusy?cancelDownload():download(frame.mirrored)">{{t(downloadBusy?'取消导出':'下载视频')}} ↓</button></template>
      </div></div>
      <form :class="s.rename" @submit.prevent="rename"><label for="work-name">{{t('作品名称')}}</label><input id="work-name" v-model="title" maxlength="60" required :disabled="busy"/><button type="submit" :class="s.secondary" :disabled="busy||!title.trim()||title.trim()===selected.title">{{t('保存名称')}}</button></form>
      <div :class="s.deleteArea"><template v-if="confirmDelete"><p>{{t(deleteText)}}</p><button type="button" :class="s.secondary" :disabled="busy" @click="confirmDelete=false">{{t('取消')}}</button><button type="button" :class="s.danger" :disabled="busy||downloadBusy" @click="removeWork">{{t(busy?'正在删除…':'确认删除')}}</button></template><button v-else type="button" :class="s.deleteButton" :disabled="busy||downloadBusy||saving" @click="confirmDelete=true">{{t('删除作品')}}</button></div>
      <div v-if="referenceOpen&&largeReference" :class="s.referenceViewer" role="dialog" aria-modal="true" :aria-label="t('服装参考图预览')" @click.self="referenceOpen=false">
        <div :class="s.referenceViewerPanel"><button type="button" :class="s.referenceViewerClose" :aria-label="t('关闭图片预览')" @click="referenceOpen=false">×</button><img :src="largeReference.url" :alt="t('本次使用的服装参考图')"/><div :class="s.referenceViewerActions"><span>{{t('服装参考图')}} · {{referenceIndex+1}} / {{selected.references.length}}</span><button type="button" :class="s.primary" :disabled="referenceBusy" @click="downloadReference">{{t(referenceBusy?'正在下载…':'下载图片')}} ↓</button></div></div>
      </div>
    </dialog>
  </main>
</template>
