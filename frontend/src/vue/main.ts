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
import AdminPage from './pages/AdminPage.vue';
import StudioPage from './pages/StudioPage.vue';
import VideoStudioPage from './pages/VideoStudioPage.vue';
import PromptStudioPage from './pages/PromptStudioPage.vue';
import WorksPage from './pages/WorksPage.vue';
import NotFound from './pages/NotFound.vue';
import { NOT_FOUND_META, PRIVATE_PAGES, PUBLIC_PAGES } from './route-data';
import '../app/globals.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomePage, meta: PUBLIC_PAGES['/'] },
    { path: '/terms', component: TermsPage, meta: PUBLIC_PAGES['/terms'] },
    { path: '/privacy', component: PrivacyPage, meta: PUBLIC_PAGES['/privacy'] },
    { path: '/help', component: HelpPage, meta: PUBLIC_PAGES['/help'] },
    { path: '/help/feedback', component: FeedbackPage, meta: PUBLIC_PAGES['/help/feedback'] },
    { path: '/pricing', component: PricingPage, meta: PUBLIC_PAGES['/pricing'] },
    { path: '/account', component: AccountPage, props:{section:'overview'}, meta:PRIVATE_PAGES['/account'] },
    { path: '/account/usage', component: AccountPage, props:{section:'usage'}, meta:PRIVATE_PAGES['/account/usage'] },
    { path: '/account/orders', component: AccountPage, props:{section:'orders'}, meta:PRIVATE_PAGES['/account/orders'] },
    { path: '/account/security', component: AccountPage, props:{section:'security'}, meta:PRIVATE_PAGES['/account/security'] },
    { path: '/admin', component: AdminPage, meta:PRIVATE_PAGES['/admin'] },
    { path: '/studio', component: StudioPage, meta:PRIVATE_PAGES['/studio'] },
    { path: '/studio/video', component: VideoStudioPage, meta:PRIVATE_PAGES['/studio/video'] },
    { path: '/studio/edit', component: PromptStudioPage, meta:PRIVATE_PAGES['/studio/edit'] },
    { path: '/works', component: WorksPage, meta:PRIVATE_PAGES['/works'] },
    { path: '/:pathMatch(.*)*', component: NotFound, meta: NOT_FOUND_META },
  ],
  scrollBehavior(to, _from, saved) { return saved ?? (to.hash ? { el: to.hash, top: 108 } : { top: 0 }); },
});
createApp(App).use(pinia).use(VueQueryPlugin,{queryClient}).use(router).mount('#app');
