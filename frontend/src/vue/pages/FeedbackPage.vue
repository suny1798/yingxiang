<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { buildFeedbackReport, feedbackCategories as categories } from '../../lib/public-feedback';
import { notify } from '../../lib/notices';
import { preferences, t } from '../preferences';
import s from '../../components/site/support.module.css';
const { locale } = preferences;
const say = (zh:string,en:string) => locale.value==='en'?en:zh;
const category = ref('connection'), report = ref('');
const copying = ref(false), preview = ref<HTMLElement|null>(null);
const scenes = ['实时换装','视频换装','实时编辑','账号与支付','其他页面'];
const sceneValues = ['Live try-on / 实时换装','Video try-on / 视频换装','Live editing / 实时编辑','Account & payments / 账号与支付','Other pages / 其他页面'];
function reset() { category.value='connection'; report.value=''; }
async function prepare(event: Event) {
  const output=buildFeedbackReport(category.value,Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement)),locale.value);
  if (output===null) { notify(say('请填写问题标题和具体情况。','Please enter a title and describe what happened.'),'error'); return; }
  report.value=output; await nextTick(); preview.value?.focus();
}
async function copyReport() {
  copying.value=true;
  try {
    await navigator.clipboard.writeText(report.value);
    notify(say('报告已复制，请交给项目维护者；尚未在线提交。','Report copied. Share it with your project contact; it has not been submitted online.'),'success');
  } catch {
    notify(say('无法访问剪贴板，请下载报告，或选中下方文字手动复制。','Clipboard unavailable. Download the report or select the text below to copy it manually.'),'error');
  } finally { copying.value=false; }
}
function downloadReport() {
  const url=URL.createObjectURL(new Blob(['\uFEFF',report.value],{type:'text/plain;charset=utf-8'}));
  const link=document.createElement('a'); link.href=url;
  link.download=`yingxiang-feedback-${new Date().toISOString().slice(0,10)}.txt`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  notify(say('已发起报告下载，文件未上传至服务器。','Report download started. The file was not uploaded to a server.'),'success');
}
</script>

