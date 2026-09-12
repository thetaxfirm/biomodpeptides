"""Local published-surface and purchase rejection checks; no purchases are created."""
import json,re,runpy,urllib.request,urllib.error
ctx=runpy.run_path('tests/http-v1.py');call=ctx['call']
base='http://localhost:3056'
forbidden=re.compile(r'\bglp(?:[- ]?[123])?\b|retatrutide|tirzepatide|tirzeptatide|cagrilintide|cagrilitide|semaglutide|semiglutide|c-heat|heat-r|heat-t|2381089-83-2|2023788-19-2|1415456-99-3|910463-68-2',re.I)
removed=[(744,'heat-t-20mg','101-20-0001'),(745,'heat-r-30mg','102-30-0001'),(1389,'heat-r-20mg','102-20-0001'),(746,'c-heat-s-10mg','103-10-0001'),(747,'c-heat-10mg','104-10-0001')]
def get(path):
 try:
  with urllib.request.urlopen(base+path) as r:return r.status,r.read().decode()
 except urllib.error.HTTPError as r:return r.code,r.read().decode()
for path in ['/','/shop','/testing','/multi-pack?size=5','/about','/locations','/robots.txt','/sitemap.xml']:
 status,body=get(path);assert status==200,(path,status)
 assert not forbidden.search(body),(path,forbidden.search(body).group(0))
status,state=call('state');assert status==200 and len(state['products'])==45
assert not forbidden.search(json.dumps(state))
for p in state['products']:
 status,body=get('/product/'+p['slug']);assert status==200,p['slug']
 assert not forbidden.search(body),(p['slug'],forbidden.search(body).group(0))
for id,slug,lot in removed:
 for path in ['/product/'+slug,'/testing/'+lot,'/testing/biomod-product-'+str(id),'/products/'+slug+'-v1.webp']:
  status,body=get(path);assert status==404,(path,status)
 assert call('cart',{'cart':[{'id':id,'quantity':1}]})[0]==400,id
 assert call('wishlist',{'ids':[id]})[0]==400,id
 assert call('saved-pack',{'name':'Unavailable selection check','products':[id]})[0]==400,id
assert call('cart',{'cart':[]})[0]==200
print('PASS: all 45 product pages and key site surfaces contain no withdrawn terms; 20 old product/lot/image URLs return 404; cart, wishlist and saved-pack writes reject all five removed IDs.')
