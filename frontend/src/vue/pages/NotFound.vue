<script setup lang="ts">
import { t, preferences } from '../preferences';
import s from '../../components/site/support.module.css';
</script>
<template><main :class="s.page"><p>404</p><h1>{{preferences.locale.value==='en'?'Page not found':'页面不存在'}}</h1><RouterLink to="/terms">{{t('用户协议')}} ↗</RouterLink></main></template>
