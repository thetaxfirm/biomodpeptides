// Built Worker, isolated D1 and mocked authentication/carriers. No live account or email calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { Miniflare, Log, LogLevel } from 'miniflare';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),built=path.join(root,'dist/server');
const config=JSON.parse(await fs.readFile(path.join(built,'wrangler.json'),'utf8'));
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'biomod-fulfillment-worker-'));
const paths=(await fs.readdir(built,{recursive:true})).filter(n=>/\.(?:m?js)$/.test(n));
const fixtureEmail='fulfillment-fixture@example.invalid',fixtureSecret='isolated-fixture-secret';
const calls=[];let carrierStatus='pre_transit';
const mf=new Miniflare({name:'isolated-fulfillment',cf:false,modules:[config.main,...paths.filter(n=>n!==config.main)].map(n=>({type:'ESModule',path:path.join(built,n)})),modulesRoot:built,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,bindings:{SUPABASE_URL:'https://auth.example.invalid',SUPABASE_ANON_KEY:'fixture',STORE_ADMIN_EMAILS:fixtureEmail,EASYPOST_API_KEY:'fixture-api-key',EASYPOST_WEBHOOK_SECRET:fixtureSecret},d1Databases:{DB:'fixture-shipping'},d1Persist:path.join(temporary,'d1'),outboundService:async request=>{
 calls.push({url:request.url,method:request.method});
 if(request.url==='https://auth.example.invalid/auth/v1/user')return Response.json({id:'fixture-admin',email:fixtureEmail,email_confirmed_at:'2099-01-01',user_metadata:{name:'Isolated preview'}});
 if(request.url==='https://api.easypost.com/v2/carrier_accounts')return Response.json({carrier_accounts:[]});
 if(request.url==='https://api.easypost.com/v2/webhooks')return Response.json({webhooks:[{url:'https://trybiomod.com/api/shipping/easypost',disabled_at:null}]});
 if(request.url==='https://api.easypost.com/v2/shipments/shp_fixture')return Response.json({id:'shp_fixture',mode:'production',tracking_code:'FIXTURETRACK',tracker:{tracking_code:'FIXTURETRACK',status:carrierStatus}});
 throw Error('External action forbidden in shipping fixture');
},log:new Log(LogLevel.ERROR)});
const origin='https://trybiomod.com',id='00000001-0000-4000-8000-000000000001';
try{
 await mf.ready;const db=await mf.getD1Database('DB');
 for(const name of (await fs.readdir(path.join(root,'drizzle'))).filter(n=>n.endsWith('.sql')).sort()){
  const sql=(await fs.readFile(path.join(root,'drizzle',name),'utf8')).replace(/^--.*$/gm,'');
  await db.batch(sql.split(';').map(v=>v.trim()).filter(Boolean).map(v=>db.prepare(v)));
 }
 await db.prepare('INSERT INTO orders(id,owner,request_key,status,total,data,created,updated) VALUES(?,?,?,?,?,?,?,?)').bind(id,'fixture-admin','fixture-session','shipped',10000,JSON.stringify({items:[],email:fixtureEmail,shipment:{shipmentId:'shp_fixture',tracking:'FIXTURETRACK',status:'pre_transit'}}),Date.now(),Date.now()).run();
 const anonymous=await mf.dispatchFetch(origin+'/api/admin/shipping');assert.equal(anonymous.status,403);assert.equal(calls.length,0);
 const headers={cookie:'bm_access=isolated-fixture-token',origin,'content-type':'application/json'};
 const health=await mf.dispatchFetch(origin+'/api/admin/shipping',{headers});assert.equal(health.status,200);assert.equal(health.headers.get('cache-control'),'no-store');assert((await health.json()).connected);
 const post=()=>mf.dispatchFetch(origin+'/api/admin/shipping',{method:'POST',headers,body:JSON.stringify({id,refreshTracking:true})});
 assert.equal((await post()).status,200);const snapshot=await db.prepare('SELECT status,data FROM orders WHERE id=?').bind(id).first();assert.equal(snapshot.status,'shipped');assert.equal(JSON.parse(snapshot.data).shipment.status,'pre_transit','Legacy status remains but carrier truth is preserved');
 carrierStatus='in_transit';assert.equal((await post()).status,200);assert.equal(JSON.parse((await db.prepare('SELECT data FROM orders WHERE id=?').bind(id).first()).data).shipment.status,'in_transit');
 const body=JSON.stringify({description:'tracker.updated',created_at:new Date(Date.now()+1000).toISOString(),result:{object:'Tracker',mode:'production',shipment_id:'shp_fixture',tracking_code:'FIXTURETRACK',status:'delivered'}});
 const signature='hmac-sha256-hex='+createHmac('sha256',fixtureSecret).update(body).digest('hex');
 assert.equal((await mf.dispatchFetch(origin+'/api/shipping/easypost',{method:'POST',headers:{'x-hmac-signature':signature},body})).status,200);
 assert.equal((await db.prepare('SELECT status FROM orders WHERE id=?').bind(id).first()).status,'delivered');
 assert(calls.every(c=>c.method==='GET'),'No label purchase, mail or other external mutation');
 console.log('PASS: actual built Worker authenticated carrier health, anonymous denial, isolated D1 tracking refresh and signed delivered transition. Only mocked read-only provider requests.');
}finally{await mf.dispose();await fs.rm(temporary,{recursive:true,force:true});}
