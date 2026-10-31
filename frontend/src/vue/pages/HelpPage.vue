<script setup lang="ts">
import { computed, ref } from 'vue';
import { categories, questions, guides, filterHelpQuestions, type Category } from '../../lib/public-help';
import { t } from '../preferences';
import s from '../../components/site/help-center.module.css';
const query = ref('');
const category = ref<Category>('全部问题');
const results = computed(() => filterHelpQuestions(query.value, category.value, t));
const searching = computed(() => query.value.trim().length > 0);
function reset() { query.value = ''; category.value = '全部问题'; }
function suggest(word: string) { category.value = '全部问题'; query.value = t(word); }
</script>

<template>
  <main :class="s.page">
    <header :class="s.hero">
      <div><p :class="s.eyebrow">{{t('映想使用指南')}}</p><h1>{{t('帮助中心')}}<br><span>{{t('使用指南与常见问题')}}</span></h1><p :class="s.intro">{{t('三种创作模式的操作步骤、素材要求与常见问题均在此页。')}}</p></div>
      <div :class="s.searchPanel"><label for="help-search">{{t('搜索问题')}}</label>
        <div :class="s.search"><span aria-hidden="true">⌕</span><input id="help-search" v-model="query" type="search" :placeholder="t('试试“镜像”“音轨”或“下载”')" aria-controls="help-questions"><button v-if="query" type="button" :aria-label="t('清空搜索')" @click="query=''">×</button></div>
        <div :class="s.suggestions"><span>{{t('常用搜索')}}</span><button v-for="word in ['相机','镜像','音轨','积分']" :key="word" type="button" @click="suggest(word)">{{t(word)}}</button></div>
        <p>{{t('搜索只在本页进行，不会上传你的输入。')}}</p>
      </div>
    </header>
    <section v-if="!searching" aria-labelledby="guide-heading" :class="s.guides">
      <div :class="s.sectionHead"><h2 id="guide-heading">{{t('创作模式快速指南')}}</h2><span>{{t('选择模式查看操作步骤')}}</span></div>
      <div :class="s.guideGrid"><article v-for="guide in guides" :key="guide.href" :class="s.guide">
        <div :class="s.guideTitle"><span aria-hidden="true">{{guide.symbol}}</span><h3>{{t(guide.title)}}</h3><small v-if="guide.href.endsWith('edit')">{{t('已开放')}}</small></div><p>{{t(guide.intro)}}</p>
        <ol><li v-for="step in guide.steps" :key="step">{{t(step)}}</li></ol><RouterLink :to="guide.href">{{t(guide.action)}}<span aria-hidden="true">↗</span></RouterLink>
      </article></div>
    </section>
    <section :class="s.reference" aria-labelledby="questions-heading">
      <aside :class="s.sidebar"><h2 id="questions-heading">{{t('按分类')}}<br>{{t('查找问题')}}</h2>
        <nav :aria-label="t('问题分类')"><button v-for="item in categories" :key="item" type="button" :aria-pressed="category===item" @click="category=item"><span>{{t(item)}}</span><span>{{item==='全部问题'?questions.length:questions.filter(q=>q.category===item).length}}</span></button></nav>
        <RouterLink to="/privacy">{{t('画面与隐私说明 ↗')}}</RouterLink>
      </aside>
      <div id="help-questions" :class="s.questions">
        <div :class="s.resultsHead"><p role="status" aria-live="polite">{{t(searching?`找到 ${results.length} 个相关问题`:`${category} · ${results.length} 个答案`)}}</p><button v-if="searching||category!=='全部问题'" type="button" @click="reset">{{t('重置筛选')}}</button></div>
        <template v-if="results.length"><details v-for="question in results" :key="question.id" :class="s.question">
          <summary>{{t(question.title)}}<span aria-hidden="true">+</span></summary><div :class="s.answer"><p v-for="paragraph in question.answer" :key="paragraph">{{t(paragraph)}}</p><RouterLink v-if="question.href" :to="question.href">{{t(question.link??'')}} ↗</RouterLink></div>
        </details></template>
        <div v-else :class="s.empty"><span aria-hidden="true">⌕</span><h3>{{t('还没找到这个问题')}}</h3><p>{{t('试试更短的关键词，或切换到“全部问题”。')}}<br>{{t('例如搜“下载”，也能找到格式和镜像的说明。')}}</p><button type="button" @click="reset">{{t('查看全部问题')}}</button></div>
      </div>
    </section>
    <section :class="s.support" aria-labelledby="support-heading"><div><p :class="s.eyebrow">{{t('问题反馈')}}</p><h2 id="support-heading">{{t('反馈问题时')}}<br>{{t('请提供完整信息')}}</h2><p>{{t('在反馈页生成问题报告，复制或下载后交给项目维护者。当前不会在线发送或建立工单。')}}</p><RouterLink to="/help/feedback">{{t('整理问题反馈 ↗')}}</RouterLink></div>
      <div :class="s.checklist"><h3>{{t('反馈时请提供以下信息')}}</h3><ul><li>{{t('在哪个功能、进行到哪一步')}}</li><li>{{t('问题出现的时间与完整提示')}}</li><li>{{t('浏览器名称，以及素材时长、大小和格式')}}</li><li>{{t('必要的截图；请遮住个人信息')}}</li></ul><p>{{t('不用提供密码，也不用发送未经同意的人物素材。')}}</p></div>
    </section>
  </main>
</template>
