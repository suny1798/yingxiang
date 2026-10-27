<script setup lang="ts">
import { watchEffect, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { preferences, t } from './preferences';
import s from '../components/site/site.module.css';
import NoticeCenter from './NoticeCenter.vue';
const route = useRoute();
watchEffect(() => {
  document.documentElement.lang = preferences.locale.value === 'en' ? 'en' : 'zh-CN';
  document.documentElement.dataset.theme = preferences.theme.value;
  const title = preferences.locale.value==='en' && route.meta.englishTitle ? route.meta.englishTitle : route.meta.title;
  document.title = `${t(String(title ?? '映想'))} · ${t('映想')}`;
});
onUnmounted(preferences.stop);
const links = [['/', '首页'], ['/pricing', '价格方案'], ['/help', '帮助中心'], ['/privacy', '隐私与使用说明'], ['/terms', '用户协议']];
</script>

<template>
  <div :class="s.site">
    <header :class="s.header"><div :class="s.headerInner">
      <RouterLink to="/" :class="s.brand" aria-label="映想">映想 <span aria-hidden="true">✳</span></RouterLink>
      <nav :class="s.navigation" :aria-label="preferences.locale.value==='en'?'Main navigation':'主要导航'">
        <RouterLink v-for="[path,label] in links" :key="path" :to="path" :class="{[s.navActive]:route.path===path||(path==='/help'&&route.path.startsWith('/help/'))}">{{t(label!)}}</RouterLink>
      </nav>
      <div :class="s.headerActions">
        <button type="button" :class="s.preferenceButton" :aria-label="preferences.locale.value==='en' ? '切换为中文' : 'Switch to English'" @click="preferences.setLocale(preferences.locale.value==='en'?'zh':'en')">{{preferences.locale.value==='en'?'中文':'EN'}}</button>
        <button type="button" :class="s.preferenceButton" :aria-label="preferences.locale.value==='en'?'Switch theme':'切换主题'" @click="preferences.setTheme(preferences.theme.value==='light'?'dark':'light')">{{preferences.theme.value==='light'?'☾':'☀'}}</button>
      </div>
    </div></header>
    <RouterView />
    <footer :class="s.footer"><div><RouterLink to="/" :class="s.footerBrand">映想 <span>✳</span></RouterLink><p>{{t('让想象，在眼前发生。')}}</p></div>
      <nav :aria-label="t('页脚导航')"><RouterLink v-for="[path,label] in links" :key="path" :to="path">{{t(label!)}}</RouterLink></nav>
    </footer>
    <NoticeCenter />
  </div>
</template>
