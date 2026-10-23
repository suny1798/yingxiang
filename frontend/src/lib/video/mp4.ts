import { VIDEO_POLICY } from './policy';

interface Box { type: string; start: number; end: number }
/** 保守接收普通MP4，拒绝碎片、多个轨道和无法复核的时间表；不解码或转码媒体。 */
export function inspectVideo(bytes: Uint8Array): { seconds: number; width: number; height: number } {
  const invalid = (message = '视频格式无法验证，请导出为普通H.264 MP4后再试。'): never => { throw new Error(message); };
  if (bytes.length < 32 || bytes.length > VIDEO_POLICY.maxBytes) invalid('请选择不超过25MB的MP4视频。');
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  let count = 0;
  const boxes = (start: number, end: number): Box[] => {
    const result: Box[] = [];
    while (start < end) {
      if (++count > 10_000 || start + 8 > end) invalid();
      let size = data.getUint32(start), header = 8;
      const type = text(start + 4, 4);
      if (size === 1) {
        if (start + 16 > end) invalid();
        const wide = data.getBigUint64(start + 8);
        if (wide > BigInt(bytes.length)) invalid();
        size = Number(wide); header = 16;
      } else if (size === 0) size = end - start;
      if (size < header || start + size > end) invalid();
      result.push({ type, start: start + header, end: start + size }); start += size;
    }
    return result;
  };
  const one = (items: Box[], type: string): Box => {
    const found = items.filter((box) => box.type === type);
    if (found.length !== 1) invalid();
    return found[0];
  };
  const length = (box: Box, minimum: number) => { if (box.end - box.start < minimum) invalid(); };
  const timing = (box: Box): { seconds: number; scale: number } => {
    length(box, 20); const version = bytes[box.start];
    if (version !== 0 && version !== 1) invalid();
    length(box, version ? 32 : 20);
    const scale = data.getUint32(box.start + (version ? 20 : 12));
    const ticks = version ? Number(data.getBigUint64(box.start + 24)) : data.getUint32(box.start + 16);
    const seconds = ticks / scale;
    if (!scale || !Number.isFinite(seconds) || seconds < 1 || seconds > VIDEO_POLICY.maxSeconds + 0.001) invalid('首版支持1—15秒视频，请先裁剪后再上传。');
    return { seconds, scale };
  };
  const top = boxes(0, bytes.length);
  length(one(top, 'ftyp'), 8);
  if (top.some((box) => box.type === 'moof')) invalid('暂不支持分段MP4，请重新导出为普通MP4。');
  if (!top.some((box) => box.type === 'mdat' && box.end > box.start)) invalid();
  const movie = one(top, 'moov'), movieBoxes = boxes(movie.start, movie.end);
  if (movieBoxes.some((box) => box.type === 'mvex')) invalid();
  const movieTime = timing(one(movieBoxes, 'mvhd'));
  const tracks = movieBoxes.filter((box) => box.type === 'trak');
  for (const track of tracks) {
    const media = one(boxes(track.start, track.end), 'mdia');
    const handler = one(boxes(media.start, media.end), 'hdlr'); length(handler, 12);
    if (text(handler.start + 8, 4) === 'soun') invalid('视频含有音轨，请先在剪辑工具中移除音轨后导出。');
  }
  if (tracks.length !== 1) invalid('请选择仅含一条画面轨道、无音轨的MP4。');
  const trackBoxes = boxes(tracks[0].start, tracks[0].end);
  const media = one(trackBoxes, 'mdia'), mediaBoxes = boxes(media.start, media.end);
  const handler = one(mediaBoxes, 'hdlr'); length(handler, 12);
  if (text(handler.start + 8, 4) !== 'vide') invalid();
  const mediaTime = timing(one(mediaBoxes, 'mdhd'));
  if (Math.abs(mediaTime.seconds - movieTime.seconds) > 0.15) invalid('视频时间信息不一致，请重新导出后再试。');
  const minf = one(mediaBoxes, 'minf'), stbl = one(boxes(minf.start, minf.end), 'stbl');
  const sampleBoxes = boxes(stbl.start, stbl.end), stsd = one(sampleBoxes, 'stsd'); length(stsd, 8);
  if (data.getUint32(stsd.start + 4) !== 1) invalid();
  const codec = one(boxes(stsd.start + 8, stsd.end), 'avc1'); length(codec, 78);
  const width = data.getUint16(codec.start + 24), height = data.getUint16(codec.start + 26);
  const ratio = width / height;
  if (width < 320 || height < 320 || width > 3840 || height > 3840 || ![16 / 9, 9 / 16, 2, 0.5].some((value) => Math.abs(value - ratio) < 0.015)) invalid('请使用横版16:9 / 2:1或竖版9:16 / 1:2的视频，单边320—3840像素。');
  one(boxes(codec.start + 78, codec.end), 'avcC');
  const stts = one(sampleBoxes, 'stts'); length(stts, 8);
  const entries = data.getUint32(stts.start + 4);
  if (entries < 1 || entries > 100_000 || stts.start + 8 + entries * 8 !== stts.end) invalid();
  let ticks = 0, samples = 0;
  for (let index = 0; index < entries; index++) {
    const offset = stts.start + 8 + index * 8, number = data.getUint32(offset), delta = data.getUint32(offset + 4);
    if (!number || !delta) invalid();
    ticks += number * delta; samples += number;
  }
  const seconds = ticks / mediaTime.scale;
  if (samples > 15_000 || seconds > VIDEO_POLICY.maxSeconds + 0.001 || Math.abs(seconds - mediaTime.seconds) > 0.05) invalid('视频时间表异常或超过15秒，请重新裁剪导出。');
  const stsz = one(sampleBoxes, 'stsz'); length(stsz, 12);
  if (data.getUint32(stsz.start + 8) !== samples) invalid();
  const edits = trackBoxes.filter((box) => box.type === 'edts');
  if (edits.length > 1) invalid();
  if (edits[0]) {
    const edit = one(boxes(edits[0].start, edits[0].end), 'elst'); length(edit, 20);
    // 不接受变速、多段编辑或版本1编辑表，避免元数据低报处理时长。
    if (bytes[edit.start] !== 0 || data.getUint32(edit.start + 4) !== 1 || edit.end - edit.start !== 20 || data.getInt32(edit.start + 12) < 0 || data.getUint32(edit.start + 16) !== 65536 || Math.abs(data.getUint32(edit.start + 8) / movieTime.scale - movieTime.seconds) > 0.05) invalid('暂不支持变速或多段编辑时间表，请先重新导出视频。');
  }
  return { seconds: Math.max(seconds, movieTime.seconds), width, height };
}
