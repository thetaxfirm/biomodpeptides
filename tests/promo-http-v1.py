#!/usr/bin/env python3
"""Promo HTTP integration checks in a new anonymous session.

Local by default. --live explicitly permits https://trybiomod.com only.
No login, checkout, payment, order, external provider, or existing user-cart calls.
Session cookies stay in memory. Output contains check labels and amounts only.
"""
import argparse
import http.cookiejar
import json
import sys
from http.cookies import SimpleCookie
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def approved_origin(value, live):
    parsed = urlsplit(value)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('Use a plain origin with no credentials, path, query or fragment.')
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        raise ValueError('A valid HTTP(S) origin is required.')
    # Force evaluation of malformed/out-of-range ports before any network request.
    port = parsed.port
    local = parsed.hostname.lower() in ('localhost', '127.0.0.1', '::1')
    canonical_live = parsed.scheme == 'https' and parsed.hostname.lower() == 'trybiomod.com' and port in (None, 443)
    if not local and not (live and canonical_live):
        raise ValueError('Remote calls refused. Only canonical HTTPS TryBiomod is permitted with --live.')
    host = '[' + parsed.hostname + ']' if ':' in parsed.hostname else parsed.hostname.lower()
    authority = host + (':' + str(port) if port is not None and (parsed.scheme, port) not in (('http', 80), ('https', 443)) else '')
    return parsed.scheme + '://' + authority


def check(condition, label):
    if not condition:
        raise AssertionError(label)


