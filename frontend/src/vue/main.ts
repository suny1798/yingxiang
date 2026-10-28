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
    { path: '/:pathMatch(.*)*', component: NotFound, meta: { title: '页面不存在', englishTitle: 'Page not found' } },
  ],
  scrollBehavior(to, _from, saved) { return saved ?? (to.hash ? { el: to.hash, top: 108 } : { top: 0 }); },
});
createApp(App).use(pinia).use(VueQueryPlugin,{queryClient}).use(router).mount('#app');
