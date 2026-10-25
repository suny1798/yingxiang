import json
import re
from pathlib import Path

FIXTURES = json.loads((Path(__file__).resolve().parents[1] / "contracts/http-fixtures.json").read_text(encoding="utf-8"))


def normalize(value):
    if isinstance(value, str):
        if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f-]{27}", value, re.I):
            return "<uuid>"
        if re.match(r"^\d{4}-\d\d-\d\dT", value):
            return "<timestamp>"
        return value
    if isinstance(value, list):
        return [normalize(v) for v in value]
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items()}
    return value


def test_29_node_route_contract_fixtures(client):
    cookie = ""
    for fixture in FIXTURES:
        scenario = fixture["scenario"]
        headers = {"cookie": cookie if scenario.get("cookie") else ""}
        headers["origin"] = scenario.get("origin") or "http://127.0.0.1:8787"
        kwargs = {"headers": headers}
        if "body" in scenario:
            kwargs["content"] = json.dumps(scenario["body"])
            headers["content-type"] = scenario.get("contentType", "application/json")
        if "origin" in scenario and scenario["origin"] is None:
            # TestClient 默认 headers 有 origin，显式构造后删去。
            request = client.build_request(scenario.get("method", "GET"), scenario["path"], **kwargs)
            del request.headers["origin"]
            response = client.send(request)
        else:
            response = client.request(scenario.get("method", "GET"), scenario["path"], **kwargs)
        label = scenario["path"] + " " + str(scenario.get("cookie", False))
        assert response.status_code == fixture["status"], label + response.text
        actual = response.json()
        if scenario["path"] == "/api/payments/orders" and response.status_code == 200:
            # 新积分字段为增量扩展，旧 Node 合同仍逐项保留。
            assert actual.pop("sandboxCreditPacks") == []
            assert actual.pop("sandboxPointBalance") == 0
        assert normalize(actual) == fixture["body"], label
        for key, value in fixture["headers"].items():
            assert response.headers.get(key) == value
        set_cookie = response.headers.get("set-cookie")
        if set_cookie:
            cookie = set_cookie.split(";")[0]
            assert [v.strip() for v in set_cookie.split(";")[1:]] == fixture["cookieFlags"]
