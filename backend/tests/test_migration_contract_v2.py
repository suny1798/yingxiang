import json

from scripts.migration_contracts import capture_current, TARGET


def test_current_contract_matches_frozen_v2_without_external_calls():
    current = capture_current()
    assert current == json.loads(TARGET.read_text(encoding='utf-8'))
    assert current['providerCalls'] == {'model': 1, 'checkout': 1}
    cases = {item['name']: item['response'] for item in current['cases']}
    assert cases['unknown_preserves_occupancy']['json']['trialRemaining'] == 0
    assert cases['sandbox_did_not_unlock_real_usage']['json']['trialRemaining'] == 0
    assert cases['sandbox_orders']['json']['sandboxPointBalance'] == 120
    assert cases['other_work_hidden']['status'] == 404
    assert cases['other_works_empty']['json']['total'] == 0
    assert cases['content_range']['bodyBytes'] == 8
    assert cases['prompts']['json']['states'][0]['atMs'] == 0
    assert cases['register_owner']['cookieFlags'] == ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=604800']
    assert cases['owner_works_empty']['json']['total'] == 0
