<script setup lang="ts">
import { computed } from 'vue';
import { useAccountView } from '../use-account';
import { useWorksIndex } from '../use-works-index';
import { sessionScope } from '../runtime';
import { preferences,t } from '../preferences';
import StudioIcon from '../StudioIcon.vue';
import type { WorkItem } from '../../lib/api-schema';
import type { WorkKind,WorkSort } from '../works-index';
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
const creatorHref=()=>state.value.kind==='video'?'/studio/video':'/studio';
function openLogin(){sessionScope.state.loginOpen=true;}
function onSearch(event:Event){index.setSearchInput((event.target as HTMLInputElement).value);}
function onSort(event:Event){index.setSort((event.target as HTMLSelectElement).value as WorkSort);}
function toggleFavorite(item:WorkItem){void index.toggleFavorite(item);}
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
        <div :class="s.preview">
          <video v-if="item.contentUrl" :src="`${item.contentUrl}#t=0.1`" muted playsinline preload="metadata" aria-hidden="true"/>
          <div v-else :class="s.pending"><span aria-hidden="true">{{item.state==='failed'?'!':'✳'}}</span><span>{{t(states[item.state])}}</span></div>
          <span :class="s.badge">{{t(kinds[item.kind])}}</span><span v-if="item.contentUrl" :class="s.play" aria-hidden="true">▷</span><span :class="s.length">{{item.seconds.toFixed(0)}}s</span>
        </div>
        <button type="button" :class="[s.favoriteButton,s.cardFavorite]" :aria-label="t(item.favorite?'取消收藏':'收藏作品')" :aria-pressed="item.favorite" :title="t(item.favorite?'取消收藏':'收藏作品')" :disabled="state.favoriteBusy!==null" @click="toggleFavorite(item)"><StudioIcon name="star"/><span :class="s.favoriteLabel">{{t(item.favorite?'已收藏':'收藏')}}</span></button>
        <div :class="s.cardBody"><div :class="s.title"><span class="work-card-title">{{item.title}}</span><span :data-state="item.state">{{t(states[item.state])}}</span></div><time :datetime="item.createdAt">{{date(item.createdAt)}}</time>
          <div :class="s.references"><div><img v-for="ref in item.references.slice(0,4)" :key="ref.id" :src="ref.url" alt="" loading="lazy"/></div><span>{{item.references.length?`${t('服装参考')} · ${item.references.length}`:t(item.kind==='edit'?'提示词创作':'暂无服装参考图')}}</span></div>
        </div>
      </article></div>
      <nav :class="s.pagination" :aria-label="t('作品分页')"><button type="button" :disabled="list.page===1" @click="index.setPage(list.page-1)">{{t('上一页')}}</button><span>{{list.page}} / {{list.pages}}</span><button type="button" :disabled="list.page===list.pages" @click="index.setPage(list.page+1)">{{t('下一页')}}</button></nav>
    </template>
    <p :class="s.footnote">{{t('保存完成的作品可随时回看；仅当前账号可访问，删除后将移除本站保存的文件。')}}</p>
  </main>
</template>
<style scoped>
.work-card-title{min-width:0;max-width:70%;color:var(--ink);font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
</style>
