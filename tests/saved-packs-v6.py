"""Local-only persistence and ownership checks using real catalog products. No orders."""
import http.cookiejar
import json
import urllib.error
import urllib.request

BASE = 'http://localhost:3056'

def session():
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def call(action, body=None, origin=BASE):
        request = urllib.request.Request(BASE + '/api/store/' + action,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Content-Type': 'application/json', 'Origin': origin})
        try:
            with client.open(request) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as response:
            raw = response.read().decode()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                data = {'error': raw}
            return response.code, data
    return call

a, b = session(), session()
status, state = a('state')
assert status == 200
assert b('state')[0] == 200
products = state['products']
ids = [next(p['id'] for p in products if p['slug'] == slug) for slug in
       ('bpc-157-10mg', 'softgel-methylene-blue-usp', 'forge-bpc-157-spray')]
created = []
try:
    for count in (1, 3, 5, 10):
        selection = [ids[i % 3] for i in range(count)]
        status, saved = a('saved-pack', {'name': 'Local verification ' + str(count), 'products': selection})
        assert status == 200, saved
        created.append(saved['id'])
        stored = next(p for p in a('state')[1]['savedPacks'] if p['id'] == saved['id'])
        assert stored['products'] == selection
    target = created[0]
    assert not any(p['id'] in created for p in b('state')[1]['savedPacks'])
    assert b('saved-pack', {'id': target, 'name': 'Unauthorized change', 'products': ids})[0] == 404
    assert b('saved-pack', {'id': target, 'remove': True})[0] == 200
    assert any(p['id'] == target for p in a('state')[1]['savedPacks'])
    assert a('saved-pack', {'id': target, 'name': 'Updated selection', 'products': ids})[0] == 200
    stored = next(p for p in a('state')[1]['savedPacks'] if p['id'] == target)
    assert stored['name'] == 'Updated selection' and stored['products'] == ids
    for invalid in ([], ids[:2], [999999999], ids * 4):
        assert a('saved-pack', {'name': 'Invalid selection', 'products': invalid})[0] == 400
    assert a('saved-pack', {'name': ' ', 'products': ids})[0] == 400
    assert a('saved-pack', {'name': 'a' * 61, 'products': ids})[0] == 400
    assert a('saved-pack', {'name': 'Blocked origin', 'products': ids}, 'https://untrusted.invalid')[0] == 403
    assert a('state')[1]['cart'] == state['cart']
    print('PASS: 1/3/5/10 saved-pack persistence, updates, customer-session isolation, exact deletion, invalid selections, CSRF, and unchanged cart')
finally:
    for identifier in created:
        assert a('saved-pack', {'id': identifier, 'remove': True})[0] == 200
    assert not any(p['id'] in created for p in a('state')[1]['savedPacks'])
