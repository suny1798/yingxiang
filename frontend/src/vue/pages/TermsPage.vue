<script setup lang="ts">
import { sections, type Copy } from '../../lib/public-terms';
import { preferences, t } from '../preferences';
import s from '../../components/site/support.module.css';
const pick = (copy: Copy) => copy[preferences.locale.value === 'en' ? 1 : 0];
</script>

<template>
  <main :class="s.page">
    <header :class="s.header"><p :class="s.eyebrow">{{pick(['映想 · 服务条款', 'Yingxiang · Terms of service'])}}</p><h1>{{t('用户协议')}}</h1>
      <p>{{pick(['本协议说明账号、素材、生成、支付与作品保存规则。','These terms explain the rules for accounts, materials, generation, payments, and saved creations.'])}}</p>
      <div :class="s.meta"><span>{{pick(['内测版 · v1.0','Test version · v1.0'])}}</span><time datetime="2026-10-27">2026-10-27</time></div>
    </header>
    <div :class="s.layout"><aside :class="s.aside"><h2>{{pick(['快速阅读','On this page'])}}</h2>
      <nav :aria-label="pick(['协议目录','Terms contents'])"><a v-for="section in sections" :key="section.id" :href="`#${section.id}`">{{pick(section.title)}}</a></nav>
      <RouterLink to="/privacy">{{t('隐私与使用说明')}} ↗</RouterLink><RouterLink to="/help/feedback">{{t('问题反馈')}} ↗</RouterLink>
    </aside><article :class="s.panel">
      <div :class="s.notice"><strong>{{pick(['开始前，先知道这三件事','Three things to know before starting'])}}</strong>
        <p>{{pick(['相机预览不等于上传；当前支付仅为沙盒；实时换装、视频换装与实时编辑已向登录用户开放。实际生成需要另行确认，并受服务开放和账号权益限制。','Camera preview is not an upload. Payments are sandbox-only. Live try-on, video try-on, and live editing are open to signed-in users. Generation requires a separate confirmation and is subject to availability and account entitlements.'])}}</p>
      </div>
      <section v-for="section in sections" :id="section.id" :key="section.id" :class="s.section"><h2>{{pick(section.title)}}</h2><p v-for="(paragraph,index) in section.paragraphs" :key="index">{{pick(paragraph)}}</p></section>
      <div :class="s.links"><RouterLink to="/privacy">{{t('隐私与使用说明')}} ↗</RouterLink><RouterLink to="/help/feedback">{{t('问题反馈')}} ↗</RouterLink><RouterLink to="/pricing">{{t('价格方案')}} ↗</RouterLink></div>
    </article></div>
  </main>
</template>
