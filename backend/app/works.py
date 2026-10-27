"""私有作品文件与持久保存队列。后台只收取已提交任务，不提交生成。"""
import asyncio
import hashlib
import json
import math
import os
from weakref import WeakValueDictionary
from pathlib import Path
from uuid import uuid4

from fastapi import Request, Query
from sqlalchemy import select, insert, update, delete, func
from starlette.concurrency import run_in_threadpool
from starlette.responses import FileResponse

from .core import BusinessError, UUID, iso, now_ms, local_origin, session_hash, read_json, bounded_body, private_json, js_length
from .models import works, work_references, jobs, video_history
from .media import validate_image

MAX_REALTIME = 32 * 1024 * 1024
MAX_VIDEO = 200 * 1024 * 1024
MAX_PROMPT_STATES = 128
MAX_PROMPT_HISTORY = 4 * 1024 * 1024
KINDS = {'realtime': '实时换装', 'video': '视频换装', 'edit': '实时编辑'}
ERRORS = {'SAVE_FAILED': '视频未能保存，可重试保存已有结果。', 'SOURCE_EXPIRED': '原结果已过期，无法补存。',
          'REFERENCE_SAVE_FAILED': '服装参考图未能完整保存，请查看作品中的已保存内容。',
          'PROMPTS_SAVE_FAILED': '部分提示词未能保存，请查看作品中的已保存内容。',
          'CAPTURE_EMPTY': '未收到可保存的生成画面。', 'PARTIAL_CAPTURE': '连接中断，已保存收到的画面片段。',
          'CAPTURE_FAILED': '部分画面未能上传，已保留收到的片段。'}


