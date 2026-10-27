<script setup lang="ts">
import { homeScenes as scenes,homeSteps } from '../../lib/public-home';
import { t } from '../preferences';
import HomeShowcase from '../HomeShowcase.vue';
import s from '../../components/site/site.module.css';
import h from '../../components/site/home.module.css';
</script>
<template>
  <main>
    <section :class="h.hero" data-home-hero aria-labelledby="home-title"><HomeShowcase/>
      <div :class="[s.container,h.heroInner]"><div :class="s.heroCopy"><p :class="s.eyebrow"><span :class="s.liveDot"/> {{t(' 映想 · 实时画面创作')}}</p><h1 id="home-title">{{t('让想象，')}}<br><span>{{t('在眼前发生。')}}</span></h1><p :class="s.heroDescription">{{t('支持实时换装、视频换装与实时编辑。')}}<br>{{t('可处理相机画面、已有视频或提示词组合。')}}</p><div :class="s.heroActions"><RouterLink to="/studio" :class="s.primary">{{t('开始实时换装 ')}}<span aria-hidden="true">↗</span></RouterLink><a href="#creation-scenes" :class="s.textLink">{{t('查看创作方式 ')}}<span aria-hidden="true">↓</span></a></div><p :class="s.quiet">{{t('本地预览无需登录。新账号赠一次15秒实时换装。')}}</p><nav :class="h.sceneLinks" :aria-label="t('首页创作入口')"><RouterLink to="/studio">{{t('实时换装')}}</RouterLink><RouterLink to="/studio/video">{{t('视频换装')}}</RouterLink><RouterLink to="/studio/edit">{{t('实时编辑')}}</RouterLink></nav></div></div>
    </section>
    <div id="home-content" :class="s.promiseStrip"><div :class="s.container"><span>{{t('实时相机换装')}}</span><span>{{t('已有视频换装')}}</span><span>{{t('提示词组合编辑')}}</span><span>{{t('云端处理前主动确认')}}</span></div></div>
    <section id="creation-scenes" :class="[s.container,h.scenes]" aria-labelledby="scenes-title"><div :class="[s.sectionHeading,h.scenesIntro]"><div><p :class="s.eyebrow">{{t('创作模式')}}</p><h2 id="scenes-title">{{t('按素材类型')}}<br>{{t('选择创作模式。')}}</h2></div><p>{{t('相机、已有视频与提示词分别对应三种模式。')}}<br>{{t('请根据当前素材选择。')}}</p></div>
      <div :class="h.sceneList"><article v-for="scene in scenes" :key="scene.name" :class="h.sceneFeature"><div :class="h.sceneArt"><img :src="`/assets/home/${scene.image}`" alt="" :width="1672" :height="941" loading="lazy"></div><div :class="h.sceneCopy"><div :class="h.sceneHeading"><h3>{{t(scene.name)}}</h3><span>{{t(scene.tag)}}</span></div><h4>{{t(scene.title)}}</h4><p>{{t(scene.copy)}}</p><div :class="h.cardEnd"><span>{{t(scene.note)}}</span><RouterLink :to="scene.href">{{t(scene.action)}}<span aria-hidden="true">↗</span></RouterLink></div></div></article></div>
    </section>
    <section id="how-it-works" :class="[s.container,s.how,h.how]"><div :class="s.sectionHeading"><div><p :class="s.eyebrow">{{t('使用流程')}}</p><h2>{{t('三步完成一次创作')}}</h2></div><p>{{t('选择模式并准备素材，确认云端处理后开始生成。')}}</p></div><div :class="s.steps"><article v-for="[number,title,copy,tag] in homeSteps" :key="number" :class="s.step"><div :class="s.stepTop"><span>{{number}}</span><span>{{t(tag)}}</span></div><h3>{{t(title)}}</h3><p>{{t(copy)}}</p></article></div></section>
    <section :class="[s.container,h.ownership]" aria-labelledby="ownership-title"><div><p :class="s.eyebrow">{{t('数据与权限')}}</p><h2 id="ownership-title">{{t('本地预览、云端处理与作品保存')}}</h2></div><div :class="h.principles"><p><strong>{{t('先预览，再确认')}}</strong><span>{{t('本机相机预览不上传。确认开始后，才连接云端处理。')}}</span></p><p><strong>{{t('镜像与下载')}}</strong><span>{{t('换装支持镜像，下载方向与当前展示保持一致。')}}</span></p><p><strong>{{t('自动保存')}}</strong><span>{{t('生成视频与服装参考图自动保存到我的作品，不采集音频。')}}</span></p><RouterLink to="/privacy">{{t('隐私与使用说明 ')}}<span aria-hidden="true">↗</span></RouterLink></div></section>
    <section :class="[s.container,s.finalCta]"><div><p :class="s.eyebrow">{{t('免费体验')}}</p><h2>{{t('新账号可免费体验一次实时换装')}}</h2><p>{{t('每次15秒，从生成画面开始播放后计时。三档积分方案长期有效，当前仅支持沙盒测试购买。')}}</p></div><RouterLink to="/studio" :class="s.primary">{{t('进入创作空间 ')}}<span aria-hidden="true">↗</span></RouterLink></section>
  </main>
</template>
