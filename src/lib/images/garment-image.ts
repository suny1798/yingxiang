import { ALLOWED_MIMES, IMAGE_LIMITS } from '../limits';
export { ALLOWED_MIMES, IMAGE_LIMITS } from '../limits';

/** 先检查签名与已知尺寸；实际解码仍须再次确认。 */
export function validateImageHeader(bytes: Uint8Array, mime: string, size: number): void {
  if (size > IMAGE_LIMITS.maxBytes) throw new Error('图片超过10MB，请换一张更小的参考图。');
  if (!ALLOWED_MIMES.includes(mime)) throw new Error('请选择JPG、PNG或WebP静态参考图。');
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  if (!(mime === 'image/png' && png || mime === 'image/jpeg' && jpeg || mime === 'image/webp' && webp)) throw new Error('参考图内容与格式不符，请重新导出后再试。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (png) {
    if (bytes.length < 33 || ascii(12, 4) !== 'IHDR') throw new Error('PNG参考图不完整，请换一张图片。');
    const width = view.getUint32(16), height = view.getUint32(20);
    if (!width || !height || width * height > IMAGE_LIMITS.maxPixels) throw new Error('参考图像素过大或尺寸无效，请缩小后再试。');
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) throw new Error('PNG参考图已损坏，请换一张图片。');
      if (ascii(offset + 4, 4) === 'acTL') throw new Error('暂不支持动图，请选择静态参考图。');
      offset += length + 12;
    }
  }
  if (webp && ascii(12, 4) === 'VP8X') {
    if (bytes.length < 30) throw new Error('WebP参考图不完整，请换一张图片。');
    if (bytes[20] & 2) throw new Error('暂不支持动图，请选择静态参考图。');
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    if (width * height > IMAGE_LIMITS.maxPixels) throw new Error('参考图像素过大，请缩小后再试。');
  }
}

export async function prepareGarmentImage(file: File, signal: AbortSignal): Promise<Blob> {
  if (file.size > IMAGE_LIMITS.maxBytes) throw new Error('图片超过10MB，请换一张更小的参考图。');
  validateImageHeader(new Uint8Array(await file.arrayBuffer()), file.type, file.size);
  signal.throwIfAborted();
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('参考图无法读取，请重新导出后再试。'); }
  try {
    signal.throwIfAborted();
    if (bitmap.width * bitmap.height > IMAGE_LIMITS.maxPixels) throw new Error('参考图像素过大，请缩小后再试。');
    const scale = Math.min(1, IMAGE_LIMITS.maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法处理参考图，请更换浏览器后再试。');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    signal.throwIfAborted();
    if (!blob) throw new Error('参考图处理失败，请换一张图片。');
    return blob;
  } finally { bitmap.close(); }
}
