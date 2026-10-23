/* 纯本地 UI 原型：无相机权限申请、网络请求、模型调用或持久化。 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const samples = {
    shirt: '云白衬衫', knit: '莓果针织', jacket: '苔绿外套'
  };
  const activeStates = new Set(['requestingCamera', 'creatingSession', 'connecting', 'live', 'updatingGarment', 'reconnecting']);
  const loadingStates = new Set(['requestingCamera', 'creatingSession', 'connecting', 'reconnecting']);
  const stateLabels = {
    idle: '等待开始', imageReady: '参考图已就绪', requestingCamera: '等待相机授权',
    creatingSession: '正在检查体验资格', connecting: '正在连接映想', live: '画面体验中 · 演示',
    updatingGarment: '正在更新参考图', reconnecting: '正在恢复画面', ended: '体验已结束', error: '暂时无法开启'
  };
  let state = 'idle';
  let garment = null;
  let previewUrl = null;
  let imageOperation = 0;
  let sessionOperation = 0;
  let updateOperation = 0;
  let deadline = 0;
  let countdown = null;
  let toastTimer = null;
  let errorMessage = '';
  let endedMessage = '';
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3600);
  }

  function updateStartButton() {
    const active = activeStates.has(state);
    $('start-button').hidden = active;
    $('stop-button').hidden = !active;
    $('start-button').disabled = !garment || !$('consent').checked;
    $('start-label').textContent = ['ended', 'error'].includes(state) ? '再次开启' : '开启映想';
    if (!active && !['ended', 'error'].includes(state)) {
      $('action-hint').textContent = !garment
        ? '选一张服装参考图，让第一个灵感就位。'
        : !$('consent').checked
          ? '开启前，请了解并确认参考图与相机画面的处理方式。'
          : '灵感已就位，点击「开启映想」体验界面流程。';
    }
  }

  function overlay(title, description, spinning = false) {
    $('stage-overlay').hidden = false;
    $('overlay-title').textContent = title;
    $('overlay-description').textContent = description;
    $('overlay-icon').classList.toggle('spinning', spinning);
    $('overlay-icon').innerHTML = `<svg class="icon"><use href="#${spinning ? 'i-camera' : state === 'ended' ? 'i-check' : 'i-info'}"/></svg>`;
  }

  function render() {
    $('mirror-stage').dataset.state = state;
    document.body.classList.toggle('session-active', activeStates.has(state));
    $('status-text').textContent = stateLabels[state];
    const dot = $('session-status').querySelector('.status-dot');
    dot.classList.toggle('neutral', !['live', 'updatingGarment'].includes(state));
    const hasView = ['live', 'updatingGarment'].includes(state);
    $('view-ai').disabled = !hasView;
    $('view-original').disabled = !hasView;
    $('view-label').hidden = !hasView;
    $('timer').hidden = !activeStates.has(state) || state === 'requestingCamera';
    $('stage-overlay').hidden = true;
    $('camera-label').textContent = hasView ? '画面状态 · 演示' : activeStates.has(state) ? '准备画面 · 演示' : '相机未开启';

    if (loadingStates.has(state)) {
      const messages = {
        requestingCamera: ['先让画面准备好', '正式体验会在这里申请相机权限；当前仅演示界面。'],
        creatingSession: ['为你的想象留个位置', '正在演示体验资格检查，你可以随时结束。'],
        connecting: ['正在连接映想画面', '稍等片刻，让灵感就位。当前为连接状态演示。'],
        reconnecting: ['画面暂时离开了一下', '正在演示恢复连接，剩余体验时间继续计算。']
      };
      overlay(...messages[state], true);
      $('action-hint').textContent = '正在准备画面，随时可以结束体验。';
    } else if (state === 'ended') {
      overlay('这次想象，先到这里。', endedMessage || '本次体验已结束，下一个灵感随时可以开始。');
      $('action-hint').textContent = '体验已结束，参考图保留在本页，方便再次开启。';
    } else if (state === 'error') {
      overlay('映想暂时没有准备好', errorMessage);
      $('action-hint').textContent = errorMessage;
    } else if (state === 'live') {
      $('action-hint').textContent = '更换参考图或对比原始画面，探索不同穿搭。当前为界面演示。';
    } else if (state === 'updatingGarment') {
      $('action-hint').textContent = '新的灵感已提交，画面正在更新（界面示意）。';
    }
    $('stage-hint').textContent = hasView ? '可更换参考图，探索不同穿搭。当前画面为插画示意。' : '画面保持清晰，让试穿区域完整进入镜头。';
    updateStartButton();
  }

  function setState(next) { state = next; render(); }
  function releasePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    $('uploaded-image').removeAttribute('src');
  }

  function showGarment(kind) {
    $('upload-empty').hidden = true;
    $('garment-preview').hidden = false;
    $('upload-button').classList.add('has-image');
    $('clear-image').hidden = false;
    $('image-error').hidden = true;
    $('sample-preview').hidden = kind === 'upload';
    $('uploaded-image').hidden = kind !== 'upload';
    document.querySelectorAll('[data-garment]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.garment === kind));
    });
    if (['live', 'updatingGarment'].includes(state)) {
      const op = ++updateOperation;
      setState('updatingGarment');
      delay(850).then(() => {
        if (op !== updateOperation || state !== 'updatingGarment') return;
        setState('live');
        toast('参考图已更新 · 当前只演示界面，插画不代表生成结果。');
      });
    } else if (!activeStates.has(state)) {
      setState('imageReady');
    }
    updateStartButton();
  }

  async function processFile(file) {
    if (!file) return;
    const op = ++imageOperation;
    $('image-error').hidden = true;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('图片超过 10MB，请换一张更小的图片。');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片，暂不支持其他格式。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      const isPng = [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n);
      const ascii = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
      const isWebp = ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
      if (!(file.type === 'image/jpeg' && isJpeg || file.type === 'image/png' && isPng || file.type === 'image/webp' && isWebp)) throw new Error('图片内容与格式不符，请重新导出后再试。');
      if (isPng) {
        const header = new DataView(bytes.buffer);
        if (header.getUint32(16) * header.getUint32(20) > 20_000_000) throw new Error('图片像素过大，请缩小后再试。');
        for (let offset = 8; offset + 12 <= bytes.length;) {
          const size = header.getUint32(offset);
          if (ascii(offset + 4, 4) === 'acTL') throw new Error('暂不支持动图，请选择静态参考图片。');
          offset += size + 12;
        }
      }
      if (isWebp && ascii(12, 4) === 'VP8X' && (bytes[20] & 2)) throw new Error('暂不支持动图，请选择静态参考图片。');
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width * bitmap.height > 20_000_000) throw new Error('图片像素过大，请缩小后再试。');
        const ratio = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
        canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const cleanImage = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!cleanImage) throw new Error('图片暂时无法处理，请换一张试试。');
        if (op !== imageOperation) return;
        releasePreview();
        previewUrl = URL.createObjectURL(cleanImage);
        $('uploaded-image').src = previewUrl;
        garment = { name: file.name, type: 'upload' };
        showGarment('upload');
        toast('参考图已在本页准备好，没有发送至云端。');
      } finally { bitmap.close(); }
    } catch (error) {
      if (op !== imageOperation) return;
      $('image-error').textContent = error instanceof Error && error.message ? error.message : '图片无法读取，请换一张试试。';
      $('image-error').hidden = false;
    } finally {
      if (op === imageOperation) $('file-input').value = '';
    }
  }

  function fail(message) {
    sessionOperation++;
    updateOperation++;
    clearInterval(countdown);
    errorMessage = message;
    setState('error');
  }

  function tick() {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    $('timer').textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
    if (remaining === 0) stop('这次体验时间到了。参考图还在，下一个灵感随时可以开启。');
  }

  async function start() {
    if (!garment || !$('consent').checked || activeStates.has(state)) return;
    const op = ++sessionOperation;
    const scenario = $('scenario').value;
    errorMessage = '';
    $('view-ai').classList.add('selected');
    $('view-original').classList.remove('selected');
    $('view-ai').setAttribute('aria-pressed', 'true');
    $('view-original').setAttribute('aria-pressed', 'false');
    $('view-label').textContent = '映想画面 · 界面演示';
    setState('requestingCamera');
    if (window.matchMedia('(max-width: 620px)').matches) {
      document.querySelector('.mirror-panel').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    }
    await delay(1000);
    if (op !== sessionOperation) return;
    if (scenario === 'camera-denied') return fail('尚未获得相机权限。正式使用时，请在浏览器中允许后重试。');
    setState('creatingSession');
    await delay(600);
    if (op !== sessionOperation) return;
    if (scenario === 'capacity') return fail('映想的体验位置暂时已满。请稍后再来，本次不会扣减体验次数。');
    if (scenario === 'quota') return fail('今天的体验次数已用完，明天再来继续你的想象。当前为额度提示演示。');
    deadline = Date.now() + 60_000;
    countdown = setInterval(tick, 250);
    tick();
    setState('connecting');
    await delay(1500);
    if (op !== sessionOperation) return;
    if (scenario === 'connection-error') return fail('暂时无法连接映想。请检查网络，稍后手动重试。');
    setState('live');
    toast('已开启映想界面演示，相机仍未启用。');
  }

  function stop(message = '你已结束本次体验。换一份灵感，再来看看。') {
    if (!activeStates.has(state)) return;
    sessionOperation++;
    updateOperation++;
    clearInterval(countdown);
    countdown = null;
    endedMessage = message;
    setState('ended');
  }

  $('upload-button').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (event) => processFile(event.target.files[0]));
  ['dragenter', 'dragover'].forEach((eventName) => $('upload-button').addEventListener(eventName, (event) => {
    event.preventDefault(); $('upload-button').classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach((eventName) => $('upload-button').addEventListener(eventName, (event) => {
    event.preventDefault(); $('upload-button').classList.remove('drag-over');
  }));
  $('upload-button').addEventListener('drop', (event) => processFile(event.dataTransfer.files[0]));
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());
  document.querySelectorAll('[data-garment]').forEach((button) => button.addEventListener('click', () => {
    imageOperation++;
    releasePreview();
    garment = { type: button.dataset.garment, name: samples[button.dataset.garment] };
    showGarment(button.dataset.garment);
    document.querySelector('#sample-preview use').setAttribute('href', `assets/garments.svg#${button.dataset.garment}`);
  }));
  $('clear-image').addEventListener('click', () => {
    if (activeStates.has(state)) stop('参考图已移除，本次体验随之结束。');
    imageOperation++;
    releasePreview();
    garment = null;
    $('upload-empty').hidden = false;
    $('garment-preview').hidden = true;
    $('clear-image').hidden = true;
    $('image-error').hidden = true;
    $('upload-button').classList.remove('has-image');
    document.querySelectorAll('[data-garment]').forEach((button) => button.setAttribute('aria-pressed', 'false'));
    setState('idle');
  });
  $('consent').addEventListener('change', () => {
    if (!$('consent').checked && activeStates.has(state)) stop('你已取消云端处理确认，本次体验已结束。');
    updateStartButton();
  });
  $('start-button').addEventListener('click', start);
  $('stop-button').addEventListener('click', () => stop());
  [$('view-ai'), $('view-original')].forEach((button) => button.addEventListener('click', () => {
    if (!['live', 'updatingGarment'].includes(state)) return;
    [$('view-ai'), $('view-original')].forEach((other) => {
      other.classList.toggle('selected', button === other);
      other.setAttribute('aria-pressed', String(button === other));
    });
    $('view-label').textContent = button === $('view-ai') ? '映想画面 · 界面演示' : '原始画面 · 界面演示';
    toast('已切换画面标签；当前插画仅作界面示意。');
  }));
  $('simulate-network').addEventListener('click', async () => {
    if (state !== 'live') return toast('先开启映想界面演示，再查看连接中断状态。');
    const op = sessionOperation;
    setState('reconnecting');
    document.querySelector('.scenario-menu').open = false;
    await delay(2600);
    if (sessionOperation === op && state === 'reconnecting') setState('live');
  });
  $('reset-prototype').addEventListener('click', () => {
    stop();
    $('clear-image').click();
    $('consent').checked = false;
    $('scenario').value = 'normal';
    $('invite-code').value = '';
    $('invite-error').hidden = true;
    $('invitation-label').textContent = '受邀体验';
    document.querySelector('.scenario-menu').open = false;
    updateStartButton();
    toast('灵感空间已重置，可以重新体验。');
  });
  $('scenario').addEventListener('change', () => toast('体验状态已切换，下次开启映想时生效。'));
  document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => $(button.dataset.open).showModal()));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
    const r = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dialog.close();
  }));
  $('invite-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if ($('invite-code').value.trim().toUpperCase() !== 'YINGXIANG') {
      $('invite-error').textContent = '邀请码无效。原型示意码为 YINGXIANG，请重新输入。';
      $('invite-error').hidden = false;
      return;
    }
    $('invite-error').hidden = true;
    $('invitation-label').textContent = '受邀体验 · 示意';
    $('invite-dialog').close();
    toast('欢迎来到映想。当前仅演示受邀流程，未开通真实服务。');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop('页面已离开前台，本次体验已结束。返回后可以再次开启映想。');
  });
  window.addEventListener('pagehide', () => { stop(); imageOperation++; releasePreview(); });
  render();
})();
