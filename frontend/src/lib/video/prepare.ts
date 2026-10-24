export interface PreparationProgress { stage: 'upload' | 'processing' | 'download'; percent?: number }
/** 只发往本站预处理接口；上传/接收用真实字节进度，服务端处理阶段不伪造百分比。 */
export function prepareVideo(file: File, signal: AbortSignal, onProgress: (value: PreparationProgress) => void, create: () => XMLHttpRequest = () => new XMLHttpRequest()): Promise<Blob> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const xhr = create();
    const abort = () => xhr.abort();
    const finish = () => signal.removeEventListener('abort', abort);
    xhr.upload.onprogress = (event) => onProgress({ stage: 'upload', percent: event.lengthComputable ? event.loaded / event.total * 100 : undefined });
    xhr.upload.onload = () => onProgress({ stage: 'processing' });
    xhr.onprogress = (event) => onProgress({ stage: 'download', percent: event.lengthComputable ? event.loaded / event.total * 100 : undefined });
    xhr.onload = async () => {
      finish();
      if (signal.aborted) { reject(new DOMException('已取消', 'AbortError')); return; }
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response instanceof Blob && xhr.response.type.startsWith('video/mp4')) { resolve(xhr.response); return; }
      let message = '视频自动处理未完成，请稍后重新选择。';
      try { const value = JSON.parse(await (xhr.response as Blob).text()); if (typeof value.error?.message === 'string') message = value.error.message; } catch { /* 不展示原始响应。 */ }
      reject(new Error(message));
    };
    xhr.onerror = () => { finish(); reject(new Error('视频上传或处理连接中断，请稍后重试。')); };
    xhr.ontimeout = () => { finish(); reject(new Error('视频处理超时，请稍后重试。')); };
    xhr.onabort = () => { finish(); reject(new DOMException('已取消', 'AbortError')); };
    xhr.open('POST', '/api/video/prepare'); xhr.responseType = 'blob'; xhr.timeout = 60_000;
    xhr.setRequestHeader('Content-Type', 'video/mp4'); signal.addEventListener('abort', abort, { once: true });
    onProgress({ stage: 'upload', percent: 0 }); xhr.send(file);
  });
}
