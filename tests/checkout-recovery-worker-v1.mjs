import { migrationStatements } from './sql-migration-fixture.mjs';
// Built production Worker, local D1 and intercepted providers. No real sends/payments.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {Miniflare,Log,LogLevel} from 'miniflare';
const root=process.cwd(),built=path.join(root,'dist/server'),config=JSON.parse(await fs.readFile(path.join(built,'wrangler.json'),'utf8'));
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'biomod-recovery-worker-'));
const paths=(await fs.readdir(built,{recursive:true})).filter(n=>/\.(?:m?js)$/.test(n));
const bindings={AUTHORIZENET_ENVIRONMENT:'live',AUTHORIZENET_API_LOGIN_ID:'fixtureLogin',AUTHORIZENET_TRANSACTION_KEY:'A'.repeat(16),AUTHORIZENET_SIGNATURE_KEY:'B'.repeat(128),AUTHORIZENET_RETURN_URL:'https://trybiomod.com/payment/return',AUTHORIZENET_CONNECTION_VERIFIED:'true',COMMERCE_MODE:'live',COMMERCE_FULFILLMENT_VERIFIED:'true',RESEND_API_KEY:'fixture',FIXED_TAX_RATE:'8.375'};
const sends=[],reads=[];
const mf=new Miniflare({name:'isolated-recovery',cf:false,unsafeTriggerHandlers:true,modules:[config.main,...paths.filter(n=>n!==config.main)].map(n=>({type:'ESModule',path:path.join(built,n)})),modulesRoot:built,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,bindings,d1Databases:{DB:'isolated-recovery'},d1Persist:path.join(temporary,'d1'),outboundService:async req=>{
 if(req.url==='https://api.authorize.net/xml/v1/request.api'){
  const body=await req.json(),kind=Object.keys(body)[0];reads.push(kind);
  assert(['getUnsettledTransactionListRequest','getSettledBatchListRequest'].includes(kind),'No payment or hosted-form creation permitted');
  return Response.json({messages:{resultCode:'Ok'},...(kind==='getSettledBatchListRequest'?{batchList:[]}:{transactions:[]})});
 }
 if(req.url==='https://api.resend.com/emails'){
  const payload=await req.json();assert(payload.to.every(e=>e.endsWith('@example.invalid')));assert.match(payload.text,/additional|extra/);sends.push(payload);
  return Response.json({id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'});
 }
 throw Error('Unexpected external request in isolated fixture');
},log:new Log(LogLevel.ERROR)});
try{
 await mf.ready;const db=await mf.getD1Database('DB');
 for (const name of (await fs.readdir(path.join(root, 'drizzle'))).filter(name => name.endsWith('.sql')).sort()) {
   const sql = await fs.readFile(path.join(root, 'drizzle', name), 'utf8');
   await db.batch(migrationStatements(sql).map(statement => db.prepare(statement)));
 }
 const now=Date.now(),id='11111111-2222-4333-8444-555555555555',product=JSON.parse(await fs.readFile(path.join(root,'lib/catalog-facts-v2.json'),'utf8'))[0];
 const data={email:'buyer@example.invalid',environment:'authorizenet:live',items:[{id:product.id,product:{price:10000,name:'Synthetic item'},quantity:1,lineTotal:8500}],subtotal:10000,discount:1500,promo:{code:'BIOMOD15',savings:1500},shipping:500,tax:712,total:9712,address:{state:'NV',zip:'00000',city:'Fixture',line1:'Fixture'}};
 const reference=createHash('sha256').update('biomod:authorizenet:order:'+id).digest('hex').slice(0,20).toUpperCase();
 await db.prepare('INSERT INTO orders(id,owner,request_key,status,data,total,checkout_ref,created,updated,payment_ref,notification_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,'fixture-owner','fixture-request-key','awaiting_payment',JSON.stringify(data),9712,reference,now-86401000,now-86401000,null,null).run();
 await db.prepare("UPDATE settings SET value=? WHERE key='checkout_recovery_v1'").bind(JSON.stringify({enabled:true,startsAt:now-2*86400000})).run();
 const cron=()=>mf.dispatchFetch('http://localhost/cdn-cgi/handler/scheduled?cron='+encodeURIComponent('*/5 * * * *'));
 let response=await cron();assert.equal(response.status,200,await response.text());assert.equal(sends.length,1);assert.equal(reads.length,4);
 const order=await db.prepare('SELECT status,total,data FROM orders WHERE id=?').bind(id).first();assert.equal(order.status,'awaiting_payment');assert.equal(order.total,9020);assert.equal(JSON.parse(order.data).promo.code,'BIOMOD15');
 const job=await db.prepare('SELECT status,unsubscribe_token FROM checkout_recovery WHERE order_id=?').bind(id).first();assert.equal(job.status,'accepted');
 const history=(await db.prepare('SELECT * FROM change_events').all()).results;
 const orderChanges=history.filter(event=>event.entity_type==='order'&&event.action==='order.update');
 assert(orderChanges.some(event=>JSON.parse(event.changes).some(change=>change.field==='Total (cents)'&&change.before===9712&&change.after===9020)),'Recovery price change must be durably audited');
 const recoveryChanges=history.filter(event=>event.entity_type==='recovery');assert(recoveryChanges.length>=3);
 for(const event of [...orderChanges,...recoveryChanges]){assert.equal(event.actor,'Unpaid checkout recovery scheduler');assert.equal(event.actor_type,'system');assert.equal(event.source,'system');}
 for(const privateValue of ['buyer@example.invalid',reference,job.unsubscribe_token])assert(!JSON.stringify(history).includes(privateValue),'History must exclude recipients, payment references and private unsubscribe tokens');
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM change_context').first()).n,0,'Scheduler must clear actor context');
 response=await cron();assert.equal(response.status,200);assert.equal(sends.length,1);
 const url='https://trybiomod.com/api/recovery/unsubscribe?token='+job.unsubscribe_token;
 response=await mf.dispatchFetch(url);assert.equal(response.status,200);assert.match(await response.text(),/Unsubscribe from checkout reminders/);assert.equal((await db.prepare('SELECT COUNT(*) n FROM checkout_recovery_suppression').first()).n,0);
 response=await mf.dispatchFetch(url,{method:'POST'});assert.equal(response.status,200);assert.equal((await db.prepare('SELECT COUNT(*) n FROM checkout_recovery_suppression').first()).n,1);
 assert.equal(JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='checkout_recovery_health_v1'").first()).value).status,'completed');
 console.log('PASS: built Worker cron, actual Authorize.net adapter with intercepted no-payment results, durable discounted order, mock mail, duplicate prevention and scanner-safe unsubscribe. No live provider requests.');
}finally{await mf.dispose();await fs.rm(temporary,{recursive:true,force:true});}
