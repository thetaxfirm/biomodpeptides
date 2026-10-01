"""Read-only local checks of metadata, indexing headers, routes and sitemap."""
import urllib.request, urllib.error, json
from html.parser import HTMLParser
import xml.etree.ElementTree as ET
BASE='http://localhost:3056'
class Metadata(HTMLParser):
 def __init__(self):super().__init__();self.titles=[];self.meta={};self.canonicals=[];self.in_title=False
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='title':self.in_title=True
  if tag=='meta':self.meta[a.get('name',a.get('property',''))]=a.get('content','')
  if tag=='link' and a.get('rel')=='canonical':self.canonicals.append(a.get('href'))
 def handle_endtag(self,tag):
  if tag=='title':self.in_title=False
 def handle_data(self,data):
  if self.in_title:self.titles.append(data)
def get(path):
 try:
  with urllib.request.urlopen(BASE+path) as r:return r.status,r.headers,r.read().decode()
 except urllib.error.HTTPError as r:return r.code,r.headers,r.read().decode()
titles=[]
for path in ['/','/?q=test','/shop','/locations','/testing','/product/bpc-157-10mg','/product/softgel-methylene-blue-usp','/product/noctis-blend-spray','/cart','/checkout','/account','/admin','/shop?q=anything']:
 status,headers,body=get(path);assert status==200,(path,status,body[:200])
 assert 'noindex' in headers.get('X-Robots-Tag',''),(path,dict(headers))
 meta=Metadata();meta.feed(body)
 assert 'noindex' in meta.meta.get('robots',''),(path,meta.meta)
 assert len(meta.canonicals)==1,(path,meta.canonicals)
 assert meta.canonicals[0].startswith('https://trybiomod.com/'),(path,meta.canonicals)
 assert '?' not in meta.canonicals[0]
 if path in ['/','/shop','/locations','/testing','/product/bpc-157-10mg']:titles.append(''.join(meta.titles))
 assert not any(x in meta.meta.get('description','') for x in ['Purity:','weight loss','cognitive support','FDA approved'])
assert len(set(titles))==len(titles),titles
for path in ['/missing-page-v7-check','/product/missing-product-v7-check','/testing/missing-lot-v7-check','/account/missing-section']:
 status,headers,body=get(path);assert status==404,(path,status);assert 'noindex' in headers.get('X-Robots-Tag','')
status,headers,body=get('/robots.txt');assert status==200 and 'Allow: /' in body and 'Disallow: /account' in body and 'Sitemap:' not in body
status,headers,body=get('/sitemap.xml');assert status==200;assert len(ET.fromstring(body))==0
status,headers,body=get('/api/store/state');state=json.loads(body)
assert len(state['products'])==50
assert all('Purity:' not in p['description'] and 'cognitive support' not in p['description'].lower() for p in state['products'])
for slug in ['noctis-blend-spray','zenith-semax-selank-spray']:
 assert 'pending confirmation' in next(p for p in state['products'] if p['slug']==slug)['sizes'][0]
print('PASS: route-specific titles and canonical URLs, preview noindex metadata and headers, factual descriptions, private routes, true 404s, robots policy, empty preview sitemap and cleaned public catalog data')
