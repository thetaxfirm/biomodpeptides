"""Local API verification: a softgel/spray unit is a whole bottle, never a capsule or spray."""
import runpy
ctx=runpy.run_path('tests/packs-v2.py');call=ctx['call'];ps=call('state')[1]['products']
bottles=[p for p in ps if p['categories'][0]['slug'] in ('softgels','spray-products')]
assert len(bottles)==18
rates={1:0,3:.1,5:.15,10:.2}
try:
 for p in bottles:
  for n in (1,3,5,10):
   status,data=call('cart',{'cart':[{'id':p['id'],'quantity':n,'packId':'bottle-pack-check','packSize':n,'packKind':'fixed'}]})
   assert status==200,(p['name'],n,data)
   q=data['totals'];assert q['total']==p['price']*n-round(p['price']*n*rates[n]),(p['name'],n,q)
   assert q['items'][0]['quantity']==n and q['items'][0]['product']['sizes']==p['sizes']
   assert q['items'][0]['lineTotal']==q['total']
 softgel=next(p for p in bottles if p['slug']=='softgel-methylene-blue-usp')
 spray=next(p for p in bottles if p['slug']=='forge-bpc-157-spray')
 peptide=next(p for p in ps if p['slug']=='bpc-157-10mg')
 status,data=call('cart',{'cart':[{'id':p['id'],'quantity':1,'packId':'mixed-formats-check','packSize':3,'packKind':'mixed'} for p in (softgel,spray,peptide)]})
 assert status==200
 assert data['totals']['total']==26370 and sum(i['quantity'] for i in data['totals']['items'])==3
 assert call('cart',{'cart':[{'id':softgel['id'],'quantity':100},{'id':softgel['id'],'quantity':3,'packId':'excess-bottles','packSize':3,'packKind':'fixed'}]})[0]==400
 print('PASS: all 72 softgel/spray pack totals, full-bottle quantities, mixed-format packs, and aggregate bottle inventory limits')
finally:call('cart',{'cart':[]})
