// Real scheduler/pricing, isolated D1-compatible SQLite, synthetic orders, mocked providers.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const original=Module._load;
let checkoutRuntime;
let paymentState={state:'pending',noPaymentFound:true},verificationHook=async()=>{},mailMode='ok';
Module._load=function(name,parent,...rest){if(parent?.filename.endsWith('/lib/checkout.ts')){if(name==='./runtime')return checkoutRuntime;if(name==='./auth'||name==='./commerce'||name==='./easypost')return {};if(name==='./order-summary')return {sendOrderNotification:async()=>{throw Error('Unexpected paid notification')}};}if(name.endsWith('/payments')||name==='./payments')return {paymentEnvironment:()=> 'authorizenet:live',getPaymentStatus:()=>({state:'live',checkoutEnabled:true}),createPaymentAdapter:()=>({verifyPayment:async(...args)=>{await verificationHook(...args);return paymentState;}})};if(name==='./catalog-visibility')return{unavailableOrder:d=>!d.items?.length||d.items.some(i=>i.id===999)};return original.call(this,name,parent,...rest)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
const {runCheckoutRecovery,recoveryAmounts,suppressRecovery}=require('../lib/checkout-recovery.ts');
const {applyPromotion,activePromotions}=require('../lib/promotions.ts');
const {anetOrderDetails,orderEmailHtml}=require('../lib/order-summary.ts');
const DAY=86400000,BASE=Date.parse('2026-10-12T00:00:00Z');
let now=BASE+2*DAY,mail=[];
global.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');mail.push(options);if(mailMode==='timeout')throw Error('synthetic timeout');return new Response(JSON.stringify({id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'}),{status:200})};
const databases=[];
function fixture(){
 const db=new DatabaseSync(':memory:');databases.push(db);
 db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE orders(id TEXT PRIMARY KEY,owner TEXT,status TEXT,data TEXT,total INTEGER,checkout_ref TEXT,created INTEGER,updated INTEGER,payment_ref TEXT,notification_id TEXT);');
 db.exec(fs.readFileSync(path.join(__dirname,'../drizzle/0018_checkout_recovery.sql'),'utf8'));
 db.prepare("UPDATE settings SET value=? WHERE key='checkout_recovery_v1'").run(JSON.stringify({enabled:true,startsAt:BASE}));
 db.prepare("INSERT INTO settings VALUES('coa_delivery_v1',?)").run(JSON.stringify({enabled:true,replyTo:'reply@example.invalid',notifyTo:null}));
 function statement(sql,args=[]){return{bind:(...a)=>statement(sql,a),first:async()=>db.prepare(sql).get(...args)||null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})}}
 const env={DB:{prepare:s=>statement(s),batch:async statements=>{db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}},RESEND_API_KEY:'synthetic',FIXED_TAX_RATE:'8.375',STORE_ADMIN_EMAILS:'owner@example.invalid'};
 const seed=(id='11111111-2222-4333-8444-555555555555',overrides={},fields={})=>{const promo=applyPromotion([{id:1,quantity:1,product:{name:'Synthetic item',price:10000},lineTotal:10000}],'BIOMOD15');const d={...promo,email:id+'@example.invalid',environment:'authorizenet:live',items:promo.items,subtotal:10000,discount:1500,packDiscount:0,shipping:500,tax:712,total:9712,address:{state:'NV',zip:'00000',city:'Fixture',line1:'Fixture'},...overrides};db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'synthetic-owner',fields.status||'awaiting_payment',JSON.stringify(d),d.total,'synthetic-reference',fields.created??BASE,BASE,fields.payment_ref||null,fields.notification_id||null);return id;};
 return{db,env,seed,run:()=>runCheckoutRecovery(env,{now:()=>now}),order:id=>{const row=db.prepare('SELECT * FROM orders WHERE id=?').get(id);return{...row,data:JSON.parse(row.data)}},job:id=>db.prepare('SELECT * FROM checkout_recovery WHERE order_id=?').get(id)};
}
(async()=>{try{
 for(const promo of activePromotions()){
  const applied=applyPromotion([{lineTotal:9999},{lineTotal:3251}],promo.code.toLowerCase());const subtotal=15000,packDiscount=1750,amount=applied.items.reduce((s,i)=>s+i.lineTotal,0),data={...applied,subtotal,discount:packDiscount+applied.promoDiscount,shipping:500,tax:0,total:amount+500};
  const r=recoveryAmounts(data);assert.equal(r.savings,Math.round(amount*0.075));assert.equal(r.items.reduce((s,i)=>s+i.lineTotal,0),amount-r.savings);assert(r.items.every(i=>i.lineTotal>=0));assert.equal(data.promo.code,promo.code);assert.throws(()=>recoveryAmounts({...data,recovery:{}}));
 }
 let f=fixture(),id=f.seed();now=BASE+DAY-1;await f.run();assert.equal(mail.length,0);assert(!f.job(id));now=BASE+DAY;
 await f.run();let o=f.order(id),j=f.job(id);assert.equal(j.status,'accepted');assert.equal(o.status,'awaiting_payment');assert.equal(o.data.recovery.savings,638);assert.equal(o.data.tax,658);assert.equal(o.total,9020);assert.equal(o.data.promo.code,'BIOMOD15');assert.equal(o.data.promo.savings,1500);assert.equal(JSON.parse(j.original_snapshot).total,9712);assert.match(anetOrderDetails(o.data).note,/additional|Additional/);assert.match(orderEmailHtml(id,o.data),/7.5%/);assert.match(JSON.parse(mail[0].body).text,/after any existing promo/);await f.run();assert.equal(mail.length,1);
 // No eligibility for confirmed internal tests, admins, historical/sandbox/paid/presale/held products, or recent payment activity.
 for(const scenario of [{d:{internalTest:true}},{d:{email:'owner@example.invalid'}},{d:{environment:'authorizenet:sandbox'}},{d:{campaignId:'fixture'}},{d:{items:[{id:999,lineTotal:8500}]}},{d:{lastPaymentFormAt:now-1000}},{fields:{created:BASE-1}},{fields:{status:'paid',payment_ref:'synthetic',notification_id:'synthetic'}},{fields:{status:'review'}}]){f=fixture();id=f.seed(undefined,scenario.d||{},scenario.fields||{});await f.run();assert(!f.job(id));assert.equal(f.order(id).total,9712);}
 // Provider-paid, held, declined, ambiguous and failed checks cannot produce an offer.
 for(const state of [{state:'paid'}, {state:'pending',underReview:true}, {state:'review'}, {state:'failed'}, {state:'pending'}]){paymentState=state;f=fixture();id=f.seed();await f.run();assert(!f.job(id));}
 paymentState={state:'pending',noPaymentFound:true};f=fixture();id=f.seed();verificationHook=async()=>{throw Error('private provider exception')};await assert.rejects(f.run(),{message:'Checkout recovery processing failed; inspect protected administration.'});assert(!f.job(id));verificationHook=async()=>{};
 // A pay-form issuance racing the provider check prevents repricing and mail.
 f=fixture();id=f.seed();verificationHook=async()=>{const d=f.order(id).data;d.lastPaymentFormAt=now;f.db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(d),id);};await f.run();assert(!f.job(id));assert.equal(f.order(id).total,9712);verificationHook=async()=>{};
 // Unknown delivery outcome retries exactly the same payload and key, never after 23h.
 f=fixture();id=f.seed();mailMode='timeout';const before=mail.length;await f.run();j=f.job(id);assert.equal(j.status,'queued');now+=300001;mailMode='ok';await f.run();assert.equal(f.job(id).status,'accepted');assert.equal(mail[before].body,mail[before+1].body);assert.equal(mail[before].headers['Idempotency-Key'],mail[before+1].headers['Idempotency-Key']);
 f=fixture();id=f.seed();mailMode='timeout';await f.run();now+=23*3600000;await f.run();assert.equal(f.job(id).status,'review');mailMode='ok';
 // Unsubscribe needs no login and prevents retry. No GET side effect in route.
 now=BASE+DAY;f=fixture();id=f.seed();mailMode='timeout';await f.run();j=f.job(id);assert(await suppressRecovery(f.env,j.unsubscribe_token));now+=300001;mailMode='ok';const n=mail.length;await f.run();assert.equal(f.job(id).status,'skipped');assert.equal(mail.length,n);assert.equal(await suppressRecovery(f.env,'bad-token'),false);
 // Paid between attempt and retry stops further mail, without changing payment history.
 f=fixture();id=f.seed();mailMode='timeout';await f.run();f.db.prepare("UPDATE orders SET status='paid',payment_ref='fixture',notification_id='fixture' WHERE id=?").run(id);now+=300001;mailMode='ok';await f.run();assert.equal(f.job(id).status,'skipped');assert.equal(f.order(id).status,'paid');
 // Real reconciliation cannot mark a changed amount paid after an in-flight verification.
 f=fixture();id=f.seed();f.db.exec('CREATE TABLE product_overrides(id INTEGER PRIMARY KEY,data TEXT);CREATE TABLE inventory_reservations(order_id TEXT,product_id INTEGER,quantity INTEGER);');
 checkoutRuntime={runtime:()=>f.env,database:()=>f.env.DB,one:async(sql,...args)=>f.env.DB.prepare(sql).bind(...args).first(),timestamp:()=>now,parse:(v,fallback)=>v?JSON.parse(v):fallback};
 const {reconcile}=require('../lib/checkout.ts');paymentState={state:'paid',providerReference:'fixture',notificationId:'fixture',message:'fixture'};
 verificationHook=async()=>{f.db.prepare('UPDATE orders SET total=total-1 WHERE id=?').run(id);};
 await assert.rejects(()=>reconcile('synthetic-owner',id),/order changed during verification/);assert.equal(f.order(id).status,'awaiting_payment');assert.equal(f.order(id).payment_ref,null);
 verificationHook=async()=>{};paymentState={state:'pending',noPaymentFound:true,message:'No payment found.'};
 f.db.prepare("UPDATE orders SET status='pending' WHERE id=?").run(id);assert.equal((await reconcile('synthetic-owner',id)).status,'awaiting_payment');
 console.log('PASS: actual recovery scheduler, 24-hour boundary, every promo stacking, tax, saved receipt, CAS payment race, paid/test/held exclusions, immutable retry, opt-out and no duplicate mail. Isolated fixtures only.');
}finally{databases.forEach(db=>db.close());Module._load=original;}})().catch(e=>{console.error(e);process.exitCode=1});
