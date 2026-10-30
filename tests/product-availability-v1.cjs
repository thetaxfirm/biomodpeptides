// Actual catalog, quote, admin route and SQLite audit/reservation SQL. No providers or live records.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
const sql=new DatabaseSync(':memory:');
for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(n=>n.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
const db={prepare(query){const statement=(values=[])=>({bind:(...next)=>statement(next),first:async()=>sql.prepare(query).get(...values)||null,all:async()=>({results:sql.prepare(query).all(...values)}),run:async()=>({results:[],meta:sql.prepare(query).run(...values),success:true})});return statement();},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const runtime={all:async(query,...args)=>sql.prepare(query).all(...args),one:async(query,...args)=>sql.prepare(query).get(...args)||null,setting:async(key,fallback)=>fallback,parse:(v,f)=>v?JSON.parse(v):f,database:()=>db,runtime:()=>({DB:db}),uid:randomUUID,timestamp:Date.now};
const originalLoad=Module._load;
Module._load=function(name,parent,isMain){if(name==='./runtime'&&parent?.filename.endsWith('/lib/commerce.ts'))return runtime;return originalLoad.call(this,name,parent,isMain);};
global.fetch=async()=>{throw Error('Network forbidden in product controls fixture');};
const {products}=require('../lib/catalog.ts'),{catalog,quote}=require('../lib/commerce.ts');
const availability=require('../lib/availability.ts'),{applySale}=require('../lib/sales.ts'),history=require('../lib/change-history.ts');
const {productAvailability,productAvailabilityLabel,schemaAvailability,applyAvailability,hasPublicationHold}=availability;
const p=products.find(p=>p.slug==='bpc-157-10mg'),preorder=products.find(p=>p.preorder?.enabled),held=products.find(hasPublicationHold);
assert(p&&preorder&&held);
const scheduled={enabled:true,percentOff:15,starts:'2020-01-01T00:00:00Z',ends:'2099-01-01T00:00:00Z'};
const base={price:10000,packPrices:{3:27000},sale:scheduled,inStock:true,purchasable:true,stockQuantity:8,maxQuantity:8};
const store=(product,data)=>sql.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(product.id,JSON.stringify(data));
const saved=product=>JSON.parse(sql.prepare('SELECT data FROM product_overrides WHERE id=?').get(product.id).data);
const events=product=>sql.prepare("SELECT * FROM change_events WHERE entity_type='product' AND entity_id=? ORDER BY rowid").all(String(product.id)).map(e=>({...e,changes:JSON.parse(e.changes)}));
let staffRole='owner',authorized=false;
class FixtureResponse extends Response{static json(value,options={}){return new FixtureResponse(JSON.stringify(value),{...options,headers:{'Content-Type':'application/json',...options.headers}});}}
const deps={'@/lib/packs':require('../lib/packs.ts'),
 'next/server':{NextResponse:FixtureResponse},
 '@/lib/availability':availability,
 '@/lib/product-batch':require('../lib/product-batch.ts'),
 '@/lib/coa-delivery':require('../lib/coa-delivery.ts'),
 '@/lib/commerce':{catalog,quote},
 '@/lib/runtime':runtime,
 '@/lib/change-history':history,
 '@/lib/inventory-statements.json':require('../lib/inventory-statements.json'),
 '@/lib/auth':{session:async()=>({id:'fixture-session'}),rateLimit:async()=>{},requireStaff:async permission=>{assert.equal(permission,'catalog:write');if(!['owner','manager','catalog'].includes(staffRole))throw Error('Store access required');authorized=true;return {email:'fixture-owner@example.invalid',role:staffRole};}},
};
const filename=path.join(root,'app/api/store/[action]/route.ts'),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));const localRequire=Module.createRequire(filename);
mod.require=name=>Object.hasOwn(deps,name)?deps[name]:name.startsWith('@/')||name==='next/headers'?new Proxy({},{get:(_,key)=>key==='__esModule'?true:()=>{throw Error('Unexpected dependency '+name+':'+String(key));}}):localRequire(name);
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,filename);
async function post(payload,origin='https://store.example.invalid'){
 payload={expectedVersion:await require('../lib/coa-delivery.ts').coaHash(sql.prepare('SELECT data FROM product_overrides WHERE id=?').get(payload.id)?.data||''),...payload};
 authorized=false;const req=new Request('https://store.example.invalid/api/store/admin-product',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(payload)});req.nextUrl=new URL(req.url);const response=await mod.exports.POST(req,{params:Promise.resolve({action:'admin-product'})});assert.equal(response.headers.get('cache-control'),'no-store');return {status:response.status,...await response.json()};
}
const payload=(product=p,extra={})=>({id:product.id,...base,expectedStock:8,...extra});
(async()=>{
 for(const [fields,state] of [[{},'available'],[{inStock:false},'sold_out'],[{purchasable:false},'unavailable'],[{stockQuantity:0},'sold_out']])assert.equal(productAvailability({...p,...base,...fields}),state);
 for(const state of ['coming_soon','sold_out','unavailable']){
  store(p,{...base,availability:state});const live=(await catalog()).find(x=>x.id===p.id);assert.equal(productAvailability(live),state);assert.equal(live.inStock,false);assert.equal(live.purchasable,false);assert.equal(live.stockQuantity,8);assert.equal(live.price,10000);assert(!live.activeSale);assert(!live.activePreorder);assert.deepEqual(applyAvailability(live),live,'Repeated normalization is stable');
  assert.equal(productAvailabilityLabel(live),{coming_soon:'Coming soon',sold_out:'Sold out',unavailable:'Unavailable'}[state]);
  assert.equal(schemaAvailability({...live,activePreorder:{percentOff:15,ships:'early November 2026',basePrice:10000}}),'https://schema.org/OutOfStock');
  await assert.rejects(()=>quote([{id:p.id,quantity:1}]),/available/);
 }
 store(p,{...base,availability:'available'});const live=(await catalog()).find(x=>x.id===p.id);assert.equal(live.price,8500);assert.equal(live.packPrices['3'],22950);assert.equal(schemaAvailability(live),'https://schema.org/InStock');
 assert.equal((await catalog(false)).find(x=>x.id===p.id).price,10000,'Admin uses original base price');
 for(const [code,percent] of [['bm10',10],['BIOMOD15',15],['bmod20',20],['anna20',20],['kimc15',15]])assert.equal((await quote([{id:p.id,quantity:1}],code)).total,8500-Math.round(8500*percent/100));
 assert.equal((await quote([{id:p.id,quantity:3,packId:'fixture-pack',packKind:'fixed',packSize:3}])).total,22950);
 const end=Date.parse(scheduled.ends);assert.equal(applySale(live,end).price,10000);assert.equal(applySale(live,Date.parse(scheduled.starts)-1).price,10000);
 store(preorder,{...base,availability:'available'});const active=(await catalog()).find(x=>x.id===preorder.id);assert.equal(active.price,8500);assert(active.activePreorder);assert(!active.activeSale);assert.equal(schemaAvailability(active),'https://schema.org/PreOrder');
 assert.equal(applySale({...active,availability:'sold_out'}).price,10000);assert(!applySale({...active,availability:'sold_out'}).activePreorder);
 store(preorder,{...base,availability:'coming_soon'});await assert.rejects(()=>quote([{id:preorder.id,quantity:1}]),/available/);
 store(held,{...base,availability:'available'});const guarded=(await catalog()).find(x=>x.id===held.id);assert(!guarded.purchasable);assert.equal(guarded.availabilityLabel,held.availabilityLabel);await assert.rejects(()=>quote([{id:held.id,quantity:1}]),/available/);
 assert.equal(products.find(x=>x.id===p.id).availability,undefined,'Merged runtime status never mutates source');

 // Actual admin API, explicit selections and older editors that omit optional settings.
 store(p,{...base,availability:'coming_soon'});let result=await post(payload(p,{availability:'available',inStock:false,purchasable:false}));assert.equal(result.status,200);assert.equal(saved(p).availability,'available');assert.equal(saved(p).inStock,true);assert.equal(saved(p).purchasable,true);
 for(const state of ['coming_soon','sold_out','unavailable']){result=await post(payload(p,{availability:state}));assert.equal(result.status,200);assert.equal(saved(p).availability,state);assert.equal(saved(p).stockQuantity,8);assert.equal(saved(p).inStock,false);assert.equal(saved(p).purchasable,false);}
 const legacy=payload();delete legacy.sale;delete legacy.packPrices;result=await post(legacy);assert.equal(result.status,200);assert.equal(saved(p).availability,'unavailable');assert.deepEqual(saved(p).sale,scheduled);assert.deepEqual(saved(p).packPrices,{3:27000});
 store(p,{...base,inStock:false,purchasable:false});result=await post(payload(p,{inStock:false,purchasable:false}));assert.equal(result.status,200);assert.equal(saved(p).availability,undefined);assert.equal(saved(p).purchasable,false);
 result=await post(payload(p,{availability:'available'}));assert.equal(result.status,200);assert.equal(saved(p).purchasable,true,'Ordinary runtime unavailable products may be deliberately released');
 result=await post(payload(p,{availability:'available',stockQuantity:0}));assert.equal(result.status,200);assert.equal(saved(p).stockQuantity,0);assert.equal(productAvailability((await catalog()).find(x=>x.id===p.id)),'sold_out','Available selection never creates inventory');
 store(p,base);
 for(const extra of [{availability:'PRIVATE_STATUS'},{availability:null},{sale:{...scheduled,percentOff:100}},{sale:{...scheduled,starts:scheduled.ends}},{sale:{...scheduled,ends:'not-a-date'}}]){const before=JSON.stringify(saved(p));result=await post(payload(p,extra));assert.equal(result.status,400);assert.equal(JSON.stringify(saved(p)),before);}
 result=await post(payload(held,{availability:'available'}));assert.equal(result.status,400);assert.match(result.error,/owner release confirmation/);
 store(held,{...base,inStock:false,purchasable:false});result=await post(payload(held));assert.equal(result.status,200);assert.equal(saved(held).purchasable,false,'Legacy checkboxes cannot bypass a source hold');
 store(preorder,{...base,preorder:{enabled:true,percentOff:15,ships:'early November 2026'}});result=await post(payload(preorder,{availability:'coming_soon'}));assert.equal(result.status,400);assert.match(result.error,/current product editor/);assert(saved(preorder).preorder.enabled);
 result=await post(payload(preorder,{availability:'coming_soon',preorder:saved(preorder).preorder}));assert.equal(result.status,200);assert(saved(preorder).preorder.enabled,'Availability edit retains separate initial preorder offer');
 store(p,base);result=await post(payload(p,{expectedStock:999}));assert.equal(result.status,400);assert.equal(saved(p).stockQuantity,8);
 for(const role of ['support','fulfillment','customer']){staffRole=role;result=await post(payload());assert.equal(result.status,400);assert(!authorized);}staffRole='owner';
 // Catalog role (owner, Oct 30 2026): prices and sales save; stock, availability, limits and release attempts never do.
 store(p,{...base,availability:'available'});staffRole='catalog';
 result=await post(payload(p,{price:12345,packPricingMode:'custom',packPrices:{3:30000},sale:null,availability:'unavailable',inStock:false,purchasable:false,stockQuantity:999,maxQuantity:1}));
 assert.equal(result.status,200,result.error);assert(authorized);
 assert.equal(saved(p).price,12345);assert.equal(saved(p).packPrices['3'],30000);assert.equal(saved(p).sale,null,'Catalog may change sales');
 assert.deepEqual([saved(p).availability,saved(p).inStock,saved(p).purchasable,saved(p).stockQuantity,saved(p).maxQuantity],['available',true,true,8,8],'Catalog cannot change availability, stock or limits');
 store(preorder,{...base,preorder:{enabled:true,percentOff:15,ships:'early November 2026'}});
 result=await post(payload(preorder,{preorder:{enabled:false,percentOff:50,ships:'never'}}));assert.equal(result.status,200,result.error);
 assert.deepEqual(saved(preorder).preorder,{enabled:true,percentOff:15,ships:'early November 2026'},'Catalog cannot change preorder terms');
 result=await post(payload(held,{availability:'available',releaseReviewed:true,releaseReason:'Catalog attempt at a release'}));assert.equal(result.status,400);assert.match(result.error,/Only an owner/);
 staffRole='owner';store(p,base);
 result=await post(payload(), 'https://elsewhere.example.invalid');assert.equal(result.status,403);assert(!authorized);

 // New migration leaves history immutable, emits precise enum differences, and never copies invalid private content.
 store(p,{...base,availability:'coming_soon'});const snapshot=events(p).map(e=>JSON.stringify(e));
 result=await post(payload(p,{availability:'sold_out',inStock:false,purchasable:false}));assert.equal(result.status,200);
 const audit=events(p).at(-1);assert.equal(audit.actor,'fixture-owner@example.invalid');assert.equal(audit.source,'admin');assert(audit.changes.some(c=>c.field==='Availability'&&c.before==='coming_soon'&&c.after==='sold_out'));
 assert.deepEqual(events(p).slice(0,-1).map(e=>JSON.stringify(e)),snapshot);
 const beforeSame=events(p).length;result=await post(payload(p,{availability:'sold_out'}));assert.equal(result.status,200);assert.equal(events(p).length,beforeSame,'Repeated equal status and price does not append fake change');
 for(const secret of ['PRIVATE_STATUS',{token:'PRIVATE_STATUS'},['PRIVATE_STATUS']])store(p,{...base,availability:secret});
 assert(!JSON.stringify(events(p)).includes('PRIVATE_STATUS'));assert.equal(sql.prepare('SELECT COUNT(*) n FROM change_context').get().n,0);
 const originalCount=events(p).length;sql.exec(fs.readFileSync(path.join(root,'drizzle/0021_product_availability_history.sql'),'utf8'));assert.equal(events(p).length,originalCount,'Migration updates only trigger definitions, never earlier history or runtime values');
 console.log('PASS: explicit and legacy availability, source holds, stock/checkout guards, scheduled sale and pack/promo totals, preorder precedence, actual protected admin API, stale editor preservation and private immutable status history. Synthetic SQLite only.');
 sql.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
