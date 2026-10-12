// Production-built Worker with real local D1 migrations. All auth is mocked; other outbound calls are forbidden.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Miniflare,Log,LogLevel } from 'miniflare';
import { migrationStatements } from './sql-migration-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),built=path.join(root,'dist/server');
const config=JSON.parse(await fs.readFile(path.join(built,'wrangler.json'),'utf8'));
const paths=(await fs.readdir(built,{recursive:true})).filter(n=>/\.(?:m?js)$/.test(n));
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'biomod-product-editor-worker-'));
const origin='https://trybiomod.com',staffEmail='product-editor-owner@example.invalid';
const staffId='00000001-0000-4000-8000-000000000010',sessionId='00000001-0000-4000-8000-000000000011';
const catalog=JSON.parse(await fs.readFile(path.join(root,'lib/catalog-facts-v2.json'),'utf8'));
const product=catalog.find(p=>p.slug==='bpc-157-10mg'),held=catalog.find(p=>!p.purchasable&&p.availabilityLabel);
assert(product&&held);let authCalls=0,forbiddenCalls=0;
const mf=new Miniflare({name:'isolated-product-editor',cf:false,modules:[config.main,...paths.filter(n=>n!==config.main)].map(n=>({type:'ESModule',path:path.join(built,n)})),modulesRoot:built,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,bindings:{SUPABASE_URL:'https://auth.example.invalid',SUPABASE_ANON_KEY:'fixture',STORE_ADMIN_EMAILS:staffEmail},d1Databases:{DB:'product-editor-fixture'},d1Persist:path.join(temporary,'d1'),outboundService:async req=>{
 if(req.url==='https://auth.example.invalid/auth/v1/user'&&req.method==='GET'){authCalls++;return Response.json({id:staffId,email:staffEmail,email_confirmed_at:'2099-01-01',user_metadata:{name:'Synthetic owner'}});}
 forbiddenCalls++;throw Error('No external provider calls are allowed in the product editor fixture');
},log:new Log(LogLevel.ERROR)});
const headers={origin,'content-type':'application/json',cookie:`bm_access=isolated-fixture-token; bm_session=${sessionId}`};
const guestHeaders={origin,'content-type':'application/json',cookie:`bm_session=${sessionId}`};
const post=async(action,payload,requestHeaders=headers)=>{const r=await mf.dispatchFetch(origin+'/api/store/'+action,{method:'POST',headers:requestHeaders,body:JSON.stringify(payload)});assert.equal(r.headers.get('cache-control'),'no-store');return {status:r.status,body:await r.json()};};
const getState=async()=>{const r=await mf.dispatchFetch(origin+'/api/store/state',{headers:guestHeaders});assert.equal(r.status,200);return r.json();};
const find=state=>state.products.find(p=>p.id===product.id);
const base={id:product.id,price:10000,packPrices:{3:27000,5:null,10:80000},inStock:true,purchasable:true,stockQuantity:10,maxQuantity:10,expectedStock:10,sale:null};
const pauseUntil=async timestamp=>{const duration=timestamp-Date.now();if(duration>0)await new Promise(resolve=>setTimeout(resolve,duration));};
try{
 await mf.ready;const db=await mf.getD1Database('DB');
 for(const name of (await fs.readdir(path.join(root,'drizzle'))).filter(n=>n.endsWith('.sql')).sort()){const sql=await fs.readFile(path.join(root,'drizzle',name),'utf8');await db.batch(migrationStatements(sql).map(q=>db.prepare(q)));}
 await db.prepare('INSERT INTO sessions(id,cart,wishlist,updated) VALUES(?,?,?,?)').bind(sessionId,'[]','[]',Date.now()).run();
 await db.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?)').bind(product.id,JSON.stringify(base)).run();
 let result=await post('admin-product',{...base,availability:'coming_soon'},guestHeaders);assert.equal(result.status,400,'Signed-out editor cannot write');assert.equal(authCalls,0);
 for(const state of ['coming_soon','sold_out']){
  result=await post('admin-product',{...base,availability:state});assert.equal(result.status,200,JSON.stringify(result.body));
  const p=find(await getState());assert.equal(p.availability,state);assert.equal(p.inStock,false);assert.equal(p.purchasable,false);assert.equal(p.stockQuantity,10);assert.equal(p.availabilityLabel,state==='coming_soon'?'Coming soon':'Sold out');
  result=await post('cart',{cart:[{id:product.id,quantity:1}]},guestHeaders);assert.equal(result.status,400);assert.match(result.body.error,/available/);
 }
 result=await post('admin-product',{...base,availability:'available'});assert.equal(result.status,200);
 result=await post('cart',{cart:[{id:product.id,quantity:3,packId:'fixture-fixed',packSize:3,packKind:'fixed'}]},guestHeaders);assert.equal(result.status,200);assert.equal(result.body.totals.total,27000);
 // Genuine server time boundaries, no resetting countdown or manual sale-price mutation.
 const starts=Date.now()+1800,ends=starts+3000;
 result=await post('admin-product',{...base,availability:'available',sale:{enabled:true,percentOff:15,starts:new Date(starts).toISOString(),ends:new Date(ends).toISOString()}});assert.equal(result.status,200);
 assert.equal(find(await getState()).price,10000,'Future sale not charged early');
 await pauseUntil(starts+60);let active=find(await getState());assert.equal(active.price,8500);assert.equal(active.packPrices['3'],22950);assert.equal(active.activeSale.basePrice,10000);
 result=await post('cart',{cart:[{id:product.id,quantity:3,packId:'fixture-fixed',packSize:3,packKind:'fixed'}]},guestHeaders);assert.equal(result.status,200);assert.equal(result.body.totals.total,22950);
 for(const [code,percent] of [['bm10',10],['biomod15',15],['bmod20',20],['anna20',20],['kimc15',15]]){result=await post('promo',{code},guestHeaders);assert.equal(result.status,200);assert.equal(result.body.totals.total,22950-Math.round(22950*percent/100));assert.equal(result.body.promo.code,code.toUpperCase());}
 await pauseUntil(ends+60);active=find(await getState());assert.equal(active.price,10000);assert.equal(active.activeSale,undefined);assert.equal(active.packPrices['3'],27000);
 result=await post('cart',{cart:[{id:product.id,quantity:3,packId:'fixture-fixed',packSize:3,packKind:'fixed'}]},guestHeaders);assert.equal(result.status,200);assert.equal(result.body.totals.total,27000,'Expired sale cannot survive in the current checkout quote');
 result=await post('admin-product',{...base,id:held.id,expectedStock:null,availability:'available'});assert.equal(result.status,400);assert.match(result.body.error,/publication hold/);
 const response=await mf.dispatchFetch(origin+'/api/store/admin-changes?source=admin',{headers});assert.equal(response.status,200);const audit=await response.json();
 const changes=audit.events.filter(e=>e.entityType==='product'&&e.entityId===String(product.id));assert(changes.length>=4);
 assert(changes.every(e=>e.actor===staffEmail&&e.source==='admin'));
 assert(changes.some(e=>e.changes.some(c=>c.field==='Availability'&&c.before==='coming_soon'&&c.after==='sold_out')),'Precise status transition is attributed in the actual admin history route');
 assert(changes.some(e=>e.changes.some(c=>c.field==='Sale discount (%)'&&c.after===15)));
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM change_context').first()).n,0);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM orders').first()).n,0,'Fixture never places an order');
 assert.equal(forbiddenCalls,0);assert(authCalls>0);
 console.log('PASS: built Worker status save -> shared catalog -> cart/quote guard; real sale start/end and fixed-pack/all-code totals; authenticated before/after audit; publication hold and anonymous denial. Isolated D1, mock auth, no orders or live calls.');
}finally{await mf.dispose();await fs.rm(temporary,{recursive:true,force:true});}
