const assert = require('node:assert/strict'), fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
const {products,compound,cas,productSummary,specificationNote}=require('../lib/catalog.ts');
const {seoConfig,mayIndex,sitemapPaths}=require('../lib/seo-policy.ts');
const source=require('../lib/catalog-facts-v2.json'),holds=require('../lib/product-specification-review-v1.json');
const cfg=seoConfig({SEO_PUBLIC_ORIGIN:'https://trybiomod.com',SEO_PUBLIC_LAUNCH_APPROVED:'true',SEO_INDEXING_ENABLED:'true',SEO_REVIEWED_PRODUCT_SLUGS:products.map(p=>p.slug).join(',')});
for(const slug of Object.keys(holds)){
 const p=products.find(p=>p.slug===slug), original=source.find(p=>p.slug===slug);
 assert(p && original);if(slug==='wolverine-20mg'){assert.equal(original.casNumber,'');assert.equal(p.purchasable,false);assert.equal(p.availabilityLabel,'Availability pending');}else assert(original.casNumber);assert.equal(cas(p),'');assert(specificationNote(p).includes('confirm')||specificationNote(p).includes('Confirm'));
 assert(!mayIndex('/product/'+slug,new URLSearchParams(),cfg));assert(!sitemapPaths(cfg).includes('/product/'+slug));
 assert.equal(p.id,original.id);assert.equal(p.sku,original.sku);assert.deepEqual(p.sizes,original.sizes);
}
const tb=products.find(p=>p.slug==='tb500-10mg');assert(specificationNote(tb).includes('fragment TB-500'));assert(!specificationNote(tb).includes('Astaxanthin'));assert(specificationNote(products.find(p=>p.slug==='ghk-cu-50mg')).includes('copper-free GHK'));assert(!compound(tb).includes('Thymosin Beta-4'));assert(!productSummary(tb).startsWith('Thymosin Beta-4'));
const bpc=products.find(p=>p.slug==='bpc-157-10mg');assert.equal(cas(bpc),'137525-51-0');assert(mayIndex('/product/'+bpc.slug,new URLSearchParams(),cfg));
console.log('PASS: conflicting identifiers withheld with visible specification notes; raw evidence retained; exact SKU/contents preserved; explicit holds cannot be overridden by broad SEO allowlist');
