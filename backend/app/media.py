"""有界内存解析；不使用会 spool 到磁盘的 UploadFile。"""
import struct
from python_multipart import MultipartParser
from python_multipart.multipart import parse_options_header
from .core import BusinessError
from .generation import VIDEO


def multipart_parts(data, content_type):
    try:
        _, options = parse_options_header(content_type)
        boundary = options.get(b"boundary", b"")
        if not 1 <= len(boundary) <= 200:
            raise ValueError()
        parts, current, header_name, header_value, finished = [], {}, bytearray(), bytearray(), False

        def begin():
            if len(parts) >= 3:
                raise ValueError()
            current.clear()
            current.update(headers={}, body=bytearray(), header_bytes=0)

        def on_header_field(buf, start, end):
            header_name.extend(buf[start:end])
            if len(header_name) > 1024:
                raise ValueError()

        def on_header_value(buf, start, end):
            header_value.extend(buf[start:end])
            if len(header_value) > 2048:
                raise ValueError()

        def header_end():
            key = bytes(header_name).lower()
            if key in current["headers"]:
                raise ValueError()
            current["header_bytes"] += len(header_name) + len(header_value)
            if current["header_bytes"] > 4096:
                raise ValueError()
            current["headers"][key] = bytes(header_value)
            header_name.clear()
            header_value.clear()

        def on_data(buf, start, end):
            current["body"].extend(buf[start:end])
            if len(current["body"]) > 25 * 1024 * 1024:
                raise ValueError()

        def part_end():
            disposition, params = parse_options_header(current["headers"].get(b"content-disposition", b""))
            if disposition != b"form-data":
                raise ValueError()
            parts.append((params.get(b"name"), b"filename" in params, current["headers"].get(b"content-type", b"").decode("ascii"), bytes(current["body"])))

        def end():
            nonlocal finished
            finished = True

        parser = MultipartParser(boundary, {"on_part_begin": begin, "on_header_field": on_header_field, "on_header_value": on_header_value, "on_header_end": header_end, "on_part_data": on_data, "on_part_end": part_end, "on_end": end}, max_size=35 * 1024 * 1024 + 4096)
        parser.write(data)
        parser.finalize()
        if not finished:
            raise ValueError()
        if sorted(p[0] for p in parts) != [b"consentVersion", b"data", b"reference_image"]:
            raise BusinessError("VIDEO_CONSENT_REQUIRED", "请重新确认视频云端处理说明。")
        values = {p[0]: p for p in parts}
        consent, video, image = values[b"consentVersion"], values[b"data"], values[b"reference_image"]
        if consent[1] or consent[3].decode("utf-8") != VIDEO["consentVersion"]:
            raise BusinessError("VIDEO_CONSENT_REQUIRED", "请重新确认视频云端处理说明。")
        if not video[1] or not image[1] or video[2] != "video/mp4" or len(image[3]) > 10 * 1024 * 1024:
            raise BusinessError("INVALID_VIDEO_UPLOAD", "请选择MP4视频和不超过10MB的服装图。")
        try:
            from .video_prepare import prepare_video
            prepared, info, _ = prepare_video(video[3])
            seconds = info["seconds"]
            validate_image(image[3], image[2])
        except ValueError as error:
            raise BusinessError("INVALID_VIDEO_MEDIA", str(error)) from None
        return prepared, image[3], image[2], seconds
    except BusinessError:
        raise
    except Exception:
        raise BusinessError("INVALID_VIDEO_UPLOAD", "上传内容无法读取，请重新选择素材。") from None