<template>
  <main :class="s.page">
    <header :class="s.header"><p :class="s.eyebrow">{{say('映想 · 问题反馈','Yingxiang · Feedback')}}</p><h1>{{say('整理问题反馈','Prepare feedback')}}</h1><p>{{say('描述问题或建议，整理成报告后复制或下载，交给项目维护者。','Describe an issue or suggestion, then copy or download the report to share with your project contact.')}}</p></header>
    <div :class="s.layout">
      <aside :class="s.aside"><h2>{{say('先排查常见问题','Check common questions first')}}</h2><RouterLink to="/help">{{say('排查常见问题 ↗','Troubleshoot common issues ↗')}}</RouterLink><RouterLink to="/account/usage">{{say('核对使用记录 ↗','Review usage records ↗')}}</RouterLink><RouterLink to="/account/orders">{{say('查看沙盒订单 ↗','View sandbox orders ↗')}}</RouterLink><p>{{say('生成结果未知时，请先查历史记录，避免反复点击产生新任务。','If a generation outcome is unknown, check your history before starting another task.')}}</p><h2>{{say('不要提供敏感信息','Do not include sensitive information')}}</h2><p>{{say('不需要密码、验证码、API 密钥或支付卡号。截图请遮住个人信息；人物照片与视频无需随报告提供。','Never include passwords, verification codes, API keys, or card numbers. Redact screenshots; personal photos and videos are not needed for this report.')}}</p><RouterLink to="/privacy">{{t('隐私与使用说明')}} ↗</RouterLink></aside>
      <div :class="s.panel">
        <div :class="s.notice"><strong>{{say('报告仅在本地生成','The report is prepared locally')}}</strong><p>{{say('当前内测尚未接入在线反馈接收渠道。填写后可预览、复制或下载报告，再交给邀请你体验的项目维护者；这里不会自动发送或建立工单。','Online feedback delivery is not connected during this test. Preview, copy, or download your report and share it with the project contact who invited you. This page does not send reports or create tickets.')}}</p></div>
        <form :class="s.form" @submit.prevent="prepare" @input="report=''" @reset="reset">
          <div :class="s.field"><fieldset><legend>{{say('反馈类型','Feedback type')}}</legend><div :class="s.options"><button v-for="item in categories" :key="item[0]" type="button" :class="s.option" :aria-pressed="category===item[0]" @click="category=item[0];report=''">{{locale==='en'?item[2]:item[1]}}</button></div></fieldset></div>
          <div :class="s.row">
            <div :class="s.field"><label for="feedback-scene">{{say('所在功能','Feature')}}</label><select id="feedback-scene" name="scene"><option v-for="(label,index) in scenes" :key="label" :value="sceneValues[index]">{{index<3?t(label):say(label,['Account & payments','Other pages'][index-3]!)}}</option></select></div>
            <div :class="s.field"><label for="feedback-reference">{{say('发生时间 / 相关编号（选填）','Time / reference (optional)')}}</label><input id="feedback-reference" name="reference" :maxlength="160" :placeholder="say('例如：今天 14:20，任务编号…','e.g. Today at 14:20, task reference…')"></div>
          </div>
          <div :class="s.field"><label for="feedback-summary">{{say('问题标题（必填）','Issue title (required)')}}</label><input id="feedback-summary" name="summary" required :maxlength="100" :placeholder="say('例如：生成完成后，下载方向和预览不同','e.g. The downloaded video faces a different direction from the preview')"></div>
          <div :class="s.field"><label for="feedback-details">{{say('问题描述与复现步骤（必填）','Issue description and steps to reproduce (required)')}}</label><textarea id="feedback-details" name="details" required :maxlength="3000" :placeholder="say('你依次做了什么？在哪一步出现问题？页面显示了什么提示？\n如果是建议，描述你想完成的事情就好。','What did you do, in order? At which step did it go wrong? What did the page say?\nFor suggestions, describe what you would like to achieve.')"></textarea><small>{{say('最多 3,000 字。请保留完整错误提示，去掉其中的个人信息。','Up to 3,000 characters. Include the error message, with personal details removed.')}}</small></div>
          <div :class="s.row"><div :class="s.field"><label for="feedback-environment">{{say('浏览器与系统（选填）','Browser & OS (optional)')}}</label><input id="feedback-environment" name="environment" :maxlength="160" :placeholder="say('例如：Chrome，Windows 11','e.g. Chrome, Windows 11')"></div><div :class="s.field"><label for="feedback-expected">{{say('你希望怎样？（选填）','What did you expect? (optional)')}}</label><input id="feedback-expected" name="expected" :maxlength="300" :placeholder="say('你期望出现的结果','The result you expected')"></div></div>
          <div :class="s.actions"><button :class="s.primary" type="submit">{{say('生成反馈报告','Generate feedback report')}} <span aria-hidden="true">↗</span></button><button :class="s.secondary" type="reset">{{say('清空','Clear')}}</button></div>
        </form>
        <section v-if="report" ref="preview" :class="s.result" :tabindex="-1" :aria-label="say('反馈报告预览','Feedback report preview')"><h2>{{say('反馈报告已生成，尚未发送。','The feedback report has been generated but not sent.')}}</h2><p>{{say('请检查内容，再复制或下载交给项目维护者。修改上方内容后，需要重新整理报告。','Review it, then copy or download it to share with your project contact. After changing the form, prepare a new report.')}}</p><pre :class="s.report">{{report}}</pre><div :class="s.actions"><button type="button" :class="s.primary" :disabled="copying" @click="copyReport">{{say('复制报告','Copy report')}}</button><button type="button" :class="s.secondary" @click="downloadReport">{{say('下载文本','Download text')}}</button></div></section>
      </div>
    </div>
  </main>
</template>
