"""Local-only cart API assertions using real catalog products; no order is submitted."""
import urllib.request,urllib.error,http.cookiejar,json
base='http://localhost:3056'
jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def call(path,body=None,origin=base):
 req=urllib.request.Request(base+'/api/store/'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json','Origin':origin})
 try:
  with client.open(req) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as r:
  raw=r.read().decode()
  try: data=json.loads(raw)
  except json.JSONDecodeError: data={'error':raw}
  return r.code,data
status,s=call('state');assert status==200 and len(s['products'])==45
assert s['config']['packDiscounts']=={'1':0,'3':10,'5':15,'10':20}
assert not s['payment']['enabled'] and s['customer'] is None
p=next(p for p in s['products'] if p['name']=='BPC-157')
status,d=call('cart',{'cart':[{'id':p['id'],'quantity':2,'price':1}]});assert status==200 and d['totals']['total']==p['price']*2
assert call('state')[1]['cart'][0]['quantity']==2
assert call('cart',{'cart':[{'id':p['id'],'quantity':-1}]})[0]==400
assert call('cart',{'cart':[{'id':p['id'],'quantity':2,'packId':'isolated-pack','packSize':3}]})[0]==400
status,d=call('cart',{'cart':[{'id':p['id'],'quantity':3,'packId':'isolated-pack','packSize':3}]});assert status==200 and d['totals']['discount']==round(p['price']*3*.1)
assert call('cart',{'cart':[]},origin='https://untrusted.invalid')[0]==403
assert call('checkout',{'accepted':True})[0]==400
assert call('admin')[0]==400
assert call('admin-config',{})[0]==400
assert call('wishlist',{'ids':[p['id']]})[0]==200
assert call('state')[1]['wishlist']==[p['id']]
assert call('cart',{'cart':[]})[0]==200
assert call('wishlist',{'ids':[]})[0]==200
print('PASS: catalog, competitive discounts, price authority, persistent cart/wishlist, invalid quantities, incomplete packs, CSRF, authentication and admin access guards')