def validate_image(data, mime):
    def fail(message="参考图内容与格式不符，请重新导出后再试。"):
        raise ValueError(message)

    def dimensions(w, h):
        if not w or not h or w * h > 20_000_000:
            fail("参考图像素过大或尺寸无效，请缩小后再试。")

    def u16(offset, little=False):
        return int.from_bytes(data[offset:offset + 2], "little" if little else "big")

    def u32(offset, little=False):
        return int.from_bytes(data[offset:offset + 4], "little" if little else "big")

    if len(data) > 10 * 1024 * 1024:
        fail("图片超过10MB，请换一张更小的参考图。")
    if mime not in ("image/png", "image/jpeg", "image/webp"):
        fail("请选择JPG、PNG或WebP静态参考图。")
    png, jpeg, webp = data.startswith(b"\x89PNG\r\n\x1a\n"), data.startswith(b"\xff\xd8\xff"), data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    if not ((mime == "image/png" and png) or (mime == "image/jpeg" and jpeg) or (mime == "image/webp" and webp)):
        fail()
    if png:
        if len(data) < 33 or data[12:16] != b"IHDR":
            fail("PNG参考图不完整，请换一张图片。")
        dimensions(u32(16), u32(20))
        offset = 8
        while offset + 12 <= len(data):
            length = u32(offset)
            if length > len(data) - offset - 12:
                fail("PNG参考图已损坏，请换一张图片。")
            if data[offset + 4:offset + 8] == b"acTL":
                fail("暂不支持动图，请选择静态参考图。")
            offset += length + 12
    if jpeg:
        found, offset = False, 2
        while offset < len(data):
            if data[offset] != 255:
                fail("JPEG参考图已损坏，请重新导出。")
            offset += 1
            while offset < len(data) and data[offset] == 255:
                offset += 1
            if offset >= len(data):
                fail("JPEG参考图不完整，请换一张图片。")
            marker = data[offset]
            offset += 1
            if marker in (218, 217):
                break
            if marker == 1 or 208 <= marker <= 215:
                continue
            if offset + 2 > len(data):
                fail("JPEG参考图不完整，请换一张图片。")
            length = u16(offset)
            if length < 2 or offset + length > len(data):
                fail("JPEG参考图已损坏，请换一张图片。")
            if marker in (192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207):
                if length < 8:
                    fail("JPEG参考图尺寸信息无效，请重新导出。")
                dimensions(u16(offset + 5), u16(offset + 3))
                found = True
            offset += length
        if not found:
            fail("JPEG参考图缺少有效尺寸，请重新导出。")
    if webp:
        if len(data) < 20 or u32(4, True) + 8 != len(data):
            fail("WebP参考图不完整或已损坏，请重新导出。")
        found, offset = False, 12
        while offset < len(data):
            if offset + 8 > len(data):
                fail("WebP参考图不完整，请换一张图片。")
            kind, length, start = data[offset:offset + 4], u32(offset + 4, True), offset + 8
            end = start + length + length % 2
            if end > len(data):
                fail("WebP参考图不完整，请换一张图片。")
            if kind in (b"ANIM", b"ANMF"):
                fail("暂不支持动图，请选择静态参考图。")
            if kind == b"VP8X":
                if length != 10:
                    fail("WebP参考图尺寸信息无效，请重新导出。")
                if data[start] & 2:
                    fail("暂不支持动图，请选择静态参考图。")
                dimensions(1 + int.from_bytes(data[start + 4:start + 7], "little"), 1 + int.from_bytes(data[start + 7:start + 10], "little"))
                found = True
            elif kind == b"VP8 ":
                if length < 10 or data[start + 3:start + 6] != b"\x9d\x01\x2a":
                    fail("WebP参考图已损坏，请重新导出。")
                dimensions(u16(start + 6, True) & 0x3fff, u16(start + 8, True) & 0x3fff)
                found = True
            elif kind == b"VP8L":
                if length < 5 or data[start] != 47:
                    fail("WebP参考图已损坏，请重新导出。")
                bits = u32(start + 1, True)
                dimensions(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff))
                found = True
            offset = end
        if not found:
            fail("WebP参考图缺少有效尺寸，请重新导出。")


