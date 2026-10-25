from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
from types import SimpleNamespace
import json
import pytest
from sqlalchemy import text, select
from app.core import digest, BusinessError
from app.models import credit_packs, events
from app.payments import CREDIT_PLANS, product, checkout_params
from conftest import signup


def paid(order):
    return {'id': 'cs_test_' + order['id'], 'livemode': False, 'mode': 'payment',
            'client_reference_id': order['id'], 'metadata': {'orderId': order['id'], 'userId': order['user_id'], 'sku': order['sku']},
            'currency': 'cny', 'amount_total': order['amount'], 'status': 'complete', 'payment_status': 'paid'}


@pytest.mark.parametrize('plan_id,amount,credits,scenes', [
    ('light',3900,120,['tryon','video']), ('creator',12900,450,['tryon','video','edit']), ('plus',32900,1200,['tryon','video','edit'])])
def test_packages_paid_once_nonexpiring_isolated(client, app, plan_id, amount, credits, scenes):
    signup(client)
    hashed = digest(client.cookies.get('yingxiang_session'))
    before = app.state.accounts.me(hashed)
    pay = app.state.payments
    order = pay.reserve(hashed, f'credits-v1-{plan_id}', str(uuid4()), app.state.settings.public_origin)
    assert (order['amount'],order['credits'],order['seconds'],order['count']) == (amount,credits,None,None)
    params = checkout_params(order, app.state.settings.public_origin)
    assert params['line_items'][0]['price_data']['unit_amount'] == amount
    assert '/account/orders?payment=returned&orderId=' in params['success_url']
    value = paid(order)
    with pytest.raises(BusinessError):
        pay.apply({**value, 'amount_total': 1}, 'evt_bad')
    assert pay.list(hashed)['sandboxPointBalance'] == 0
    with ThreadPoolExecutor(2) as pool:
        list(pool.map(lambda _: pay.apply(value, 'evt_once'), range(2)))
    pay.apply(value, 'evt_again')
    pay.apply({**value,'status':'expired','payment_status':'unpaid'}, 'evt_late')
    result = pay.list(hashed)
    assert result['sandboxPointBalance'] == credits
    assert result['sandboxCredits'] == {}
    assert result['orders'][0]['state'] == 'paid'
    assert result['orders'][0]['planId'] == plan_id
    assert result['sandboxCreditPacks'][0]['scenes'] == scenes
    assert app.state.accounts.me(hashed) == before
    assert pay.reserve(hashed, order['sku'], order['request_id'], app.state.settings.public_origin)['id'] == order['id']
    with app.state.db.transaction(True) as session:
        # 积分放置一年后仍在，积分表没有到期字段。
        session.execute(text('UPDATE sandbox_credit_packs SET created_at=1'))
        assert 'expires_at' not in credit_packs.c
    assert pay.list(hashed)['sandboxPointBalance'] == credits
    client.post('/api/account/logout')
    signup(client,'other_user')
    other = digest(client.cookies.get('yingxiang_session'))
    assert pay.list(other)['sandboxPointBalance'] == 0
    with pytest.raises(BusinessError):
        pay.own(other,order['id'])


def test_credit_grant_rollback(client, app):
    signup(client)
    hashed = digest(client.cookies.get('yingxiang_session'))
    pay = app.state.payments
    order = pay.reserve(hashed,'credits-v1-light',str(uuid4()),app.state.settings.public_origin)
    with app.state.db.transaction(True) as session:
        session.execute(text("CREATE TRIGGER synthetic_failure BEFORE INSERT ON sandbox_credit_packs BEGIN SELECT RAISE(ABORT,'fixture'); END"))
    with pytest.raises(Exception):
        pay.apply(paid(order),'evt_atomic')
    assert pay.own(hashed,order['id'])['fulfilled_at'] is None
    assert pay.list(hashed)['sandboxPointBalance'] == 0
    with app.state.db.transaction(True) as session:
        assert session.execute(select(events)).first() is None
        session.execute(text('DROP TRIGGER synthetic_failure'))
    pay.apply(paid(order),'evt_atomic')
    assert pay.list(hashed)['sandboxPointBalance'] == 120


def test_checkout_reconcile_server_price(client, app, monkeypatch):
    signup(client)
    hashed = digest(client.cookies.get('yingxiang_session'))
    pay = app.state.payments
    created = []
    current = {}
    def create(params,options):
        created.append((params,options))
        order = pay.own(hashed,params['client_reference_id'])
        current.update(paid(order),status='open',payment_status='unpaid',url='https://checkout.stripe.com/c/pay/fixture')
        return dict(current)
    sdk = SimpleNamespace(v1=SimpleNamespace(accounts=SimpleNamespace(retrieve_current=lambda:SimpleNamespace(id='acct_fixture')),
        checkout=SimpleNamespace(sessions=SimpleNamespace(create=create,retrieve=lambda ident:dict(current)))))
    monkeypatch.setattr(pay,'client',lambda:sdk)
    monkeypatch.setitem(pay.settings.env,'STRIPE_EXPECTED_ACCOUNT_ID','acct_fixture')
    body = {'sku':'credits-v1-creator','requestId':str(uuid4())}
    first = pay.checkout(hashed,body,app.state.settings.public_origin)
    again = pay.checkout(hashed,body,app.state.settings.public_origin)
    assert first == again
    assert len(created) == 1
    assert created[0][0]['line_items'][0]['price_data']['unit_amount'] == 12900
    current.update(status='complete',payment_status='paid')
    result = pay.reconcile(hashed,{'orderId':first['orderId']},app.state.settings.public_origin)
    assert result['sandboxPointBalance'] == 450
    assert 'url' not in result
    with pytest.raises(BusinessError):
        pay.checkout(hashed,{**body,'amount':1},app.state.settings.public_origin)

def test_upgrade_preserves_old_orders_events_and_snapshots(settings):
    from pathlib import Path
    from alembic import command
    from alembic.config import Config
    from app.db import Database
    config = Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))
    config.attributes['settings'] = settings
    command.upgrade(config,'0002')
    db = Database(settings.database)
    with db.transaction(True) as session:
        session.execute(text("INSERT INTO users (id,username,salt,password_hash,created_at) VALUES ('fixture','fixture','salt','hash',1)"))
        session.execute(text("INSERT INTO orders (id,user_id,request_id,sku,seconds,count,amount,currency,state,created_at,request_snapshot) VALUES ('order','fixture','request','tryon-v1-15-1',15,1,690,'cny','paid',1,:snapshot)"), {'snapshot': json.dumps({'original':True})})
        session.execute(text("INSERT INTO payment_events VALUES ('evt','order','stripe_sandbox',1)"))
        before = session.execute(text('SELECT * FROM orders')).mappings().one()
        before = dict(before)
    db.close()
    command.upgrade(config,'head')
    db = Database(settings.database)
    assert db.readiness()
    with db.transaction() as session:
        after = session.execute(text('SELECT * FROM orders')).mappings().one()
        assert {k:after[k] for k in before} == before
        assert list(session.execute(text('SELECT * FROM payment_events'))) == [('evt','order','stripe_sandbox',1)]
        assert session.execute(text('PRAGMA foreign_key_check')).all() == []
        assert session.execute(text('PRAGMA integrity_check')).scalar() == 'ok'
    db.close()