def valid_money(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def check_quote(q):
    check(isinstance(q, dict), 'quote is available')
    for field in ('subtotal', 'discount', 'packDiscount', 'promoDiscount', 'total'):
        check(valid_money(q.get(field)), 'quote money is a nonnegative integer')
    check(q['subtotal'] - q['discount'] == q['total'], 'subtotal reconciles')
    check(q['packDiscount'] + q['promoDiscount'] == q['discount'], 'discount components reconcile')
    check(sum(line['lineTotal'] for line in q['items']) == q['total'], 'line totals reconcile')
    check(all(valid_money(line['lineTotal']) for line in q['items']), 'line totals are nonnegative cents')


def run(origin):
    jar = http.cookiejar.CookieJar()  # Never load, save or expose browser cookies.
    client = build_opener(NoRedirect(), HTTPCookieProcessor(jar))
    passed = []
    skipped = []
    cart_created = False

    def request(action, body=None, request_origin=None):
        check(action in ('state', 'cart', 'promo'), 'only anonymous state/cart/promo endpoints are permitted')
        headers = {'Accept': 'application/json', 'Cache-Control': 'no-store'}
        data = None
        if body is not None:
            data = json.dumps(body, separators=(',', ':')).encode('utf-8')
            headers['Content-Type'] = 'application/json'
            headers['Origin'] = origin if request_origin is None else request_origin
        req = Request(origin + '/api/store/' + action, data=data, headers=headers, method='POST' if body is not None else 'GET')
        try:
            with client.open(req, timeout=30) as response:
                status, response_headers, raw = response.status, response.headers, response.read(1024 * 1024)
        except HTTPError as error:
            status, response_headers, raw = error.code, error.headers, error.read(1024 * 1024)
        try:
            result = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise AssertionError('API returned JSON') from None
        return status, result, response_headers

    def successful(action, body=None):
        status, data, headers = request(action, body)
        check(status == 200, action + ' request succeeded')
        return data, headers

    def state():
        value, _ = successful('state')
        check(not value.get('customer') and not value.get('admin'), 'test remains anonymous')
        return value

    def cookie_flags(headers):
        values = headers.get_all('Set-Cookie') or []
        found = None
        for value in values:
            cookies = SimpleCookie()
            cookies.load(value)
            if 'bm_promo' in cookies:
                found = cookies['bm_promo']
        check(found is not None, 'promo response sets its own cookie')
        check(found['httponly'] and found['path'] == '/' and found['samesite'].lower() == 'lax', 'promo cookie protections')
        check(found['max-age'] == '2592000', 'promo cookie lifetime')
        if origin.startswith('https://'):
            check(bool(found['secure']), 'HTTPS promo cookie is Secure')

    def expected_promo(q, original, code, percent):
        check_quote(q)
        expected = (original['total'] * percent + 50) // 100
        check(q['subtotal'] == original['subtotal'], 'promo leaves gross merchandise unchanged')
        check(q['packDiscount'] == original['packDiscount'], 'promo preserves existing pack savings')
        check(q['promo'] == {'code': code, 'percentOff': percent, 'savings': expected}, 'server determines code and discount')
        check(q['promoDiscount'] == expected and q['total'] == original['total'] - expected, 'expected discounted total')
        return q['total']

    try:
        initial = state()
        check(initial.get('cart') == [], 'fresh test session starts with an empty cart')
        candidates = [p for p in initial.get('products', [])
                      if p.get('inStock') and p.get('purchasable') and valid_money(p.get('price'))
                      and p['price'] > 0 and valid_money(p.get('stockQuantity')) and p['stockQuantity'] >= 1
                      and p.get('maxQuantity', 100) >= 1]
        check(bool(candidates), 'a verified in-stock product is available for an isolated cart')
        product = next((p for p in candidates if p['stockQuantity'] >= 3 and p.get('maxQuantity', 100) >= 3
                        and any(c.get('slug') in ('research-compounds', 'softgels', 'spray-products') for c in p.get('categories', []))), candidates[0])
        single = [{'id': product['id'], 'quantity': 1}]
        value, _ = successful('cart', {'cart': single})
        cart_created = True
        base = value['totals']
        check_quote(base)
        check(base['promo'] is None and base['promoDiscount'] == 0, 'new session has no promo')
        check(state()['cart'] == single, 'only this test session cart was changed')
        passed.append('fresh anonymous session and isolated cart')

        amounts = {}
        for percent in (10, 15, 20):
            code = 'BIOMOD' + str(percent)
            value, headers = successful('promo', {'code': '  ' + code.lower() + '  '})
            cookie_flags(headers)
            amounts[code] = expected_promo(value['totals'], base, code, percent)
            persisted = state()
            expected_promo(persisted['totals'], base, code, percent)
            check(persisted['cart'] == single, 'applying a code does not mutate cart items')
        passed.append('10/15/20 normalization, server savings, persistence and cookie protections')

        for invalid in ('NOT-A-VALID-PROMO', {'code': 'BIOMOD20', 'percentOff': 100}, ['BIOMOD10'], 'X' * 100):
            status, _, _ = request('promo', {'code': invalid})
            check(status == 400, 'invalid promo input is rejected')
            expected_promo(state()['totals'], base, 'BIOMOD20', 20)
        passed.append('invalid input preserves the previously applied code')

        value, _ = successful('promo', {'code': 'BIOMOD15', 'percentOff': 100, 'promoDiscount': 999999999, 'total': 1})
        expected_promo(value['totals'], base, 'BIOMOD15', 15)
        passed.append('client supplied percentages and amounts cannot alter server pricing')

        status, _, _ = request('promo', {'code': 'BIOMOD10'}, request_origin='https://example.invalid')
        check(status == 403, 'foreign Origin is rejected')
        expected_promo(state()['totals'], base, 'BIOMOD15', 15)
        passed.append('foreign Origin cannot mutate the applied code')

        value, _ = successful('promo', {'code': ''})
        check(value.get('promo') is None, 'removal is acknowledged')
        cleared = state()['totals']
        check_quote(cleared)
        check(cleared['promo'] is None and cleared['promoDiscount'] == 0 and cleared['total'] == base['total'], 'removal restores original total')
        check(not any(cookie.name == 'bm_promo' for cookie in jar), 'removal expires the promo cookie')
        passed.append('removal clears the cookie and restores totals')

        pack_possible = product['stockQuantity'] >= 3 and product.get('maxQuantity', 100) >= 3 and any(
            c.get('slug') in ('research-compounds', 'softgels', 'spray-products') for c in product.get('categories', []))
        if pack_possible:
            fixed = [{'id': product['id'], 'quantity': 3, 'packId': 'isolated-http-promo-pack', 'packSize': 3, 'packKind': 'fixed'}]
            value, _ = successful('cart', {'cart': fixed})
            pack_base = value['totals']
            check_quote(pack_base)
            value, _ = successful('promo', {'code': 'BIOMOD20'})
            expected_promo(value['totals'], pack_base, 'BIOMOD20', 20)
            expected_promo(state()['totals'], pack_base, 'BIOMOD20', 20)
            passed.append('20 percent stacks after the current 3-pack total')
        else:
            skipped.append('3-pack check unavailable: no suitable verified inventory')

        for label in passed:
            print('PASS:', label)
        for label in skipped:
            print('SKIP:', label)
        print('Expected single-item totals (cents):', json.dumps(amounts, sort_keys=True))
    finally:
        # This fresh CookieJar cannot refer to the owner's browser or customer cart.
        # Clean only the anonymous cart established by this run; never touch orders.
        if cart_created:
            try:
                successful('promo', {'code': ''})
                successful('cart', {'cart': []})
                clean = state()
                check(clean.get('cart') == [] and clean['totals']['promo'] is None, 'isolated cart cleanup verified')
                print('PASS: isolated anonymous cart and promo cleanup')
            except Exception:
                print('FAIL: isolated session cleanup could not be verified', file=sys.stderr)
                raise AssertionError('isolated session cleanup') from None
        jar.clear()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:3057')
    parser.add_argument('--live', action='store_true', help='Explicitly allow canonical HTTPS TryBiomod (anonymous cart/promo only).')
    args = parser.parse_args()
    try:
        origin = approved_origin(args.base_url, args.live)
        run(origin)
    except (ValueError, AssertionError) as error:
        print('FAIL:', str(error), file=sys.stderr)
        return 1
    except (URLError, TimeoutError, OSError):
        print('FAIL: HTTP connection unavailable; no response details or cookies logged', file=sys.stderr)
        return 1
    except Exception:
        print('FAIL: unexpected API shape or runtime failure; no response details or cookies logged', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