def inspect_video(data, *, allow_audio=False):
    def fail(message="视频格式无法验证，请导出为普通H.264 MP4后再试。"):
        raise ValueError(message)

    if not 32 <= len(data) <= VIDEO["maxBytes"]:
        fail("请选择不超过25MB的MP4视频。")
    def uint(pos, width=4, signed=False):
        if pos < 0 or pos + width > len(data):
            fail()
        return int.from_bytes(data[pos:pos + width], "big", signed=signed)

    count = 0
    def boxes(start, end):
        nonlocal count
        result = []
        while start < end:
            count += 1
            if count > 10_000 or start + 8 > end:
                fail()
            size, header = uint(start), 8
            kind = data[start + 4:start + 8]
            if size == 1:
                if start + 16 > end:
                    fail()
                size, header = uint(start + 8, 8), 16
            elif size == 0:
                size = end - start
            if size < header or start + size > end:
                fail()
            result.append((kind, start + header, start + size))
            start += size
        return result

    def one(items, kind):
        found = [item for item in items if item[0] == kind]
        if len(found) != 1:
            fail()
        return found[0]

    def length(box, minimum):
        if box[2] - box[1] < minimum:
            fail()

    def children(box):
        return boxes(box[1], box[2])

    def timing(box, maximum=15.001):
        length(box, 20)
        start = box[1]
        version = data[start]
        if version not in (0, 1):
            fail()
        length(box, 32 if version else 20)
        scale = uint(start + (20 if version else 12))
        ticks = uint(start + 24, 8) if version else uint(start + 16)
        seconds = ticks / scale if scale else 0
        if not scale or not 1 <= seconds <= maximum:
            fail("首版支持1—15秒视频，请先裁剪后再上传。")
        return seconds, scale

    top = boxes(0, len(data))
    length(one(top, b"ftyp"), 8)
    if any(b[0] == b"moof" for b in top):
        fail("暂不支持分段MP4，请重新导出为普通MP4。")
    if not any(b[0] == b"mdat" and b[2] > b[1] for b in top):
        fail()
    movie = children(one(top, b"moov"))
    if any(b[0] == b"mvex" for b in movie):
        fail()
    movie_seconds, movie_scale = timing(one(movie, b"mvhd"), 86_400 if allow_audio else 15.001)
    tracks = [b for b in movie if b[0] == b"trak"]
    video_tracks, audio_tracks = [], []
    for track in tracks:
        handler = one(children(one(children(track), b"mdia")), b"hdlr")
        length(handler, 12)
        kind = data[handler[1] + 8:handler[1] + 12]
        if kind == b"soun":
            if not allow_audio:
                fail("视频仍有音轨，自动处理未完成，请重新选择视频。")
            audio_tracks.append(track)
        elif kind == b"vide":
            video_tracks.append(track)
        else:
            fail("暂不支持此视频轨道结构，请选择普通MP4视频。")
    if len(video_tracks) != 1 or len(audio_tracks) > 4:
        fail("请选择仅含一条画面轨道的MP4视频。")
    tracks = video_tracks
    track = children(tracks[0])
    media = children(one(track, b"mdia"))
    handler = one(media, b"hdlr")
    length(handler, 12)
    if data[handler[1] + 8:handler[1] + 12] != b"vide":
        fail()
    media_seconds, media_scale = timing(one(media, b"mdhd"))
    if not audio_tracks and abs(media_seconds - movie_seconds) > 0.15:
        fail("视频时间信息不一致，请重新导出后再试。")
    samples_boxes = children(one(children(one(media, b"minf")), b"stbl"))
    stsd = one(samples_boxes, b"stsd")
    length(stsd, 8)
    if uint(stsd[1] + 4) != 1:
        fail()
    codec = one(boxes(stsd[1] + 8, stsd[2]), b"avc1")
    length(codec, 78)
    width, height = uint(codec[1] + 24, 2), uint(codec[1] + 26, 2)
    if min(width, height) < 320 or max(width, height) > 3840 or not any(abs(width / height - r) < 0.015 for r in (16/9, 9/16, 2, 0.5)):
        fail("请使用横版16:9 / 2:1或竖版9:16 / 1:2的视频，单边320—3840像素。")
    one(boxes(codec[1] + 78, codec[2]), b"avcC")
    stts = one(samples_boxes, b"stts")
    length(stts, 8)
    entries = uint(stts[1] + 4)
    if not 1 <= entries <= 100_000 or stts[1] + 8 + entries * 8 != stts[2]:
        fail()
    ticks = samples = 0
    for index in range(entries):
        pos = stts[1] + 8 + index * 8
        number, delta = uint(pos), uint(pos + 4)
        if not number or not delta:
            fail()
        ticks += number * delta
        samples += number
    seconds = ticks / media_scale
    if samples > 15_000 or seconds > 15.001 or abs(seconds - media_seconds) > 0.05:
        fail("视频时间表异常或超过15秒，请重新裁剪导出。")
    stsz = one(samples_boxes, b"stsz")
    length(stsz, 12)
    if uint(stsz[1] + 8) != samples:
        fail()
    edits = [b for b in track if b[0] == b"edts"]
    if len(edits) > 1:
        fail()
    if edits:
        edit = one(children(edits[0]), b"elst")
        length(edit, 20)
        pos = edit[1]
        if data[pos] != 0 or uint(pos + 4) != 1 or edit[2] - pos != 20 or uint(pos + 12, signed=True) < 0 or uint(pos + 16) != 65536 or abs(uint(pos + 8) / movie_scale - (media_seconds if audio_tracks else movie_seconds)) > 0.05:
            fail("暂不支持变速或多段编辑时间表，请先重新导出视频。")
    return {"seconds": max(seconds, media_seconds if audio_tracks else movie_seconds), "width": width, "height": height, **({"hasAudio": bool(audio_tracks)} if allow_audio else {})}
