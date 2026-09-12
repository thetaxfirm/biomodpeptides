"""Exercise the exact D1 batch SQL in isolated SQLite; no live records or payments."""
import json, sqlite3, pathlib
root=pathlib.Path(__file__).resolve().parents[1]
db=sqlite3.connect(':memory:',isolation_level=None)
for migration in sorted((root/'drizzle').glob('*.sql')): db.executescript(migration.read_text())
sql=json.loads((root/'lib/inventory-statements.json').read_text())
p=next(p for p in json.loads((root/'lib/catalog-source-v1.json').read_text()) if p['name']=='BPC-157')
db.execute('INSERT INTO product_overrides VALUES (?,?)',(p['id'],json.dumps({'stockQuantity':2})))
def batch(operations):
 db.execute('BEGIN')
 try:
  for key,args in operations:db.execute(sql[key],args)
  db.execute('COMMIT')
 except:
  db.execute('ROLLBACK');raise

def order(id,owner,quantity=1,campaign=None):
 data=json.dumps({'items':[{'id':p['id'],'quantity':quantity}], 'unitCount':quantity, 'campaignId':campaign,'campaignLimit':2 if campaign else None})
 batch([('insertOrder',(id,owner,id,'creating',data,p['price']*quantity,id,1,1)),('reserve',(id,)),('checkReservation',(id,id,id)),('clearGuard',(id,))])
def blocked(action,message):
 try:action()
 except sqlite3.IntegrityError:return
 raise AssertionError(message)
def settle(id):
 batch([('paymentStatus',('paid','capture-'+id,'notification-'+id,2,id)),('settleInventory',(id,id,id)),('clearSettledReservation',(id,id))])
def stock():return db.execute("SELECT json_extract(data,'$.stockQuantity') FROM product_overrides").fetchone()[0]
order('isolated-a','customer-a',2)
blocked(lambda:order('isolated-b','customer-b'),'Reserved stock was oversold')
assert db.execute("SELECT count(*) FROM orders WHERE id='isolated-b'").fetchone()[0]==0
blocked(lambda:order('isolated-c','customer-a'),'An active customer checkout was duplicated')
settle('isolated-a');assert stock()==0
settle('isolated-a');assert stock()==0
assert db.execute('SELECT COUNT(*) FROM inventory_reservations').fetchone()[0]==0
blocked(lambda:order('isolated-d','customer-b'),'Paid stock was sold twice')
db.execute('UPDATE product_overrides SET data=?',(json.dumps({'stockQuantity':8}),))
order('isolated-e','customer-b',2,'isolated-campaign');settle('isolated-e')
blocked(lambda:order('isolated-f','customer-b',1,'isolated-campaign'),'Cumulative presale limit exceeded')
order('isolated-g','customer-c',2)
db.execute("UPDATE orders SET status='review' WHERE id='isolated-g'")
blocked(lambda:batch([('checkInventoryEdit',('stock-edit',0,p['id'],6,p['id'])),('updateProduct',(p['id'],json.dumps({'stockQuantity':0}))),('clearGuard',('stock-edit',))]),'Reserved stock was overwritten')
blocked(lambda:batch([('checkInventoryEdit',('stale-edit',10,p['id'],8,p['id'])),('updateProduct',(p['id'],json.dumps({'stockQuantity':10}))),('clearGuard',('stale-edit',))]),'Stale inventory edits were accepted')
assert stock()==6
assert db.execute('SELECT SUM(quantity) FROM inventory_reservations').fetchone()[0]==2
assert db.execute('SELECT COUNT(*) FROM transaction_guards').fetchone()[0]==0
print('PASS: atomic rollback, oversell prevention, active-attempt uniqueness, idempotent settlement, cumulative presale limits, uncertain-attempt retention, protected inventory edits')
