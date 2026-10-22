import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_LIMITS, validateImageHeader } from '../src/lib/images/garment-image';

function png(width = 300, height = 300, animated = false) {
  const bytes = new Uint8Array(animated ? 53 : 45), data = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); data.setUint32(8, 13); bytes.set(Buffer.from('IHDR'), 12); data.setUint32(16, width); data.setUint32(20, height);
  if (animated) { data.setUint32(33, 8); bytes.set(Buffer.from('acTL'), 37); }
  else bytes.set(Buffer.from('IEND'), 37);
  return bytes;
}

test('接受静态PNG头，拒绝伪扩展名及不支持的格式', () => {
  const bytes = png(); assert.doesNotThrow(() => validateImageHeader(bytes, 'image/png', bytes.length));
  assert.throws(() => validateImageHeader(bytes, 'image/jpeg', bytes.length), /格式不符/);
  assert.throws(() => validateImageHeader(bytes, 'image/gif', bytes.length), /请选择/);
});
test('在解码前拒绝超过10MB、超大像素及零尺寸PNG', () => {
  assert.throws(() => validateImageHeader(png(), 'image/png', IMAGE_LIMITS.maxBytes + 1), /10MB/);
  assert.throws(() => validateImageHeader(png(20_000, 20_000), 'image/png', 45), /像素/);
  assert.throws(() => validateImageHeader(png(0, 300), 'image/png', 45), /尺寸/);
});
test('拒绝APNG、截断PNG和越界块', () => {
  assert.throws(() => validateImageHeader(png(300, 300, true), 'image/png', 53), /动图/);
  assert.throws(() => validateImageHeader(png().slice(0, 20), 'image/png', 20), /不完整/);
  const corrupt = png(); new DataView(corrupt.buffer).setUint32(33, 1000);
  assert.throws(() => validateImageHeader(corrupt, 'image/png', 45), /损坏/);
});
test('拒绝动态WebP与截断VP8X', () => {
  const bytes = new Uint8Array(30); bytes.set(Buffer.from('RIFF')); bytes.set(Buffer.from('WEBP'), 8); bytes.set(Buffer.from('VP8X'), 12); bytes[20] = 2;
  assert.throws(() => validateImageHeader(bytes, 'image/webp', bytes.length), /动图/);
  assert.throws(() => validateImageHeader(bytes.slice(0, 18), 'image/webp', 18), /不完整/);
});
