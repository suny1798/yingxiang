export interface VideoFramePlatform {
  canvas: () => HTMLCanvasElement;
  objectURL: (blob: Blob) => string;
  revokeURL: (url: string) => void;
  download: (url: string, filename: string) => void;
  defer: (callback: () => void) => void;
}

const platform: VideoFramePlatform = {
  canvas: () => document.createElement('canvas'),
  objectURL: (blob) => URL.createObjectURL(blob),
  revokeURL: (url) => URL.revokeObjectURL(url),
  download: (url, filename) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
  },
  defer: (callback) => setTimeout(callback, 1000),
};

export function canCaptureVideoFrame(video: Pick<HTMLVideoElement, 'readyState' | 'videoWidth' | 'videoHeight'> | null): video is HTMLVideoElement {
  return Boolean(video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0);
}

/** 只读取点击时的当前帧。镜像直接写入PNG像素，不修改视频或媒体流。 */
export async function captureVideoFrame(video: HTMLVideoElement | null, mirrored: boolean, api: Pick<VideoFramePlatform, 'canvas'> = platform): Promise<Blob> {
  if (!canCaptureVideoFrame(video)) throw new Error('视频画面尚未就绪，请播放后再截图。');
  const canvas = api.canvas();
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('当前浏览器无法创建截图，请换用桌面 Chrome 或 Edge。');
  try {
    if (mirrored) {
      context.save();
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      context.restore();
    } else {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
  } catch {
    throw new Error('这段视频暂时无法截图，请重新加载后再试。');
  }
  return await new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob && blob.size > 0) resolve(blob);
        else reject(new Error('截图没有生成有效图片，请稍后重试。'));
      }, 'image/png');
    } catch {
      reject(new Error('这段视频暂时无法导出截图，请检查浏览器的媒体访问权限。'));
    }
  });
}

export function safeFrameFilename(value: string): string {
  const printable = Array.from(value, (character) => character.charCodeAt(0) < 32 ? ' ' : character).join('');
  const cleaned = printable.replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  return `${(cleaned || '映想-当前帧').slice(0, 80)}.png`;
}

/** 点击后延迟释放对象URL，避免浏览器尚未开始读取就回收。 */
export function downloadVideoFrame(blob: Blob, filename: string, api: Pick<VideoFramePlatform, 'objectURL' | 'revokeURL' | 'download' | 'defer'> = platform): void {
  const url = api.objectURL(blob);
  try {
    api.download(url, safeFrameFilename(filename));
  } finally {
    api.defer(() => api.revokeURL(url));
  }
}
