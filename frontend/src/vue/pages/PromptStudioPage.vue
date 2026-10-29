<script setup lang="ts">
import PreviewControls from '../PreviewControls.vue';
import WorkspacePreview from '../WorkspacePreview.vue';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useAccountView } from '../use-account';
import { useFrameTools } from '../use-frame-tools';
import { useGeneratedRecording } from '../use-generated-recording';
import { usePromptSession } from '../use-prompt-session';
import { sessionScope } from '../runtime';
import { mountPreviewSurface } from '../../lib/media/preview-layout';
import { PROMPT_EXAMPLES, PROMPT_POLICY } from '../../lib/prompt/policy';
import { notify } from '../../lib/notices';
import { t } from '../preferences';
import CameraPreview from '../CameraPreview.vue';
import MediaTools from '../MediaTools.vue';
import MirrorButton from '../MirrorButton.vue';
import StudioIcon from '../StudioIcon.vue';
import StudioModes from '../StudioModes.vue';
import base from '../../components/studio/studio.module.css';
import s from '../../components/studio/prompt-studio.module.css';
const { editor, editorState, snapshot, camera, stream, preview, previewState, remote, remoteStream, status, unavailable } = usePromptSession();
const { snapshot: accountSnapshot } = useAccountView();
const account = computed(() => accountSnapshot.value.account), owner = computed(() => account.value?.user?.id ?? null);
const generated = computed(() => editorState.value.view === 'generated'), active = computed(() => ['connecting', 'live', 'updating'].includes(snapshot.value.phase));
const requesting = computed(() => previewState.value.phase === 'requesting'), cameraReady = computed(() => previewState.value.phase === 'ready');
const showRemote = computed(() => generated.value && Boolean(remoteStream.value));
const captureAvailable = computed(() => generated.value ? showRemote.value && ['live', 'updating'].includes(snapshot.value.phase) : cameraReady.value && Boolean(stream.value));
const phaseLabel = computed(() => snapshot.value.phase === 'connecting' ? '正在连接实时编辑…' : snapshot.value.phase === 'updating' ? '正在同步提示词组合…' : snapshot.value.phase === 'live' ? '实时编辑中' : snapshot.value.phase === 'error' ? '连接已停止，请查看原因' : snapshot.value.phase === 'ended' ? '本次编辑已结束' : '准备开始实时编辑');
const currentPage = computed(() => editorState.value.currentPage), pages = computed(() => editorState.value.pages);
const paged = computed(() => editorState.value.instructions.slice(currentPage.value * editorState.value.pageSize, (currentPage.value + 1) * editorState.value.pageSize));
const startDisabled = computed(() => Boolean(account.value?.user) && (!snapshot.value.consent || !cameraReady.value || !editorState.value.instructions.length || Boolean(unavailable.value) || Boolean(accountSnapshot.value.error)));
const serviceStatus = computed(() => account.value?.user ? unavailable.value ?? status.value?.message ?? '' : '登录后检查实时编辑测试权限。');
const slot = ref<HTMLDivElement | null>(null), stage = ref<HTMLElement | null>(null), input = ref<HTMLTextAreaElement | null>(null);
const localPreview = ref<{ video: HTMLVideoElement | null } | null>(null), remotePreview = ref<{ video: HTMLVideoElement | null } | null>(null);
const { snapshot: frame, toggleMirror, toggleFullscreen, capture } = useFrameTools({
  stage: () => stage.value,
  video: () => showRemote.value ? (remotePreview.value?.video ?? null) : (localPreview.value?.video ?? null),
  stem: () => showRemote.value ? '映想-AI实时编辑' : '映想-相机原画',
});
const { save: savedWork } = useGeneratedRecording({
  enabled: true,
  live: () => ['live', 'updating'].includes(snapshot.value.phase),
  stream: () => remoteStream.value,
  session: () => snapshot.value.deadlineAt,
  seconds: () => 15,
  owner: () => owner.value,
  kind: 'edit',
  promptHistory: () => snapshot.value.history,
});
let stopLayout: (() => void) | undefined;
const compact = window.matchMedia('(max-width: 620px), (max-height: 700px)'), medium = window.matchMedia('(max-height: 850px)');
function layout() { editor.setPageSize(compact.matches ? 1 : medium.matches ? 2 : 3); }
onMounted(() => {
  stopLayout = mountPreviewSurface(slot.value);
  layout(); compact.addEventListener('change', layout); medium.addEventListener('change', layout);
});
onUnmounted(() => {
  stopLayout?.();
  compact.removeEventListener('change', layout); medium.removeEventListener('change', layout);
});
watch(() => previewState.value.message, message => { if (message) notify(message, 'error'); });
watch(() => savedWork.value.phase, phase => {
  if (phase === 'error') notify(savedWork.value.message ?? '保存未完成，请查看我的作品', 'error');
  if (phase === 'saved') notify(savedWork.value.message ?? '视频与提示词组合已保存到我的作品。', savedWork.value.message ? 'info' : 'success');
});
watch(() => snapshot.value.message, message => { if (message) notify(message, 'info'); });
function toggleCamera() {
  if (stream.value || previewState.value.phase === 'requesting') editor.closeCamera();
  else void preview.start();
}
function send() {
  if (editor.add(editorState.value.draft)) input.value?.focus();
}
function onDraft(event: Event) { editor.setDraft((event.target as HTMLTextAreaElement).value); }
function onConsent(event: Event) { editor.setConsent((event.target as HTMLInputElement).checked); }
function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) { event.preventDefault(); send(); }
}
function example(text: string) { editor.setDraft(t(text)); input.value?.focus(); }
function start() {
  if (!account.value?.user) { sessionScope.state.loginOpen = true; return; }
  if (accountSnapshot.value.error) { notify(accountSnapshot.value.error, 'error'); return; }
  if (unavailable.value) { notify(unavailable.value, 'info'); return; }
  if (!cameraReady.value || !camera.isReady()) { notify('请先打开相机并等待预览就绪。'); return; }
  editor.start();
}
</script>
<template>
  <main id="creative-space" :class="[base['page-shell'], base['creation-shell']]">
    <div :class="base['workbench-title']"><h1>{{ t('创作空间') }}</h1><span>{{ t('提示词实时编辑') }}</span><RouterLink to="/account">{{ t('我的权益 ↗') }}</RouterLink></div>
    <StudioModes active="prompt" />
    <div :class="base.workspace">
      <section :class="s.editor" aria-labelledby="prompt-title">
        <div :class="s.heading"><h2 id="prompt-title">{{ t('我的提示词') }}<span :class="s.count">{{ editorState.instructions.length }}</span></h2></div>
        <div :class="s.history">
          <ol v-if="editorState.instructions.length" :class="s.cards" :aria-label="t('已发送的提示词')">
            <li v-for="item in paged" :key="item.id" :class="s.card">
              <p tabindex="0" :aria-label="t(`提示词内容 ${item.id}`)">{{ item.text }}</p>
              <button :class="s.remove" type="button" :aria-label="t(`删除提示词 ${item.id}`)" @click="editor.remove(item.id)"><StudioIcon name="close" /></button>
            </li>
          </ol>
          <div v-else :class="s.historyEmpty"><span :class="[s.seed, 'star-hover-spin']" aria-hidden="true">✳</span><h3>{{ t('暂无提示词') }}</h3><p>{{ t('从下方输入，或选一个灵感') }}</p></div>
        </div>
        <div v-if="pages > 1" :class="s.pagination"><div><button type="button" :aria-label="t('上一页提示词')" :disabled="currentPage === 0" @click="editor.setPage(currentPage - 1)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 7-5 5 5 5" /></svg></button><span>{{ currentPage + 1 }} / {{ pages }}</span><button type="button" :aria-label="t('下一页提示词')" :disabled="currentPage === pages - 1" @click="editor.setPage(currentPage + 1)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 7 5 5-5 5" /></svg></button></div></div>
        <form :class="s.promptComposer" @submit.prevent="send">
          <div :class="s.composeHeading"><label for="edit-prompt">{{ t('添加提示词') }}</label><span :class="s.counter">{{ editorState.draft.length }}/500</span></div>
          <textarea ref="input" id="edit-prompt" :maxlength="PROMPT_POLICY.maxPromptLength" rows="4" :placeholder="t('描述你想改变的画面…')" :value="editorState.draft" @input="onDraft" @keydown="onKeydown" />
          <div :class="s.ideaGrid" role="group" :aria-label="t('提示词示例')"><button v-for="(item, index) in PROMPT_EXAMPLES" :key="item.label" type="button" :title="t(item.text)" @click="example(item.text)"><StudioIcon :name="index === 0 ? 'hanger' : index === 1 ? 'sun' : 'star'" /><span>{{ t(item.label) }}</span></button></div>
          <button :class="s.send" type="submit" :disabled="!editorState.draft.trim()"><span>{{ t('发送') }}</span><StudioIcon name="arrow" /></button>
        </form>
      </section>
      <div ref="slot" :class="base['preview-slot']">
        <WorkspacePreview :class="[base.panel, s.preview]" :aria-label="t('实时编辑画面')">
          <div data-preview-heading :class="s.previewHeading"><h2>{{ t(generated ? '映想画面' : '相机原画') }}</h2><span role="status"><i :data-on="Boolean(stream)" />{{ t(active ? phaseLabel : requesting ? '等待相机授权' : stream ? '相机已开启' : '相机未开启') }}<template v-if="active && snapshot.deadlineAt !== null"> · {{ snapshot.remaining }}s</template></span></div>
          <div data-preview-viewport :class="base['preview-viewport']"><div ref="stage" data-preview-stage :class="s.stage">
            <CameraPreview v-if="stream" ref="localPreview" :stream="stream" :camera="camera" :visible="!generated" :mirrored="frame.mirrored" />
            <CameraPreview v-if="remoteStream" ref="remotePreview" :stream="remoteStream" :camera="remote" :visible="generated" remote :mirrored="frame.mirrored" />
            <div v-if="!stream || (generated && !showRemote)" :key="editorState.view" :class="[s.empty, generated ? s.setup : '']">
              <div :class="s.imagine" aria-hidden="true"><span class="star-hover-spin">✳</span></div>
              <h3>{{ t(active ? '正在连接实时编辑…' : generated ? '确认后开始实时编辑' : '打开相机开始实时编辑') }}</h3>
              <template v-if="!stream"><p>{{ t(requesting ? '等待相机授权…' : '打开相机后可添加提示词。') }}</p><button type="button" data-stage-start :class="base['stage-start']" :disabled="requesting" @click="toggleCamera"><StudioIcon name="camera" />{{ t(requesting ? '取消打开' : '打开相机') }}</button></template>
              <template v-else-if="generated && !active">
                <p v-if="!editorState.instructions.length">{{ t('添加提示词') }}</p>
                <label :class="s.consent"><input type="checkbox" :checked="snapshot.consent" @change="onConsent" /><span>{{ t('已获素材授权，同意云端处理并保存生成视频与提示词') }}</span></label>
                <button type="button" :class="s.start" :disabled="startDisabled" @click="start">{{ t(account?.user ? '开始实时编辑' : '登录后开始编辑') }}</button>
                <span :class="s.serviceStatus" role="status">{{ t(serviceStatus) }}</span>
                <details v-if="snapshot.phase === 'error' && snapshot.message" :class="s.failure"><summary>{{ t('连接未完成，查看详情') }}</summary><p>{{ t(snapshot.message) }}</p></details>
              </template>
              <p v-else>{{ t('连接中可以继续调整提示词，最新组合会在连接就绪后发送。') }}</p>
            </div>
            <MediaTools :fullscreen="frame.fullscreen" :supported="frame.supported" :capturing="frame.capturing" :disabled="!captureAvailable" @fullscreen="toggleFullscreen" @capture="capture" />
            <div :class="s.badges"><span>{{ t(showRemote ? '映想画面 ✳ · AI生成' : generated ? '映想画面 ✳' : '相机原画') }}</span><span v-if="editorState.instructions.length > 0">{{ editorState.instructions.length }} {{ t(' 条提示词') }}</span></div>
          </div></div>
          <PreviewControls :view-label="t('实时编辑视图')">
            <template #views><button type="button" :aria-pressed="!generated" @click="editor.setView('original')">{{ t('相机原画') }}</button><button type="button" :aria-pressed="generated" @click="editor.setView('generated')">{{ t('映想画面 ') }}<span aria-hidden="true">✳</span></button></template>
            <template #actions><button v-if="active" type="button" data-preview-stop @click="editor.closeCamera('实时编辑已结束。')">{{ t(snapshot.phase === 'connecting' ? '取消连接' : '结束编辑') }}</button><MirrorButton :mirrored="frame.mirrored" :disabled="false" @toggle="toggleMirror" /><button type="button" data-preview-primary :aria-pressed="Boolean(stream) || requesting" @click="toggleCamera"><StudioIcon name="camera" />{{ t(requesting ? '取消打开' : stream ? '关闭相机' : '打开相机') }}</button></template>
          </PreviewControls>
        </WorkspacePreview>
      </div>
    </div>
    <footer :class="base['creation-footer']"><RouterLink to="/privacy#edit" target="_blank" rel="noopener noreferrer">{{ t('隐私与使用说明 ↗') }}</RouterLink><span>{{ t('实时编辑 · 测试开放') }}</span><RouterLink to="/works">{{ t(savedWork.phase === 'saved' ? '已保存到我的作品 ↗' : savedWork.phase === 'saving' ? '后台保存中 · 我的作品 ↗' : '生成视频自动保存 · 我的作品 ↗') }}</RouterLink></footer>
  </main>
</template>
