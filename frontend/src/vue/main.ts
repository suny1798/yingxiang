import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import TermsPage from './pages/TermsPage.vue';
import NotFound from './pages/NotFound.vue';
import '../app/globals.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/terms', component: TermsPage, meta: { title: '用户协议' } },
    { path: '/:pathMatch(.*)*', component: NotFound, meta: { title: '页面不存在', englishTitle: 'Page not found' } },
  ],
  scrollBehavior(to, _from, saved) { return saved ?? (to.hash ? { el: to.hash, top: 108 } : { top: 0 }); },
});
createApp(App).use(router).mount('#app');
