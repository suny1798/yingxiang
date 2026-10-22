import { ALLOWED_MIMES, IMAGE_LIMITS } from '../limits';
export { ALLOWED_MIMES, IMAGE_LIMITS } from '../limits';

function validateDimensions(width: number, height: number) {
  if (!width || !height || width * height > IMAGE_LIMITS.maxPixels) throw new Error('参考图像素过大或尺寸无效，请缩小后再试。');
}

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
  if (jpeg) {
    let foundSize = false;
    for (let offset = 2; offset < bytes.length;) {
      if (bytes[offset++] !== 255) throw new Error('JPEG参考图已损坏，请重新导出。');
      while (offset < bytes.length && bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > bytes.length) throw new Error('JPEG参考图不完整，请换一张图片。');
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error('JPEG参考图已损坏，请换一张图片。');
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) throw new Error('JPEG参考图尺寸信息无效，请重新导出。');
        validateDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3)); foundSize = true;
      }
      offset += length;
    }
    if (!foundSize) throw new Error('JPEG参考图缺少有效尺寸，请重新导出。');
  }
  if (png) {
    if (bytes.length < 33 || ascii(12, 4) !== 'IHDR') throw new Error('PNG参考图不完整，请换一张图片。');
    const width = view.getUint32(16), height = view.getUint32(20);
    validateDimensions(width, height);
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) throw new Error('PNG参考图已损坏，请换一张图片。');
      if (ascii(offset + 4, 4) === 'acTL') throw new Error('暂不支持动图，请选择静态参考图。');
      offset += length + 12;
    }
  }
  if (webp) {
    if (bytes.length < 20) throw new Error('WebP参考图不完整，请换一张图片。');
    if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error('WebP参考图不完整或已损坏，请重新导出。');
    let foundSize = false;
    for (let offset = 12; offset < bytes.length;) {
      if (offset + 8 > bytes.length) throw new Error('WebP参考图不完整，请换一张图片。');
      const kind = ascii(offset, 4), length = view.getUint32(offset + 4, true), data = offset + 8;
      const end = data + length + (length % 2);
      if (end > bytes.length) throw new Error('WebP参考图不完整，请换一张图片。');
      if (kind === 'ANIM' || kind === 'ANMF') throw new Error('暂不支持动图，请选择静态参考图。');
      if (kind === 'VP8X') {
        if (length !== 10) throw new Error('WebP参考图尺寸信息无效，请重新导出。');
        if (bytes[data] & 2) throw new Error('暂不支持动图，请选择静态参考图。');
        validateDimensions(1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16), 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16)); foundSize = true;
      } else if (kind === 'VP8 ') {
        if (length < 10 || ascii(data + 3, 3) !== '\x9d\x01\x2a') throw new Error('WebP参考图已损坏，请重新导出。');
        validateDimensions(view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff); foundSize = true;
      } else if (kind === 'VP8L') {
        if (length < 5 || bytes[data] !== 47) throw new Error('WebP参考图已损坏，请重新导出。');
        const bits = view.getUint32(data + 1, true);
        validateDimensions(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)); foundSize = true;
      }
      offset = end;
    }
    if (!foundSize) throw new Error('WebP参考图缺少有效尺寸，请重新导出。');
  }
}

export async function prepareGarmentImage(file: File, signal: AbortSignal): Promise<Blob> {
  if (file.size > IMAGE_LIMITS.maxBytes) throw new Error('图片超过10MB，请换一张更小的参考图。');
  signal.throwIfAborted();
  validateImageHeader(new Uint8Array(await file.arrayBuffer()), file.type, file.size);
  signal.throwIfAborted();
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('参考图无法读取，请重新导出后再试。'); }
  try {
    signal.throwIfAborted();
    validateDimensions(bitmap.width, bitmap.height);
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
