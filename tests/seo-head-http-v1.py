"""Read-only built-worker metadata checks. Usage: python3 tests/seo-head-http-v1.py BASE [--preview].

Fetches public HTML only. Does not sign in, call store APIs, place orders, or use credentials.
"""
import argparse
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser


class DocumentMetadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_head = False
        self.tags = {key: [] for key in ('title', 'description', 'canonical', 'robots', 'googlebot')}
        self.title = None
        self.structured_script = None
        self.structured_data = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'head':
            self.in_head = True
        elif tag == 'title':
            self.title = {'head': self.in_head, 'value': ''}
            self.tags['title'].append(self.title)
        elif tag == 'meta' and attributes.get('name', '').lower() in self.tags:
            self.tags[attributes['name'].lower()].append({'head': self.in_head, 'value': attributes.get('content', '')})
        elif tag == 'link' and 'canonical' in attributes.get('rel', '').lower().split():
            self.tags['canonical'].append({'head': self.in_head, 'value': attributes.get('href', '')})
        elif tag == 'script' and attributes.get('type', '').lower() == 'application/ld+json':
            self.structured_script = ''

    def handle_endtag(self, tag):
        if tag == 'head':
            self.in_head = False
        elif tag == 'title':
            self.title = None
        elif tag == 'script' and self.structured_script is not None:
            self.structured_data.append(json.loads(self.structured_script))
            self.structured_script = None

    def handle_data(self, data):
        if self.title is not None:
            self.title['value'] += data
        if self.structured_script is not None:
            self.structured_script += data


def organization_count(value):
    if isinstance(value, dict):
        types = value.get('@type', [])
        if isinstance(types, str):
            types = [types]
        return int('Organization' in types) + sum(organization_count(item) for item in value.values())
    if isinstance(value, list):
        return sum(organization_count(item) for item in value)
    return 0


def tokens(value):
    return {token.strip().lower() for token in value.split(',')}


def fetch(base, path, user_agent):
    request = urllib.request.Request(base + path, headers={'User-Agent': user_agent})
    try:
        response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        document = DocumentMetadata()
        document.feed(response.read().decode('utf-8'))
        document.close()
        return response.status, response.headers, document


def check(base, path, user_agent, expected_status, indexable, preview):
    label = f'{path} [{user_agent}]'
    status, headers, document = fetch(base, path, user_agent)
    assert status == expected_status, (label, 'HTTP status', status)
    for name, entries in document.tags.items():
        assert all(entry['head'] for entry in entries), (label, name, 'metadata outside head', entries)
        if expected_status == 200:
            assert len(entries) == 1, (label, name, 'expected exactly one tag', entries)
        elif name in ('title', 'description'):
            assert len(entries) == 1, (label, name, 'expected fallback tag', entries)
        elif name != 'robots':
            assert len(entries) <= 1, (label, name, 'duplicate fallback tag', entries)
    assert document.tags['robots'], (label, 'missing robots policy')
    for entry in document.tags['robots'] + document.tags['googlebot']:
        directives = tokens(entry['value'])
        assert ('index' in directives if indexable else 'noindex' in directives), (label, 'incorrect robots policy', entry)
        assert not {'index', 'noindex'}.issubset(directives), (label, 'conflicting robots policy', entry)
    canonical_path = urllib.parse.urlsplit(path).path
    expected_canonical = 'https://trybiomod.com' + canonical_path
    for entry in document.tags['canonical']:
        assert entry['value'] == expected_canonical, (label, 'incorrect canonical', entry)
    header_robots = headers.get('X-Robots-Tag', '').lower()
    if indexable:
        assert 'noindex' not in header_robots and 'none' not in tokens(header_robots), (label, 'conflicting X-Robots-Tag', header_robots)
    for target in re.findall(r'<([^>]+)>\s*;\s*rel\s*=\s*["\']?canonical', headers.get('Link', ''), flags=re.I):
        assert target == expected_canonical, (label, 'conflicting canonical Link header', target)
    organizations = organization_count(document.structured_data)
    if preview or not indexable:
        assert organizations == 0, (label, 'unexpected organization schema', organizations)
    else:
        assert organizations == 1, (label, 'expected one organization schema', organizations)
    print(f'PASS {status} {path}: metadata in head; {"index" if indexable else "noindex"}; {user_agent}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base', help='Origin of the built worker, such as http://127.0.0.1:3057')
    parser.add_argument('--preview', action='store_true', help='Expect all routes to remain noindex with no Organization schema')
    args = parser.parse_args()
    parsed = urllib.parse.urlsplit(args.base)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        parser.error('BASE must be an HTTP(S) origin without credentials, path, query, or fragment.')
    base = args.base.rstrip('/')
    browser = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36'
    user_agents = [browser, 'Googlebot', 'Google-InspectionTool/1.0', 'OAI-SearchBot/1.0', 'Bingbot', 'Claude-SearchBot/1.0', 'PerplexityBot/1.0']
    for user_agent in user_agents:
        check(base, '/', user_agent, 200, not args.preview, args.preview)
    for path, indexable in [('/about', True), ('/product/bpc-157-10mg', True), ('/shop?q=test', False), ('/cart', False), ('/product/heat-r-20mg', False), ('/missing-page', False)]:
        check(base, path, browser, 404 if path == '/missing-page' else 200, indexable and not args.preview, args.preview)
    print('PASS: 13 public HTML responses; head placement, uniqueness, canonicals, robots, schema gates, and true 404 verified.')


if __name__ == '__main__':
    main()