class Works:
    def __init__(self, db, generation, settings):
        self.db, self.generation, self.settings = db, generation, settings
        self.root = settings.data_dir / 'users'
        self.locks = WeakValueDictionary()
        self.stopping = asyncio.Event()

    def lock(self, ident):
        return self.locks.setdefault(ident, asyncio.Lock())

    def directory(self, user_id, ident):
        if not UUID.fullmatch(user_id) or not UUID.fullmatch(ident):
            raise BusinessError('WORK_NOT_FOUND', '找不到这件作品。', 404)
        root = self.root.resolve()
        path = self.root / user_id / 'works' / ident
        for item in (self.root, self.root / user_id, path.parent, path):
            if item.is_symlink() or item.is_junction():
                raise BusinessError('STORAGE_UNAVAILABLE', '作品目录不可用。', 503)
        if not path.resolve().is_relative_to(root):
            raise BusinessError('WORK_NOT_FOUND', '找不到这件作品。', 404)
        return path

    def own(self, user_id, ident, *, deleted=False):
        with self.db.transaction() as s:
            row = s.execute(select(works).where(works.c.id == ident, works.c.user_id == user_id)).mappings().first()
        if not row or (row['state'] == 'deleted' and not deleted):
            raise BusinessError('WORK_NOT_FOUND', '找不到这件作品。', 404)
        return dict(row)

    def references(self, ident):
        with self.db.transaction() as s:
            return [dict(r) for r in s.execute(select(work_references).where(work_references.c.work_id == ident).order_by(work_references.c.created_at, work_references.c.id)).mappings()]

    @staticmethod
    def validate_prompt_state(body):
        if not isinstance(body, dict) or set(body) != {'atMs', 'instructions'}:
            raise BusinessError('INVALID_WORK_PROMPTS', '提示词记录格式无效。')
        at, items = body['atMs'], body['instructions']
        if type(at) is not int or not 0 <= at <= 15_000 or not isinstance(items, list) or not 1 <= len(items) <= 12:
            raise BusinessError('INVALID_WORK_PROMPTS', '提示词记录格式无效。')
        if any(not isinstance(text, str) or not text.strip() or js_length(text) > 500 or '\x00' in text for text in items):
            raise BusinessError('INVALID_WORK_PROMPTS', '每条提示词需为1—500个字符。')
        try:
            for text in items:
                text.encode('utf-8')
        except UnicodeError:
            raise BusinessError('INVALID_WORK_PROMPTS', '提示词记录格式无效。') from None
        return {'atMs': at, 'instructions': items}

    def prompt_history(self, user_id, ident):
        row = self.own(user_id, ident)
        if row['kind'] != 'edit':
            return []
        path = self.directory(user_id, ident) / 'prompts.json'
        try:
            if path.is_symlink() or path.is_junction():
                raise ValueError('unsafe file')
            if not path.exists():
                return []
            if path.stat().st_size > MAX_PROMPT_HISTORY:
                raise ValueError('size')
            value = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(value, list) or len(value) > MAX_PROMPT_STATES:
                raise ValueError('invalid history')
            previous = 0
            for index, state in enumerate(value):
                self.validate_prompt_state(state)
                if state['atMs'] < previous or (index == 0 and state['atMs'] != 0):
                    raise ValueError('order')
                previous = state['atMs']
            return value
        except (OSError, ValueError, BusinessError):
            raise BusinessError('WORK_PROMPTS_UNAVAILABLE', '提示词记录暂时无法读取，请重试。', 503) from None

    def prompt_state(self, user_id, ident, index, body):
        row = self.own(user_id, ident)
        state = self.validate_prompt_state(body)
        if row['kind'] != 'edit' or not 0 <= index < MAX_PROMPT_STATES:
            raise BusinessError('INVALID_WORK_PROMPTS', '提示词记录格式无效。')
        history = self.prompt_history(user_id, ident)
        if index < len(history):
            if history[index] != state:
                raise BusinessError('WORK_PROMPTS_CONFLICT', '提示词记录与已保存内容不一致。', 409)
            return
        if row['state'] != 'capturing' or index != len(history) or state['atMs'] < (history[-1]['atMs'] if history else 0) or (index == 0 and state['atMs'] != 0):
            raise BusinessError('WORK_PROMPTS_ORDER', '提示词记录顺序无效。', 409)
        data = json.dumps([*history, state], ensure_ascii=False).encode('utf-8')
        if len(data) > MAX_PROMPT_HISTORY:
            raise BusinessError('WORK_PROMPTS_LIMIT', '提示词记录超过保存上限。', 413)
        self.atomic(self.directory(user_id, ident) / 'prompts.json', data)

    def view(self, row):
        ident = row['id']
        return {'id': ident, 'kind': row['kind'], 'title': row['title'], 'state': row['state'],
                'createdAt': iso(row['created_at']), 'updatedAt': iso(row['updated_at']), 'bytes': row['bytes'],
                'seconds': row['duration_ms'] / 1000, 'extension': row['extension'],
                'message': ERRORS.get(row['error_code']), 'canRetry': row['state'] == 'failed' and row['kind'] == 'video' and row['error_code'] != 'SOURCE_EXPIRED',
                'favorite': bool(row.get('favorite', False)),
                'contentUrl': f'/api/works/{ident}/content' if row['state'] == 'ready' else None,
                'references': [{'id': r['id'], 'url': f'/api/works/{ident}/references/{r["id"]}', 'bytes': r['bytes']} for r in self.references(ident)]}

    def list(self, user_id, kind, page, size, query='', favorite=False, sort='newest'):
        condition = (works.c.user_id == user_id) & (works.c.state != 'deleted')
        if kind != 'all':
            condition &= works.c.kind == kind
        if favorite:
            condition &= works.c.favorite == 1
        query = query.strip()
        if js_length(query) > 60 or any(ord(character) < 32 for character in query):
            raise BusinessError('INVALID_WORK_SEARCH', '搜索内容需为0—60个字符，不能含控制字符。')
        if query:
            escaped = query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
            condition &= works.c.title.like(f'%{escaped}%', escape='\\')
        ordering = {
            'newest': (works.c.created_at.desc(), works.c.id.desc()),
            'oldest': (works.c.created_at.asc(), works.c.id.asc()),
            'title': (func.lower(works.c.title).asc(), works.c.title.asc(), works.c.id.asc()),
        }.get(sort)
        if ordering is None:
            raise BusinessError('INVALID_WORK_SORT', '作品排序方式无效。')
        with self.db.transaction() as s:
            total = s.execute(select(func.count()).select_from(works).where(condition)).scalar_one()
            pages = max(1, math.ceil(total / size)); page = min(page, pages)
            rows = [dict(r) for r in s.execute(select(works).where(condition).order_by(*ordering).offset((page - 1) * size).limit(size)).mappings()]
        return {'items': [self.view(r) for r in rows], 'page': page, 'pages': pages, 'pageSize': size, 'total': total}

    def create(self, user_id, body):
        if set(body) != {'id', 'kind', 'mime', 'seconds', 'ownerId'} or body.get('ownerId') != user_id:
            raise BusinessError('INVALID_WORK', '保存账号或作品参数无效。')
        ident, kind, mime, seconds = (body[k] for k in ('id', 'kind', 'mime', 'seconds'))
        if not isinstance(ident, str) or not UUID.fullmatch(ident) or kind not in ('realtime', 'edit') or mime not in ('video/mp4', 'video/webm') or type(seconds) is not int or seconds not in (15, 30, 60):
            raise BusinessError('INVALID_WORK', '作品参数无效。')
        self.directory(user_id, ident)
        with self.db.transaction(True) as s:
            old = s.execute(select(works).where(works.c.id == ident)).mappings().first()
            if old:
                if old['user_id'] != user_id or old['state'] == 'deleted' or old['kind'] != kind or old['mime'] != mime:
                    raise BusinessError('WORK_NOT_FOUND', '找不到这件作品。', 404)
                return dict(old)
            row = dict(id=ident, user_id=user_id, kind=kind, source_id=None, title=KINDS[kind], state='capturing', mime=mime,
                       extension='mp4' if mime == 'video/mp4' else 'webm', bytes=0, chunks=0, duration_ms=seconds * 1000,
                       created_at=now_ms(), updated_at=now_ms(), error_code=None, retries=0)
            s.execute(insert(works).values(**row))
        return row

    @staticmethod
    def atomic(path, data):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if path.is_symlink() or path.is_junction():
            raise OSError('unsafe file')
        temporary = path.with_name('.tmp-' + str(uuid4()))
        try:
            with temporary.open('xb') as out:
                out.write(data); out.flush(); os.fsync(out.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def reference(self, user_id, ident, ref_id, mime, data):
        row = self.own(user_id, ident)
        if not UUID.fullmatch(ref_id) or mime not in ('image/png', 'image/jpeg', 'image/webp'):
            raise BusinessError('INVALID_REFERENCE', '参考图片格式无效。')
        try:
            validate_image(data, mime)
        except ValueError:
            raise BusinessError('INVALID_REFERENCE', '参考图片无法读取，请使用有效的JPG、PNG或WebP图片。') from None
        refs = self.references(ident)
        extension = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}[mime]
        path = self.directory(user_id, ident) / f'reference-{ref_id}.{extension}'
        old = next((r for r in refs if r['id'] == ref_id), None)
        if old:
            if old['mime'] != mime or not path.is_file() or path.read_bytes() != data:
                raise BusinessError('REFERENCE_CONFLICT', '这张参考图的保存内容不一致。', 409)
            return
        if row['state'] not in ('capturing', 'waiting', 'saving') or len(refs) >= 24:
            raise BusinessError('REFERENCE_LIMIT', '这件作品不能再添加参考图。', 409)
        self.atomic(path, data)
        with self.db.transaction(True) as s:
            s.execute(insert(work_references).values(id=ref_id, work_id=ident, mime=mime, extension=extension, bytes=len(data), created_at=now_ms()))

    def chunk(self, user_id, ident, index, data):
        row = self.own(user_id, ident)
        if row['kind'] == 'video' or not data or index < 0 or index > 600:
            raise BusinessError('INVALID_CHUNK', '录像片段无效。')
        directory = self.directory(user_id, ident)
        path = directory / f'chunk-{index:06d}'
        if index < row['chunks']:
            if not path.is_file() or hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(data).digest():
                raise BusinessError('CHUNK_CONFLICT', '录像片段与已保存内容不一致。', 409)
            return
        if row['state'] != 'capturing' or index != row['chunks']:
            raise BusinessError('CHUNK_ORDER', '录像片段顺序无效。', 409)
        if row['bytes'] + len(data) > MAX_REALTIME:
            raise BusinessError('WORK_TOO_LARGE', '实时录像超过32MB保存上限。', 413)
        self.atomic(path, data)
        with self.db.transaction(True) as s:
            s.execute(update(works).where(works.c.id == ident).values(chunks=index + 1, bytes=row['bytes'] + len(data), updated_at=now_ms()))

    def complete(self, user_id, ident, interrupted=False):
        row = self.own(user_id, ident)
        if row['state'] != 'capturing':
            return
        self.change_state(ident, 'saving' if row['chunks'] else 'failed', 'PARTIAL_CAPTURE' if interrupted and row['chunks'] else None if row['chunks'] else 'CAPTURE_EMPTY')

    def complete_request(self, user_id, ident, body):
        row = self.own(user_id, ident)
        if row['state'] != 'capturing':
            return
        if body.get('durationMs') is not None:
            with self.db.transaction(True) as s:
                s.execute(update(works).where(works.c.id == ident).values(duration_ms=body['durationMs']))
        self.complete(user_id, ident, body.get('interrupted', False))
        if body.get('referenceFailed') and row['chunks']:
            with self.db.transaction(True) as s:
                s.execute(update(works).where(works.c.id == ident).values(error_code='REFERENCE_SAVE_FAILED'))
        if body.get('promptsFailed') and row['chunks']:
            with self.db.transaction(True) as s:
                s.execute(update(works).where(works.c.id == ident).values(error_code='PROMPTS_SAVE_FAILED'))

    def change_state(self, ident, state, error=None, **values):
        with self.db.transaction(True) as s:
            s.execute(update(works).where(works.c.id == ident, works.c.state != 'deleted').values(state=state, error_code=error, updated_at=now_ms(), **values))

    def finalize(self, row):
        directory = self.directory(row['user_id'], row['id'])
        temporary = directory / '.assembling'
        target = directory / f'result.{row["extension"]}'
        try:
            with temporary.open('wb') as out:
                for index in range(row['chunks']):
                    with (directory / f'chunk-{index:06d}').open('rb') as source:
                        while data := source.read(256 * 1024):
                            out.write(data)
                out.flush(); os.fsync(out.fileno())
            self.validate_video(temporary, row['extension'])
            if temporary.stat().st_size != row['bytes']:
                raise ValueError('incomplete')
            os.replace(temporary, target)
            self.change_state(row['id'], 'ready', row['error_code'])
            # 分片不再需要；已ready后不会接受新片段。
            for index in range(row['chunks']):
                (directory / f'chunk-{index:06d}').unlink(missing_ok=True)
        except Exception:
            self.change_state(row['id'], 'failed', 'SAVE_FAILED')
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def validate_video(path, extension):
        with path.open('rb') as source:
            head = source.read(32)
        if not (extension == 'mp4' and head[4:8] == b'ftyp' or extension == 'webm' and head[:4] == b'\x1aE\xdf\xa3'):
            raise ValueError('invalid media')

    def ensure_video(self, job):
        with self.db.transaction(True) as s:
            old = s.execute(select(works).where(works.c.kind == 'video', works.c.source_id == job['id'])).mappings().first()
            if old:
                return dict(old)
            title = s.execute(select(video_history.c.title).where(video_history.c.job_id == job['id'])).scalar_one_or_none() or KINDS['video']
            row = dict(id=str(uuid4()), user_id=job['user_id'], kind='video', source_id=job['id'], title=title,
                       state='waiting', mime='video/mp4', extension='mp4', bytes=0, chunks=0, duration_ms=job['seconds_milli'],
                       created_at=job['created_at'], updated_at=now_ms(), error_code=None, retries=0)
            s.execute(insert(works).values(**row))
            return row

    def video_reference(self, job, data, mime):
        row = self.ensure_video(job)
        self.reference(job['user_id'], row['id'], str(uuid4()), mime, data)

    async def save_video(self, row):
        job = await run_in_threadpool(self.generation.own_job, row['user_id'], row['source_id'])
        if job['state'] == 'failed':
            await run_in_threadpool(self.change_state, row['id'], 'failed', 'SAVE_FAILED'); return
        if now_ms() >= job['expires_at']:
            await run_in_threadpool(self.change_state, row['id'], 'failed', 'SOURCE_EXPIRED'); return
        if job['state'] in ('pending', 'processing'):
            await self.generation.get_video(row['user_id'], job['id'])
            return
        if job['state'] != 'completed' or not job['provider_id']:
            return
        from .generation import JOB_URL
        directory = self.directory(row['user_id'], row['id'])
        await run_in_threadpool(lambda: directory.mkdir(parents=True, exist_ok=True, mode=0o700))
        temporary = directory / '.downloading'
        await run_in_threadpool(self.change_state, row['id'], 'saving')
        try:
            size = 0
            async with asyncio.timeout(180):
                async with self.generation.client.stream('GET', f"{JOB_URL}/{job['provider_id']}/content", headers={'X-API-KEY': self.generation.key()}, timeout=120) as response:
                    if not response.is_success or response.headers.get('content-type', '').split(';')[0] not in ('video/mp4', 'application/octet-stream'):
                        raise ValueError('upstream')
                    if int(response.headers.get('content-length', '0')) > MAX_VIDEO:
                        raise ValueError('size')
                    with temporary.open('wb') as out:
                        async for chunk in response.aiter_bytes(256 * 1024):
                            size += len(chunk)
                            if size > MAX_VIDEO:
                                raise ValueError('size')
                            await run_in_threadpool(out.write, chunk)
                        await run_in_threadpool(out.flush)
                        await run_in_threadpool(os.fsync, out.fileno())
            await run_in_threadpool(self.validate_video, temporary, 'mp4')
            await run_in_threadpool(os.replace, temporary, directory / 'result.mp4')
            await run_in_threadpool(self.change_state, row['id'], 'ready', row['error_code'] if row['error_code'] == 'REFERENCE_SAVE_FAILED' else None, bytes=size)
        except Exception:
            retries = row['retries'] + 1
            await run_in_threadpool(self.change_state, row['id'], 'failed' if retries >= 3 else 'saving', 'SAVE_FAILED', retries=retries)
        finally:
            temporary.unlink(missing_ok=True)

    def pending(self):
        with self.db.transaction() as s:
            source_jobs = [dict(r) for r in s.execute(select(jobs).where(jobs.c.provider_id.is_not(None), jobs.c.state.in_(('pending', 'processing', 'completed')))).mappings()]
        for job in source_jobs:
            self.ensure_video(job)
        with self.db.transaction() as s:
            return [dict(r) for r in s.execute(select(works).where(works.c.state.in_(('waiting', 'capturing', 'saving', 'deleted'))).order_by(works.c.updated_at)).mappings()]

    async def tick(self):
        for original in await run_in_threadpool(self.pending):
            ident = original['id']
            async with self.lock(ident):
                row = await run_in_threadpool(self.own, original['user_id'], ident, deleted=True)
                try:
                    if row['state'] == 'deleted':
                        await run_in_threadpool(self.remove_files, row); continue
                    if row['state'] == 'capturing':
                        if now_ms() - row['updated_at'] > 120_000:
                            await run_in_threadpool(self.complete, row['user_id'], ident, True)
                    elif row['kind'] == 'video':
                        if now_ms() - row['updated_at'] >= (10_000 if row['retries'] else 2000):
                            await self.save_video(row)
                    elif row['state'] == 'saving':
                        await run_in_threadpool(self.finalize, row)
                except Exception:
                    # 不记录凭据、媒体、路径或上游异常；本轮失败由作品状态表达。
                    if row['kind'] != 'video':
                        await run_in_threadpool(self.change_state, ident, 'failed', 'SAVE_FAILED')

    async def run(self):
        while not self.stopping.is_set():
            try:
                if not self.settings.maintenance:
                    await self.tick()
            except Exception:
                pass  # 迁移/维护期间不访问业务或输出原始异常。
            try:
                await asyncio.wait_for(self.stopping.wait(), timeout=2)
            except TimeoutError:
                pass

    def remove_files(self, row):
        directory = self.directory(row['user_id'], row['id'])
        if directory.exists():
            for item in directory.iterdir():
                if item.is_file() and not item.is_symlink():
                    item.unlink(missing_ok=True)
            directory.rmdir()

    def change(self, user_id, ident, body):
        row = self.own(user_id, ident)
        if set(body) == {'title'}:
            title = body['title']
            if not isinstance(title, str) or not 1 <= js_length(title.strip()) <= 60 or any(ord(c) < 32 for c in title):
                raise BusinessError('INVALID_WORK_TITLE', '作品名称需为1—60个字符，不能含换行。')
            with self.db.transaction(True) as s:
                s.execute(update(works).where(works.c.id == ident).values(title=title.strip(), updated_at=now_ms()))
        elif set(body) == {'favorite'}:
            if type(body['favorite']) is not bool:
                raise BusinessError('INVALID_WORK_FAVORITE', '作品收藏状态无效。')
            # 收藏不改updated_at，避免干扰生成保存队列的超时判断。
            with self.db.transaction(True) as s:
                s.execute(update(works).where(works.c.id == ident).values(favorite=int(body['favorite'])))
        elif body == {'action': 'retry'}:
            if row['kind'] != 'video' or row['state'] != 'failed' or row['error_code'] == 'SOURCE_EXPIRED':
                raise BusinessError('WORK_RETRY_UNAVAILABLE', '这件作品暂时不能重试保存。', 409)
            self.change_state(ident, 'waiting', retries=0)
        elif body == {'action': 'delete'}:
            if row['state'] in ('capturing', 'waiting', 'saving'):
                raise BusinessError('WORK_SAVING', '请等待生成和保存结束后再删除。', 409)
            with self.db.transaction(True) as s:
                s.execute(update(works).where(works.c.id == ident).values(state='deleted', title='', favorite=0, error_code=None, updated_at=now_ms()))
                s.execute(delete(work_references).where(work_references.c.work_id == ident))
            self.remove_files(row)
            return {'accepted': True}
        else:
            raise BusinessError('INVALID_WORK', '作品操作无效。')
        return self.view(self.own(user_id, ident))


