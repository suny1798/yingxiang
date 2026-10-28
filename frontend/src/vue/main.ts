import { createApp } from 'vue';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { pinia,queryClient } from './runtime';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import TermsPage from './pages/TermsPage.vue';
import PrivacyPage from './pages/PrivacyPage.vue';
import HelpPage from './pages/HelpPage.vue';
import FeedbackPage from './pages/FeedbackPage.vue';
import PricingPage from './pages/PricingPage.vue';
import HomePage from './pages/HomePage.vue';
import AccountPage from './pages/AccountPage.vue';
import AdminAccess from './pages/AdminAccess.vue';
import StudioPage from './pages/StudioPage.vue';
import VideoStudioPage from './pages/VideoStudioPage.vue';
import NotFound from './pages/NotFound.vue';
import '../app/globals.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomePage, meta: { title: '映想 — 让想象，在眼前发生。', fullTitle: true } },
    { path: '/terms', component: TermsPage, meta: { title: '用户协议' } },
    { path: '/privacy', component: PrivacyPage, meta: { title: '隐私与使用说明' } },
    { path: '/help', component: HelpPage, meta: { title: '帮助中心' } },
    { path: '/help/feedback', component: FeedbackPage, meta: { title: '问题反馈' } },
    { path: '/pricing', component: PricingPage, meta: { title: '价格方案' } },
    { path: '/account', component: AccountPage, props:{section:'overview'}, meta:{title:'个人中心'} },
    { path: '/account/usage', component: AccountPage, props:{section:'usage'}, meta:{title:'使用记录'} },
    { path: '/account/security', component: AccountPage, props:{section:'security'}, meta:{title:'账号信息'} },
    { path: '/admin', component: AdminAccess, meta:{title:'管理后台'} },
    { path: '/studio', component: StudioPage, meta:{title:'创作空间'} },
    { path: '/studio/video', component: VideoStudioPage, meta:{title:'视频换装'} },
    { path: '/:pathMatch(.*)*', component: NotFound, meta: { title: '页面不存在', englishTitle: 'Page not found' } },
  ],
  scrollBehavior(to, _from, saved) { return saved ?? (to.hash ? { el: to.hash, top: 108 } : { top: 0 }); },
});
createApp(App).use(pinia).use(VueQueryPlugin,{queryClient}).use(router).mount('#app');
