"""Isolated SQLite checks. No customer, payment, or live database is contacted."""
import json, sqlite3, pathlib
root=pathlib.Path(__file__).resolve().parents[1]
db=sqlite3.connect(':memory:')
for migration in sorted((root/'drizzle').glob('*.sql')): db.executescript(migration.read_text())
p=next(p for p in json.loads((root/'lib/catalog-source-v1.json').read_text()) if p['name']=='BPC-157')
db.execute('INSERT INTO product_overrides VALUES (?,?)',(p['id'],json.dumps({'stockQuantity':2})))
def order(id, owner, quantity=1):
 data=json.dumps({'items':[{'id':p['id'],'quantity':quantity}], 'unitCount':quantity})
 db.execute('INSERT INTO orders(id,owner,request_key,status,data,total,created,updated) VALUES(?,?,?,?,?,?,?,?)',(id,owner,id,'creating',data,p['price']*quantity,1,1))
def blocked(action,message):
 try: action()
 except sqlite3.IntegrityError: return
 raise AssertionError(message)
order('isolated-a','test-customer-a',2)
blocked(lambda:order('isolated-b','test-customer-b'),'Reserved stock was oversold')
blocked(lambda:order('isolated-c','test-customer-a'),'Unresolved owner attempt was duplicated')
db.execute("UPDATE orders SET status='paid',payment_ref='isolated-capture-a',notification_id='isolated-notification-a' WHERE id='isolated-a'")
assert db.execute("SELECT json_extract(data,'$.stockQuantity') FROM product_overrides").fetchone()[0]==0
assert db.execute('SELECT COUNT(*) FROM inventory_reservations').fetchone()[0]==0
blocked(lambda:order('isolated-d','test-customer-b'),'Paid stock was sold a second time')
db.execute('UPDATE product_overrides SET data=?',(json.dumps({'stockQuantity':3}),))
order('isolated-e','test-customer-b')
db.execute("UPDATE orders SET status='review' WHERE id='isolated-e'")
assert db.execute('SELECT SUM(quantity) FROM inventory_reservations').fetchone()[0]==1
blocked(lambda:db.execute('UPDATE product_overrides SET data=?',(json.dumps({'stockQuantity':0}),)),'Reserved inventory was overwritten')
db.execute("UPDATE orders SET status='failed' WHERE id='isolated-e'")
assert db.execute('SELECT COUNT(*) FROM inventory_reservations').fetchone()[0]==0
order('isolated-f','test-customer-b',3)
print('PASS: reservations, oversell prevention, unresolved-attempt uniqueness, settlement, uncertain-attempt retention, protected stock edits, failure release')
