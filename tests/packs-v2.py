"""Exercise actual local pricing and pack validation; no orders or real customer records."""
import runpy,json
from pathlib import Path
ctx=runpy.run_path(str(Path(__file__).with_name('http-v1.py')))
call=ctx['call'];s=call('state')[1];ps=s['products'];p=next(p for p in ps if p['slug']=='bpc-157-10mg');other=next(p for p in ps if p['slug']=='ghk-cu-50mg')
assert p['price']==3500
try:
 for n,expected in [(1,3500),(3,9450),(5,14875),(10,24900)]:
  line={'id':p['id'],'quantity':n,'packId':'isolated-pack-v2','packSize':n,'packKind':'fixed','price':1,'packPrices':{'10':1}}
  status,data=call('cart',{'cart':[line]});assert status==200,(n,data)
  q=data['totals'];assert q['total']==expected,(n,q)
  assert q['items'][0]['quantity']==n and q['items'][0]['lineTotal']==expected
  assert q['subtotal']-q['discount']==expected
 for n in [3,5,10]:
  status,data=call('cart',{'cart':[{'id':p['id'],'quantity':n,'packId':'mixed-v2','packSize':n,'packKind':'mixed'}]})
  assert status==200 and data['totals']['total']==p['price']*n-round(p['price']*n*{3:.1,5:.15,10:.2}[n])
 for line in [
  {'id':p['id'],'quantity':2,'packId':'fixed-v2','packSize':3,'packKind':'fixed'},
  {'id':p['id'],'quantity':2,'packId':'fixed-v2','packSize':2,'packKind':'fixed'},
  {'id':p['id'],'quantity':10,'packId':'fixed-v2','packSize':10,'packKind':'cheap'},
  {'id':p['id'],'quantity':10,'packSize':10,'packKind':'fixed'},
 ]: assert call('cart',{'cart':[line]})[0]==400,line
 mixed=[{'id':p['id'],'quantity':2,'packId':'mixed-v2','packSize':3,'packKind':'mixed'},{'id':other['id'],'quantity':1,'packId':'mixed-v2','packSize':3,'packKind':'mixed'}]
 status,data=call('cart',{'cart':mixed});assert status==200
 assert sum(i['lineTotal'] for i in data['totals']['items'])==data['totals']['total']==8910
 for l in mixed:l['packKind']='fixed'
 assert call('cart',{'cart':mixed})[0]==400
 ordinary=next(x for x in ps if x['categories'][0]['slug']=='softgels')
 assert call('cart',{'cart':[{'id':ordinary['id'],'quantity':3,'packId':'fixed-v2','packSize':3,'packKind':'fixed'}]})[0]==400
 assert call('cart',{'cart':[{'id':p['id'],'quantity':100},{'id':p['id'],'quantity':3,'packId':'fixed-v2','packSize':3,'packKind':'fixed'}]})[0]==400
 audit=json.loads(Path('docs/crush-pricing-v2.json').read_text())
 for row in audit['rows']:
  actual=next(x for x in ps if x['slug']==row['biomodSlug'])
  if row['matchStatus']!='exact':assert actual['price']==row['biomodCurrentSingleCents'];continue
  applied={'1':actual['price'],**actual['packPrices']}
  assert applied==row['appliedBiomodPackTotalsCents']
  for count,price in row['crushPackTotalsCents'].items():assert applied[count]<=price
  assert all(applied[str(a)]*b>=applied[str(b)]*a for a,b in [(1,3),(3,5),(5,10)])
 print('PASS: fixed 1/3/5/10 prices, distinct mixed discounts, line totals, tampering rejection, pack eligibility, aggregate quantities and 17 sourced competitive schedules')
finally:call('cart',{'cart':[]})