def install_works(app, accounts, settings):
    from .schemas import WorkPage, WorkItem, WorkPromptHistory

    async def owner(request, mutation=False, bound=False):
        local_origin(request, settings, mutation)
        uid = await run_in_threadpool(accounts.require, session_hash(request))
        if bound and request.headers.get('x-work-owner') != uid:
            raise BusinessError('WORK_OWNER_CHANGED', '账号已变更，已停止原账号的上传。', 409)
        return uid

    @app.get('/api/works', response_model=WorkPage)
    async def work_list(request: Request, kind: str = 'all', page: int = Query(1, ge=1, le=100000), pageSize: int = Query(9, ge=1, le=24), q: str = '', favorite: bool = False, sort: str = 'newest'):
        uid = await owner(request)
        if kind not in ('all', *KINDS):
            raise BusinessError('INVALID_WORK_KIND', '作品分类无效。')
        return private_json(await run_in_threadpool(app.state.works.list, uid, kind, page, pageSize, q, favorite, sort))

    @app.post('/api/works', response_model=WorkItem)
    async def work_create(request: Request):
        uid = await owner(request, True, True)
        body = await read_json(request, True)
        async with app.state.works.lock(body.get('id', 'invalid') if isinstance(body.get('id'), str) else 'invalid'):
            row = await run_in_threadpool(app.state.works.create, uid, body)
        return private_json(await run_in_threadpool(app.state.works.view, row), 201)

    @app.post('/api/works/{ident}/chunks/{index}')
    async def work_chunk(ident: str, index: int, request: Request):
        uid = await owner(request, True, True)
        await run_in_threadpool(app.state.works.own, uid, ident)
        data = await bounded_body(request, MAX_REALTIME, timeout=120)
        async with app.state.works.lock(ident):
            await run_in_threadpool(app.state.works.chunk, uid, ident, index, data)
        return private_json({'accepted': True})

    @app.post('/api/works/{ident}/complete')
    async def work_complete(ident: str, request: Request):
        uid = await owner(request, True, True)
        body = await read_json(request, True)
        if set(body) - {'referenceFailed', 'promptsFailed', 'durationMs', 'interrupted'} or any(type(body[key]) is not bool for key in ('referenceFailed', 'promptsFailed', 'interrupted') if key in body):
            raise BusinessError('INVALID_WORK', '保存参数无效。')
        duration = body.get('durationMs')
        if duration is not None and (type(duration) is not int or not 0 <= duration <= 60_000):
            raise BusinessError('INVALID_WORK', '保存时长无效。')
        async with app.state.works.lock(ident):
            await run_in_threadpool(app.state.works.complete_request, uid, ident, body)
        return private_json({'accepted': True}, 202)

    @app.get('/api/works/{ident}', response_model=WorkItem)
    async def work_get(ident: str, request: Request):
        uid = await owner(request, bound=bool(request.headers.get('x-work-owner')))
        row = await run_in_threadpool(app.state.works.own, uid, ident)
        return private_json(await run_in_threadpool(app.state.works.view, row))

    @app.get('/api/works/{ident}/prompts', response_model=WorkPromptHistory)
    async def work_prompts(ident: str, request: Request):
        uid = await owner(request, bound=bool(request.headers.get('x-work-owner')))
        states = await run_in_threadpool(app.state.works.prompt_history, uid, ident)
        return private_json({'states': states})

    @app.post('/api/works/{ident}/prompts/{index}')
    async def work_prompt_state(ident: str, index: int, request: Request):
        uid = await owner(request, True, True)
        await run_in_threadpool(app.state.works.own, uid, ident)
        if request.headers.get('content-type', '').split(';')[0].strip() != 'application/json':
            raise BusinessError('INVALID_REQUEST', '请使用JSON请求。', 415)
        try:
            body = json.loads((await bounded_body(request, 32 * 1024)).decode('utf-8'))
        except (ValueError, UnicodeError):
            raise BusinessError('INVALID_WORK_PROMPTS', '提示词记录格式无效。') from None
        async with app.state.works.lock(ident):
            await run_in_threadpool(app.state.works.prompt_state, uid, ident, index, body)
        return private_json({'accepted': True})

    @app.post('/api/works/{ident}/references/{ref_id}')
    async def work_reference(ident: str, ref_id: str, request: Request):
        uid = await owner(request, True, True)
        await run_in_threadpool(app.state.works.own, uid, ident)
        data = await bounded_body(request, 10 * 1024 * 1024)
        mime = request.headers.get('content-type', '').split(';')[0]
        async with app.state.works.lock(ident):
            await run_in_threadpool(app.state.works.reference, uid, ident, ref_id, mime, data)
        return private_json({'accepted': True})

    @app.post('/api/works/{ident}')
    async def work_change(ident: str, request: Request):
        uid = await owner(request, True, bool(request.headers.get('x-work-owner')))
        body = await read_json(request, True)
        async with app.state.works.lock(ident):
            return private_json(await run_in_threadpool(app.state.works.change, uid, ident, body))

    @app.get('/api/works/{ident}/content')
    async def work_content(ident: str, request: Request):
        uid = await owner(request)
        row = await run_in_threadpool(app.state.works.own, uid, ident)
        if row['state'] != 'ready':
            raise BusinessError('WORK_NOT_READY', '作品尚未保存完成。', 409)
        path = app.state.works.directory(uid, ident) / f'result.{row["extension"]}'
        if not path.is_file() or path.is_symlink():
            raise BusinessError('WORK_FILE_MISSING', '作品文件暂不可用。', 404)
        return FileResponse(path, media_type=row['mime'], filename=f'{row["title"]}.{row["extension"]}', content_disposition_type='attachment' if request.query_params.get('download') == '1' else 'inline', headers={'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin'})

    @app.get('/api/works/{ident}/references/{ref_id}')
    async def work_reference_content(ident: str, ref_id: str, request: Request):
        uid = await owner(request)
        await run_in_threadpool(app.state.works.own, uid, ident)
        ref = next((r for r in await run_in_threadpool(app.state.works.references, ident) if r['id'] == ref_id), None)
        if not ref:
            raise BusinessError('REFERENCE_NOT_FOUND', '找不到这张参考图。', 404)
        path = app.state.works.directory(uid, ident) / f'reference-{ref_id}.{ref["extension"]}'
        if not path.is_file() or path.is_symlink():
            raise BusinessError('REFERENCE_NOT_FOUND', '找不到这张参考图。', 404)
        return FileResponse(path, media_type=ref['mime'], headers={'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin'})
