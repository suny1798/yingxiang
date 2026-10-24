"""只管理任务的名称/归档，不保存媒体，不删除任务/预算，也不调用供应商。"""
import math
from sqlalchemy import select, func, insert, update
from .models import jobs, video_history
from .core import BusinessError, now_ms, js_length


class VideoHistory:
    def __init__(self, db, generation):
        self.db, self.generation = db, generation

    def item(self, row):
        return {**self.generation.job_view(row), "title": row.get("title") or "视频换装", "archived": bool(row.get("archived", 0))}

    def list(self, user_id, archived=False, page=1, page_size=3):
        source = jobs.outerjoin(video_history, jobs.c.id == video_history.c.job_id)
        condition = (jobs.c.user_id == user_id) & (func.coalesce(video_history.c.archived, 0) == int(archived))
        with self.db.transaction() as session:
            total = session.execute(select(func.count()).select_from(source).where(condition)).scalar_one()
            pages = max(1, math.ceil(total / page_size)); page = min(page, pages)
            rows = session.execute(select(jobs, video_history.c.title, video_history.c.archived).select_from(source).where(condition).order_by(jobs.c.created_at.desc(), jobs.c.id.desc()).offset((page - 1) * page_size).limit(page_size)).mappings().all()
            return {"items": [self.item(row) for row in rows], "page": page, "pageSize": page_size, "pages": pages, "total": total}

    def change(self, user_id, ident, body):
        if not isinstance(body, dict) or not body or set(body) - {"title", "archived"}:
            raise BusinessError("INVALID_VIDEO_HISTORY", "请填写视频名称或选择归档操作。")
        if "title" in body:
            if not isinstance(body["title"], str) or not 1 <= js_length(body["title"].strip()) <= 60 or any(ord(c) < 32 for c in body["title"]):
                raise BusinessError("INVALID_VIDEO_TITLE", "视频名称需为1—60个字符，不能含换行。")
        if "archived" in body and type(body["archived"]) is not bool:
            raise BusinessError("INVALID_VIDEO_HISTORY", "归档状态无效，请刷新后重试。")
        with self.db.transaction(True) as session:
            row = session.execute(select(jobs).where(jobs.c.id == ident, jobs.c.user_id == user_id)).mappings().first()
            if not row:
                raise BusinessError("VIDEO_NOT_FOUND", "找不到这个视频任务。", 404)
            if body.get("archived") and row["state"] not in ("completed", "failed"):
                raise BusinessError("VIDEO_HISTORY_ACTIVE", "任务完成或失败后才可归档，待核查任务请先确认状态。", 409)
            previous = session.execute(select(video_history).where(video_history.c.job_id == ident)).mappings().first()
            title = body["title"].strip() if "title" in body else previous["title"] if previous else "视频换装"
            archived = int(body["archived"]) if "archived" in body else previous["archived"] if previous else 0
            values = {"title": title, "archived": archived, "updated_at": now_ms()}
            if previous:
                session.execute(update(video_history).where(video_history.c.job_id == ident).values(**values))
            else:
                session.execute(insert(video_history).values(job_id=ident, **values))
            return self.item({**row, **values})
