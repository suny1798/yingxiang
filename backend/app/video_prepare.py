"""普通H.264 MP4的内存拆轨：只复制视频chunk，不带出音轨、音频字节或用户元数据。"""
import struct
from .media import inspect_video


def prepare_video(data):
    info = inspect_video(data, allow_audio=True)
    if not info["hasAudio"]:
        return data, inspect_video(data), False

    def fail():
        raise ValueError("这段视频的结构暂时无法自动处理，请换一段普通MP4视频。")

    def uint(pos, width=4):
        if pos < 0 or pos + width > len(data):
            fail()
        return int.from_bytes(data[pos:pos + width], "big")

    def boxes(start, end):
        result = []
        while start < end:
            if start + 8 > end or len(result) > 10_000:
                fail()
            size, header = uint(start), 8
            if size == 1:
                size, header = uint(start + 8, 8), 16
            elif size == 0:
                size = end - start
            if size < header or start + size > end:
                fail()
            result.append((data[start + 4:start + 8], start, start + header, start + size))
            start += size
        return result

    def children(box):
        return boxes(box[2], box[3])

    def one(items, kind):
        found = [item for item in items if item[0] == kind]
        if len(found) != 1:
            fail()
        return found[0]

    def payload(box):
        return data[box[2]:box[3]]

    def atom(kind, value):
        return struct.pack(">I4s", len(value) + 8, kind) + value

    top = boxes(0, len(data))
    movie = children(one(top, b"moov"))
    track = next(t for t in movie if t[0] == b"trak" and payload(one(children(one(children(t), b"mdia")), b"hdlr"))[8:12] == b"vide")
    track_items = children(track)
    media = children(one(track_items, b"mdia"))
    minf = children(one(media, b"minf"))
    table = children(one(minf, b"stbl"))
    allowed = {b"stsd", b"stts", b"stss", b"stsc", b"stsz", b"stco", b"co64", b"ctts", b"sdtp", b"sbgp", b"sgpd"}
    if any(item[0] not in allowed for item in table):
        fail()
    offsets = [b for b in table if b[0] in (b"stco", b"co64")]
    if len(offsets) != 1:
        fail()
    offsets = offsets[0]
    width = 8 if offsets[0] == b"co64" else 4
    chunk_count = uint(offsets[2] + 4)
    if not 1 <= chunk_count <= 15_000 or offsets[3] - offsets[2] != 8 + chunk_count * width:
        fail()
    chunk_offsets = [uint(offsets[2] + 8 + i * width, width) for i in range(chunk_count)]
    sizes = one(table, b"stsz")
    fixed, sample_count = uint(sizes[2] + 4), uint(sizes[2] + 8)
    if not 1 <= sample_count <= 15_000 or sizes[3] - sizes[2] != 12 + (0 if fixed else sample_count * 4):
        fail()
    sample_sizes = [fixed] * sample_count if fixed else [uint(sizes[2] + 12 + i * 4) for i in range(sample_count)]
    if any(not value for value in sample_sizes):
        fail()
    mapping = one(table, b"stsc")
    mapping_count = uint(mapping[2] + 4)
    if not 1 <= mapping_count <= chunk_count or mapping[3] - mapping[2] != 8 + mapping_count * 12:
        fail()
    entries = [tuple(uint(mapping[2] + 8 + i * 12 + j * 4) for j in range(3)) for i in range(mapping_count)]
    if entries[0][0] != 1 or any(not 1 <= first <= chunk_count or not per or description != 1 for first, per, description in entries) or any(entries[i][0] >= entries[i + 1][0] for i in range(len(entries) - 1)):
        fail()
    mdats = [b for b in top if b[0] == b"mdat"]
    chunks, ranges, next_sample, mapping_index = [], [], 0, 0
    for i, offset in enumerate(chunk_offsets, 1):
        while mapping_index + 1 < len(entries) and entries[mapping_index + 1][0] <= i:
            mapping_index += 1
        per = entries[mapping_index][1]
        if next_sample + per > sample_count:
            fail()
        size = sum(sample_sizes[next_sample:next_sample + per])
        if not any(box[2] <= offset and offset + size <= box[3] for box in mdats):
            fail()
        ranges.append((offset, offset + size))
        chunks.append(data[offset:offset + size])
        next_sample += per
    if next_sample != sample_count:
        fail()
    ordered = sorted(ranges)
    if any(ordered[i][1] > ordered[i + 1][0] for i in range(len(ordered) - 1)):
        fail()

    def build_movie(new_offsets):
        # 输出小于25MB，统一32位offset；头部长度固定，第二次填入实际位置。
        stco = atom(b"stco", b"\0" * 4 + struct.pack(">I", chunk_count) + b"".join(struct.pack(">I", value) for value in new_offsets))
        stbl = atom(b"stbl", b"".join(stco if box[0] in (b"stco", b"co64") else atom(box[0], payload(box)) for box in table))
        # 显式重建本文件数据引用，避免继承外部数据引用或路径。
        dinf = atom(b"dinf", atom(b"dref", b"\0" * 4 + struct.pack(">I", 1) + atom(b"url ", b"\0\0\0\1")))
        minimum = atom(b"minf", atom(b"vmhd", payload(one(minf, b"vmhd"))) + dinf + stbl)
        mdia = atom(b"mdia", b"".join(atom(kind, payload(one(media, kind))) for kind in (b"mdhd", b"hdlr")) + minimum)
        trak = atom(b"trak", b"".join(atom(box[0], payload(box)) for box in track_items if box[0] in (b"tkhd", b"edts")) + mdia)
        mvhd = bytearray(payload(one(movie, b"mvhd")))
        version = mvhd[0]
        scale_offset, duration_offset, duration_width = (20, 24, 8) if version else (12, 16, 4)
        scale = int.from_bytes(mvhd[scale_offset:scale_offset + 4], "big")
        mvhd[duration_offset:duration_offset + duration_width] = round(info["seconds"] * scale).to_bytes(duration_width, "big")
        return atom(b"moov", atom(b"mvhd", mvhd) + trak)

    ftyp = atom(b"ftyp", payload(one(top, b"ftyp")))
    movie_bytes = build_movie([0] * chunk_count)
    position = len(ftyp) + len(movie_bytes) + 8
    new_offsets = []
    for chunk in chunks:
        new_offsets.append(position)
        position += len(chunk)
    result = ftyp + build_movie(new_offsets) + atom(b"mdat", b"".join(chunks))
    return result, inspect_video(result), True
