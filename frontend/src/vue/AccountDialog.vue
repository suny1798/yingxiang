<script setup lang="ts">
import { ref,watch,onMounted,onUnmounted } from 'vue';
import { accountCoordinator,sessionScope } from './runtime';
import { useAccountView } from './use-account';
import { notify } from '../lib/notices';
import { t } from './preferences';
import s from '../components/studio/studio.module.css';
const {snapshot}=useAccountView();
const dialog=ref<HTMLDialogElement|null>(null),register=ref(false),username=ref(''),password=ref(''),confirmed=ref(false),error=ref<string|null>(null);
function close(){if(!snapshot.value.busy)sessionScope.state.loginOpen=false;}
function backdrop(event:MouseEvent){const element=dialog.value;if(!element||event.target!==element)return;const r=element.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}
function mode(value:boolean){register.value=value;error.value=null;password.value='';}
async function submit(){
  if(snapshot.value.busy||(register.value&&!confirmed.value))return;
  error.value=null;const creating=register.value;
  try{await accountCoordinator.authenticate(creating,username.value,password.value);password.value='';notify(creating?'账号已创建。':'登录成功。','success');}
  catch(failure){password.value='';error.value=failure instanceof Error?failure.message:'账号操作未完成。';}
}
watch(error,value=>{if(value)notify(value,'error');});
onMounted(()=>dialog.value?.showModal());
onUnmounted(()=>{password.value='';username.value='';confirmed.value=false;dialog.value?.close();});
</script>
<template>
  <div :class="s.studio" style="height:0;min-height:0;padding-bottom:0">
    <dialog ref="dialog" :class="s['account-dialog']" aria-labelledby="account-title" @cancel.prevent="close" @click="backdrop">
      <div :class="s['dialog-heading']"><span :class="s.eyebrow">{{t('映想 · ')}}{{t('账号登录与注册')}}</span><button type="button" :disabled="snapshot.busy" :class="s['icon-button']" :aria-label="t('关闭账号')" @click="close"><svg :class="s.icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
      <h2 id="account-title">{{t(register?'创建账号':'登录账号')}}</h2><p :class="s['account-subtitle']">{{t(register?'创建账号后可获得一次15秒实时换装免费体验，视频换装可上传10秒以内视频。':'登录后查看权益、使用记录与账号信息。')}}</p>
      <div :class="s['auth-tabs']" role="group" :aria-label="t('账号操作')"><button type="button" :disabled="snapshot.busy" :aria-pressed="!register" @click="mode(false)">{{t('登录')}}</button><button type="button" :disabled="snapshot.busy" :aria-pressed="register" @click="mode(true)">{{t('创建账号')}}</button></div>
      <form :class="s['account-form']" @submit.prevent="submit">
        <label for="account-username">{{t('账号')}}<span>{{t('3—24位字母、数字或下划线')}}</span></label><input id="account-username" v-model="username" name="username" autocomplete="username" autocapitalize="none" :spellcheck="false" required minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]{3,24}" :disabled="snapshot.busy"/>
        <label for="account-password">{{t('密码')}}<span>{{t('8—128位')}}</span></label><input id="account-password" v-model="password" name="password" type="password" :autocomplete="register?'new-password':'current-password'" required minlength="8" maxlength="128" :disabled="snapshot.busy"/>
        <label v-if="register" :class="s['account-confirm']"><input v-model="confirmed" type="checkbox" required :disabled="snapshot.busy"/><span>{{t('我了解每个账号仅有一次免费体验；开启前还需单独确认云端画面处理说明。')}}</span></label>
        <button type="submit" :disabled="snapshot.busy||(register&&!confirmed)" :class="[s['primary-button'],s['dialog-primary']]">{{t(snapshot.busy?'正在处理…':register?'创建账号并继续':'登录')}}<svg :class="s.icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button>
      </form>
      <p :class="s['account-footnote']">{{t('当前使用账号密码登录，手机号登录与在线购买尚未开放。请妥善保存密码，暂不支持找回。')}}</p>
      <p v-if="error" :class="s['account-error']" role="alert">{{t(error)}}</p>
    </dialog>
  </div>
</template>
