"""Check the exact retail migration in isolated SQLite, without live database access."""
import json
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
migration_path = root / 'drizzle/0004_owner_retail_pricing_v1.sql'
migration = migration_path.read_text()
source = json.loads((root / 'lib/catalog-facts-v2.json').read_text())
competitive = json.loads((root / 'lib/competitive-pricing-v3.json').read_text())
expected = {
    746: (4999, {'3': 13497, '5': 21246, '10': 39992}),
    783: (4999, {'3': 13497, '5': 21246, '10': 39992}),
    779: (10999, {'3': 29697, '5': 46746, '10': 87992}),
}
unrelated = next(p for p in source if p['id'] not in expected)

def fixture(product):
    prior = {**product, **competitive.get(product['slug'], {})}
    return {
        'price': prior['price'],
        'packPrices': prior.get('packPrices', {'3': None, '5': None, '10': None}),
        'sale': {'enabled': False, 'percentOff': 7.5, 'starts': '2026-09-01T00:00:00Z', 'ends': '2026-09-02T00:00:00Z'},
        'stockQuantity': 137,
        'maxQuantity': 11,
        'inStock': False,
        'purchasable': False,
        'unrelated': {'notes': ['keep', {'reviewed': True}], 'empty': None},
    }

for absent in [set(), {746}, {783}, {779}, set(expected)]:
    with sqlite3.connect(':memory:') as db:
        for path in sorted((root / 'drizzle').glob('*.sql')):
            if path.name < migration_path.name:
                db.executescript(path.read_text())
        schema_before = db.execute('SELECT name,sql FROM sqlite_master ORDER BY name').fetchall()
        fixtures = {p['id']: fixture(p) for p in source if p['id'] in expected and p['id'] not in absent}
        fixtures[unrelated['id']] = fixture(unrelated)
        for product_id, data in fixtures.items():
            db.execute('INSERT INTO product_overrides(id,data) VALUES (?,?)', (product_id, json.dumps(data)))
        untouched_before = db.execute('SELECT data FROM product_overrides WHERE id=?', (unrelated['id'],)).fetchone()[0]
        db.executescript(migration)
        rows = {row[0]: json.loads(row[1]) for row in db.execute('SELECT id,data FROM product_overrides')}
        assert rows.keys() == fixtures.keys(), 'Do not insert missing overrides or remove existing ones'
        for product_id, original in fixtures.items():
            after = rows[product_id]
            if product_id in expected:
                price, packs = expected[product_id]
                assert after == {**original, 'price': price, 'packPrices': packs}, product_id
                assert isinstance(after['packPrices'], dict), 'Pack prices must be a JSON object, not a JSON string'
            else:
                assert after == original, 'Keep unrelated products unchanged'
        assert db.execute('SELECT data FROM product_overrides WHERE id=?', (unrelated['id'],)).fetchone()[0] == untouched_before
        assert db.execute('SELECT name,sql FROM sqlite_master ORDER BY name').fetchall() == schema_before, 'No schema changes'
        db.executescript(migration)
        assert {row[0]: json.loads(row[1]) for row in db.execute('SELECT id,data FROM product_overrides')} == rows, 'Repeated application keeps the same values'

print('PASS: 5 override-presence scenarios; exact 3 prices and packs; sale, stock, flags, limits and nested fields preserved; unrelated and absent rows unchanged; no schema changes; repeatable values')
