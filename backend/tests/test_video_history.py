from uuid import uuid4
from dataclasses import replace
from sqlalchemy import select,insert,func
from app.models import jobs,users,reservations,campaigns
from app.core import now_ms
from conftest import signup


def seed(client,uid,state='completed',expired=False):
    ident=str(uuid4()); now=now_ms()
    with client.app.state.db.transaction(True) as s:
        if not s.execute(select(campaigns.c.scene).where(campaigns.c.scene=='video')).first():
            s.execute(insert(campaigns).values(scene='video',created_at=now))
        s.execute(insert(jobs).values(id=ident,user_id=uid,state=state,created_at=now,expires_at=now-1 if expired else now+86400000,seconds_milli=8000,micro_usd=320000,provider_id='fixture_'+ident))
        s.execute(insert(reservations).values(id=ident,scene='video',user_id=uid,micro_usd=320000,lease_until=now+86400000,created_at=now))
    return ident


def test_history_default_paging_names_and_safe_archive_restore(client):
    uid=signup(client); ids=[seed(client,uid) for _ in range(5)]
    first=client.get('/api/video/history').json()
    assert first['total']==5 and first['pages']==2 and len(first['items'])==3
    assert client.get('/api/video/history?page=999').json()['page']==2
    ident=ids[0]
    result=client.post(f'/api/video/jobs/{ident}/history',json={'title':'  我的春日穿搭  '})
    assert result.status_code==200 and result.json()['title']=='我的春日穿搭'
    assert client.post(f'/api/video/jobs/{ident}/history',json={'archived':True}).json()['archived'] is True
    assert client.get('/api/video/history').json()['total']==4
    archived=client.get('/api/video/history?archived=true').json()
    assert archived['total']==1 and archived['items'][0]['title']=='我的春日穿搭'
    assert ident not in [j['id'] for j in client.get('/api/video/jobs').json()['jobs']]
    assert client.post(f'/api/video/jobs/{ident}/history',json={'archived':False}).json()['title']=='我的春日穿搭'
    assert client.get('/api/video/history').json()['total']==5


def test_history_ownership_login_origin_and_validation(client):
    assert client.get('/api/video/history').status_code==401
    uid=signup(client); ident=seed(client,uid)
    for body in ({},{'title':''},{'title':' '},{'title':'x'*61},{'title':'line\nbreak'},{'title':None},{'archived':1},{'archived':None},{'unknown':True}):
        assert client.post(f'/api/video/jobs/{ident}/history',json=body).status_code==400
    assert client.post(f'/api/video/jobs/{ident}/history',json={'title':'valid'},headers={'origin':'https://invalid.example'}).status_code==403
    assert client.get('/api/video/history?page=0').status_code==400
    assert client.get('/api/video/history?pageSize=999').status_code==400
    client.post('/api/account/logout'); signup(client,'other_fixture')
    assert client.get('/api/video/history').json()['items']==[]
    assert client.post(f'/api/video/jobs/{ident}/history',json={'archived':True}).status_code==404


def test_archiving_does_not_release_budget_and_pending_cannot_hide(client):
    uid=signup(client); completed=seed(client,uid)
    gen=client.app.state.generation
    gen.settings=replace(gen.settings,env={'DECART_API_KEY':'fixture_key','YINGXIANG_VIDEO_ENABLED':'true','YINGXIANG_VIDEO_BUDGET_USD':'5','YINGXIANG_VIDEO_MAX_JOBS':'1'})
    assert client.post(f'/api/video/jobs/{completed}/history',json={'archived':True}).status_code==200
    assert not gen.video_status(uid)['available']
    for state in ('pending','processing','unknown','submitting'):
        ident=seed(client,uid,state)
        assert client.post(f'/api/video/jobs/{ident}/history',json={'archived':True}).status_code==409
    with client.app.state.db.transaction() as s:
        assert s.execute(select(func.count()).select_from(jobs)).scalar_one()==5
        assert s.execute(select(func.sum(reservations.c.micro_usd))).scalar_one()==1600000


def test_expired_items_are_visible_and_history_survives_app_recreation(client):
    from app.video_history import VideoHistory
    uid=signup(client); ident=seed(client,uid,expired=True)
    client.post(f'/api/video/jobs/{ident}/history',json={'title':'过期结果','archived':True})
    restored=VideoHistory(client.app.state.db,client.app.state.generation)
    item=restored.list(uid,True)['items'][0]
    assert item['expired'] and item['title']=='过期结果' and item['archived']
    assert client.get(f'/api/video/jobs/{ident}/content').status_code==410


def test_upgrade_0001_keeps_old_jobs_and_budget(settings):
    from alembic import command
    from alembic.config import Config
    from pathlib import Path
    from app.db import Database
    from app.generation import Generation
    from app.video_history import VideoHistory
    config=Config(str(Path(__file__).resolve().parents[1]/'alembic.ini'));config.attributes['settings']=settings
    command.upgrade(config,'0001')
    db=Database(settings.database)
    uid,ident=str(uuid4()),str(uuid4());now=now_ms()
    with db.transaction(True) as s:
        s.execute(insert(users).values(id=uid,username='fixture',salt='fixture',password_hash='fixture',created_at=now))
        s.execute(insert(jobs).values(id=ident,user_id=uid,state='completed',created_at=now,expires_at=now+86400000,seconds_milli=8000,micro_usd=320000))
        s.execute(insert(campaigns).values(scene='video',created_at=now))
        s.execute(insert(reservations).values(id=ident,scene='video',user_id=uid,micro_usd=320000,lease_until=now+86400000,created_at=now))
    command.upgrade(config,'head');assert db.readiness()
    history=VideoHistory(db,Generation(db,None,settings,None)).list(uid)
    assert history['total']==1 and history['items'][0]['title']=='视频换装'
    with db.transaction() as s:assert s.execute(select(reservations.c.micro_usd)).scalar_one()==320000
    db.close()
