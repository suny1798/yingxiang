<script setup lang="ts">
import { watch, watchEffect, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { preferences, t } from './preferences';
import { applyDocumentMeta } from './document-meta';
import type { PageMeta } from './route-data';
import s from '../components/site/site.module.css';
import studio from '../components/studio/studio.module.css';
import NoticeCenter from './NoticeCenter.vue';
import PreferenceControls from './PreferenceControls.vue';
import SiteAnnouncement from './SiteAnnouncement.vue';
import HeaderAccount from './HeaderAccount.vue';
import AccountDialog from './AccountDialog.vue';
import BackToTop from './BackToTop.vue';
import { useAccountView } from './use-account';
import { prefetchCredits } from './use-credits';
import { clearVideoDraft } from './use-local-video-studio';
import { clearGarmentDraft } from './use-garment-media';
import { accountCoordinator,sessionScope } from './runtime';
const {snapshot}=useAccountView(true);
watch(()=>snapshot.value.account?.user?.id??null,id=>{void prefetchCredits(id);},{immediate:true});
const route = useRoute();
watch(()=>[route.path,route.query.from],()=>{
  if(route.path!=='/studio/video'&&!(route.path==='/wardrobe'&&route.query.from==='video'))clearVideoDraft();
  if(route.path!=='/studio'&&!(route.path==='/wardrobe'&&route.query.from==='realtime'))clearGarmentDraft();
},{immediate:true});
onUnmounted(clearVideoDraft);
onUnmounted(clearGarmentDraft);
watchEffect(() => {
  document.documentElement.lang = preferences.locale.value === 'en' ? 'en' : 'zh-CN';
  document.documentElement.dataset.theme = preferences.theme.value;
  applyDocumentMeta(route.meta as unknown as PageMeta, preferences.locale.value);
});
onUnmounted(preferences.stop);
onUnmounted(()=>{void accountCoordinator.dispose().catch(()=>{});});
const links = [['/', '首页'], ['/wardrobe', '衣装灵感'], ['/studio', '创作空间'], ['/works', '我的作品'], ['/pricing', '价格方案'], ['/help', '帮助中心']];
const footerLinks = [['/pricing','价格方案'],['/studio','创作空间'],['/account','个人中心'],['/help','帮助中心'],['/help/feedback','问题反馈'],['/privacy','隐私与使用说明'],['/terms','用户协议']];
const active=(path:string)=>route.path===path||(path!=='/'&&route.path.startsWith(path+'/'));
</script>

<template>
  <div :class="[s.site,{[studio.studio]:route.path.startsWith('/studio')}]" :data-mode="route.path==='/studio'?'realtime':route.path==='/studio/video'?'video':route.path==='/studio/edit'?'prompt':undefined">
    <header :class="s.header"><div :class="s.headerInner">
      <RouterLink to="/" :class="s.brand" :aria-label="t('映想首页')">{{t('映想')}}<span aria-hidden="true">✳</span></RouterLink>
      <nav :class="s.navigation" :aria-label="t('主导航')">
        <RouterLink v-for="[path,label] in links" :key="path" :to="path" :class="{[s.navActive]:active(path!)}" :aria-current="active(path!)?'page':undefined">{{t(label!)}}</RouterLink>
        <RouterLink v-if="snapshot.account?.user?.role==='admin'" to="/admin" :class="{[s.navActive]:active('/admin')}" :aria-current="active('/admin')?'page':undefined">{{t('管理后台')}}</RouterLink>
      </nav>
      <div :class="s.headerActions">
        <PreferenceControls />
        <HeaderAccount />
      </div>
    </div><SiteAnnouncement /></header>
    <RouterView />
    <footer v-if="!route.path.startsWith('/studio')&&route.path!=='/pricing'" :class="s.footer"><div><RouterLink to="/" :class="s.footerBrand">{{t('映想 ')}}<span>✳</span></RouterLink><p>{{t('让想象，在眼前发生。')}}</p></div>
      <nav :aria-label="t('页脚导航')"><RouterLink v-for="[path,label] in footerLinks" :key="path" :to="path">{{t(label!)}}</RouterLink></nav>
      <p :class="s.footerNote">{{t('实时换装 · 视频换装 · 实时编辑')}}<br/>{{t('不采集音频；生成内容自动保存，可随时下载。')}}</p>
    </footer>
    <NoticeCenter />
    <BackToTop />
    <AccountDialog v-if="sessionScope.state.loginOpen" />
  </div>
</template>
