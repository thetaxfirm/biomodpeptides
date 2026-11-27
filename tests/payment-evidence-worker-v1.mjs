// Real compiled route -> payment adapter -> saved evidence -> financial report. Synthetic providers only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {migrationStatements} from './sql-migration-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),built=path.join(root,'dist/server');
const config=JSON.parse(await fs.readFile(path.join(built,'wrangler.json'),'utf8'));
const files=(await fs.readdir(built,{recursive:true})).filter(n=>/\.(?:m?js)$/.test(n));
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'biomod-payment-evidence-'));
const order='aaaaaaaa-1111-4111-8111-111111111111',unpaid='bbbbbbbb-1111-4111-8111-111111111111',session='cccccccc-1111-4111-8111-111111111111';
const email='payment-evidence-fixture@example.invalid',created=Date.now()-45*86400000,settled=created+86400000;
const invoice=createHash('sha256').update('biomod:authorizenet:order:'+order).digest('hex').slice(0,20).toUpperCase();
const reads=[];let forbidden=0;
const mf=new Miniflare({name:'isolated-payment-evidence',cf:false,modules:[config.main,...files.filter(n=>n!==config.main)].map(n=>({type:'ESModule',path:path.join(built,n)})),modulesRoot:built,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,
 bindings:{SUPABASE_URL:'https://auth.example.invalid',SUPABASE_ANON_KEY:'fixture-public-key',STORE_ADMIN_EMAILS:email,AUTHORIZENET_API_LOGIN_ID:'FixtureLogin',AUTHORIZENET_TRANSACTION_KEY:'FixtureKey123456',AUTHORIZENET_SIGNATURE_KEY:'a'.repeat(128),AUTHORIZENET_ENVIRONMENT:'live',AUTHORIZENET_RETURN_URL:'https://trybiomod.com/payment/return',AUTHORIZENET_CONNECTION_VERIFIED:'true',COMMERCE_MODE:'live',COMMERCE_FULFILLMENT_VERIFIED:'true'},d1Databases:{DB:'fixture-payment-evidence'},d1Persist:path.join(temporary,'d1'),
 outboundService:async request=>{
  if(request.url==='https://auth.example.invalid/auth/v1/user'&&request.method==='GET')return Response.json({id:'fixture-owner',email,email_confirmed_at:'2026-01-01',user_metadata:{name:'Fixture'}});
  if(request.url==='https://api.authorize.net/xml/v1/request.api'&&request.method==='POST'){
   const body=await request.json(),method=Object.keys(body)[0];reads.push(method);
   const messages={resultCode:'Ok',message:[{code:'I00001',text:'Successful.'}]};
   if(method==='getUnsettledTransactionListRequest')return Response.json({messages,transactions:[]});
   if(method==='getSettledBatchListRequest')return Response.json({messages,batchList:[]});
   if(method==='getTransactionDetailsRequest'){
    assert.equal(body[method].transId,'600');
    return Response.json({messages,transaction:{transId:'600',transactionType:'authCaptureTransaction',transactionStatus:'settledSuccessfully',responseCode:1,authAmount:'100.00',settleAmount:'100.00',order:{invoiceNumber:invoice},submitTimeUTC:new Date(created+1000).toISOString(),batch:{settlementTimeUTC:new Date(settled).toISOString(),settlementState:'settledSuccessfully'}}});
   }
  }
  forbidden++;throw Error('Payment, refund, carrier or correspondence mutation is forbidden in this fixture');
 },log:new Log(LogLevel.ERROR)});
try{
 await mf.ready;const db=await mf.getD1Database('DB');
 const original={environment:'authorizenet:live',items:[{id:745,quantity:1,lineTotal:10000,product:{id:745,name:'Synthetic item',price:10000}}],total:10000,subtotal:10000,discount:0,tax:0,shipping:0,paymentVerified:{at:created+2*86400000,state:'settled',transId:'600',amountCents:10000,why:'Earlier synthetic verification'}};
 const insert=async(id,status)=>db.prepare('INSERT INTO orders(id,owner,request_key,status,data,total,checkout_ref,payment_ref,notification_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,'fixture-owner',id,status,JSON.stringify(original),10000,status==='delivered'?invoice:'fixture-unpaid',status==='delivered'?'600':null,status==='delivered'?'fixture-verified':null,created,created).run();
 for(const name of(await fs.readdir(path.join(root,'drizzle'))).filter(n=>n.endsWith('.sql')).sort()){
  if(name.startsWith('0043_')){await insert(order,'delivered');await insert(unpaid,'awaiting_payment');}
  await db.batch(migrationStatements(await fs.readFile(path.join(root,'drizzle',name),'utf8')).map(sql=>db.prepare(sql)));
 }
 await db.prepare('INSERT INTO sessions(id,updated) VALUES(?,?)').bind(session,Date.now()).run();
 const headers={cookie:'bm_session='+session+'; bm_access=fixture-access',origin:'https://trybiomod.com','content-type':'application/json'};
 const post=id=>mf.dispatchFetch('https://trybiomod.com/api/store/admin-reconcile',{method:'POST',headers,body:JSON.stringify({id,readOnly:true})});
 const response=await post(order);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const body=await response.json();assert.equal(body.verification.state,'settled');assert.equal(body.verification.settledAt,settled);
 assert.deepEqual(reads,['getUnsettledTransactionListRequest','getSettledBatchListRequest','getTransactionDetailsRequest'],'old known capture is retrieved even outside recent batch history');
 const saved=await db.prepare('SELECT * FROM orders WHERE id=?').bind(order).first(),data=JSON.parse(saved.data);assert.equal(saved.status,'delivered');assert.equal(saved.total,10000);assert.equal(saved.updated,created);assert.deepEqual(data.items,original.items);assert.equal(data.paidAt,undefined);assert.equal(data.paymentVerified.settledAt,settled);assert.equal(data.paymentCheck.attempts[0].settledAt,settled);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM order_payment_observations').first()).n,0,'historical store observation is never fabricated');
 const from=new Date(created).toISOString().slice(0,10),to=new Date(settled+86400000).toISOString().slice(0,10);
 const finance=await mf.dispatchFetch('https://trybiomod.com/api/admin/finance?'+new URLSearchParams({from,to,timeZone:'America/New_York'}),{headers});assert.equal(finance.status,200);const report=await finance.json();assert.equal(report.providerSettlementDates.knownOrders,1);assert.equal(report.paymentDates.unknownOrders,1);assert.equal(report.refunds.ordersWithoutCheck,1,'unpaid fixture has no saved check');
 const before=reads.length,denied=await post(unpaid);assert.equal(denied.status,400);assert.match((await denied.json()).error,/recorded payment/);assert.equal(reads.length,before,'evidence-only request never becomes checkout recovery');assert.equal((await db.prepare('SELECT COUNT(*) n FROM orders').first()).n,2);assert.equal((await db.prepare('SELECT COUNT(*) n FROM coa_delivery_outbox').first()).n,0);assert.equal(forbidden,0);
 console.log('PASS: compiled evidence-only reconciliation retrieves an old known capture, saves provider settlement/attempt dates, preserves original financial/customer/fulfillment state, leaves historical store dates unknown, reports the same cohort, and refuses unpaid recovery. Synthetic provider reads only.');
}finally{await mf.dispose();await fs.rm(temporary,{recursive:true,force:true});}
