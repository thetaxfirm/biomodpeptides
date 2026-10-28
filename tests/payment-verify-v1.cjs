// Automatic payment verification: asking the provider again about an order already marked paid, and
// insisting on a capture for that order's exact total. Isolated SQLite, provider and chat stubbed.
//
// The point of this suite is the money. Every way a paid order can turn out not to be paid — a wrong
// amount, another invoice, a void, a refund, nothing there at all — has to reach a verdict of failed,
// and a provider outage has to reach no verdict whatsoever.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),ts=require('typescript');
let overrides={};
function load(file){const name=path.join(root,file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(root);
  m.require=id=>{if(Object.hasOwn(overrides,id))return overrides[id];
    return id.startsWith('./')||id.startsWith('@/')?load(id.replace(/^@\//,'').replace(/^\.\//,'lib/')+(id.endsWith('.ts')?'':'.ts')):require(id);};
  m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,esModuleInterop:true}}).outputText,name);return m.exports;}

const check=load('lib/payment-check.ts');

// --- Reading a saved verification back. Anything malformed is not a pass. ---
assert.equal(check.savedPaymentVerification(null),null);
assert.equal(check.savedPaymentVerification({state:'settled'}),null,'no timestamp is no verification');
assert.equal(check.savedPaymentVerification({at:1,state:'maybe'}),null,'an unknown verdict is not one');
assert.deepEqual(check.savedPaymentVerification({at:5,state:'captured',transId:'123',amountCents:29254,why:'x'}),
  {at:5,state:'captured',transId:'123',amountCents:29254,why:'x'});
assert.equal(check.savedPaymentVerification({at:5,state:'failed',alertedAt:9}).alertedAt,9);
assert.equal(check.paymentConfirmed(null),false,'not asked yet is never a pass');
assert.equal(check.paymentConfirmed({state:'failed'}),false);
assert.equal(check.paymentConfirmed({state:'settled'}),true);
assert.equal(check.paymentConfirmed({state:'captured'}),true);
assert.match(check.verificationLabel({at:Date.now(),state:'settled',amountCents:29254,why:'',transId:'1'}),/settled at the provider/i);
assert.match(check.verificationLabel({at:Date.now(),state:'captured',amountCents:29254,why:'',transId:'1'}),/settling overnight/);
assert.match(check.verificationLabel({at:Date.now(),state:'failed',amountCents:null,why:'no payment for it',transId:''}),/could not be verified: no payment for it/);
assert.equal(check.verificationLabel(null),'');

const verify=load('lib/payment-verify.ts');

// --- The verdict, straight from what the provider returned. ---
const paidResult=(status,amount)=>({state:'paid',providerReference:'600',transactions:[
  {transId:'600',transactionStatus:status,transactionType:'authCaptureTransaction',settleAmount:amount,order:{invoiceNumber:'BIOMOD'},responseCode:'1'}]});
assert.equal(verify.verdictFor(paidResult('settledSuccessfully',292.54)).state,'settled');
assert.equal(verify.verdictFor(paidResult('settledSuccessfully',292.54)).amountCents,29254);
assert.equal(verify.verdictFor(paidResult('capturedPendingSettlement',292.54)).state,'captured');
assert.equal(verify.verdictFor({state:'paid',providerReference:'600',transactions:[]}).state,'captured','paid with no detail is collected, not settled');
// Everything the provider will not stand behind is one verdict, said in the owner's words.
assert.equal(verify.verdictFor({state:'pending',noPaymentFound:true}).state,'failed');
assert.match(verify.verdictFor({state:'pending',noPaymentFound:true}).why,/marked paid, but the provider has no payment/);
assert.match(verify.verdictFor({state:'pending',underReview:true}).why,/holding this payment for review/);
assert.match(verify.verdictFor({state:'failed'}).why,/unsuccessful payment/);
assert.match(verify.verdictFor({state:'review',message:'Authorize.net returned payment details that require reconciliation.'}).why,/require reconciliation/);
assert.equal(verify.RECHECK_MS,6*3600000);

// End to end with the real classifier, because "the exact order total" is the whole claim and the
// job itself only ever sees the classifier's answer. A cent out is not a verified payment.
const anet=load('lib/authorizenet-payments.ts');
const ORDER={id:'6f1d2c3b-0000-4000-8000-000000000001',totalCents:29254,currency:'USD'};
const REF=anet.anetOrderReference(ORDER.id);
const tx=(over={})=>({transId:'600',transactionType:'authCaptureTransaction',transactionStatus:'capturedPendingSettlement',responseCode:1,authAmount:292.54,settleAmount:292.54,order:{invoiceNumber:REF},...over});
const through=(...transactions)=>verify.verdictFor(anet.reconcileAnetTransactions(ORDER,transactions,REF));
assert.equal(through(tx()).state,'captured','the exact total verifies');
assert.equal(through(tx({settleAmount:292.53,authAmount:292.53})).state,'failed','a cent short is not this order\'s payment');
assert.equal(through(tx({settleAmount:999,authAmount:999})).state,'failed','nor is a larger capture');
assert.equal(through(tx({order:{invoiceNumber:'SOMEONE-ELSE'}})).state,'failed','a payment on another invoice never counts');
assert.equal(through(tx({transactionType:'refundTransaction'})).state,'failed','a refund is not a capture');
assert.equal(through(tx({transactionStatus:'voided'})).state,'failed','a voided transaction is not money');
assert.equal(through(tx({responseCode:2})).state,'failed','the bank has to have approved it');
assert.equal(through().state,'failed','and an order with no transaction at all never verifies');

// --- The job against real SQLite, with the provider and the chat stubbed. ---
const NOW=Date.parse('2026-10-27T18:00:00Z');
const H=3600000;
function fixture(rows){
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE orders(id TEXT PRIMARY KEY,total INTEGER,status TEXT,data TEXT,created INTEGER,checkout_ref TEXT);CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
  for(const r of rows) db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?)').run(r.id,r.total,r.status,JSON.stringify(r.data),r.created??NOW-2*86400000,r.ref??'600');
  return {raw:db,prepare(sql){let args=[];const api={bind(...a){args=a;return api;},
    async all(){return{results:db.prepare(sql).all(...args)};},
    async first(){return db.prepare(sql).get(...args)||null;},
    async run(){const r=db.prepare(sql).run(...args);return{meta:{changes:r.changes}};}};return api;}};
}
const saved=(db,id)=>JSON.parse(db.raw.prepare('SELECT data FROM orders WHERE id=?').get(id).data).paymentVerified;
const LIVE='authorizenet:live';
const base={address:{name:'Fixture'},environment:LIVE};
// The adapter and the chat are the only things stubbed. Everything else is the real module.
function run(db,{answer,posts=[],now=NOW}={}){
  overrides={
    '@/lib/payments':{paymentEnvironment:()=>LIVE,createPaymentAdapter:()=>({verifyPayment:async(order,ref,hints,created)=>answer(order,ref,created)})},
    './payments':{paymentEnvironment:()=>LIVE,createPaymentAdapter:()=>({verifyPayment:async(order,ref,hints,created)=>answer(order,ref,created)})},
  };
  let mod; try{ mod=load('lib/payment-verify.ts'); } finally { overrides={}; }
  return mod.runPaymentVerification({DB:db,...telegram},now,{fetch:async(url,init)=>{posts.push({url,body:JSON.parse(init.body)});return new Response('{"ok":true}',{status:200});}});
}
const telegram={};

(async()=>{
  // A captured payment for the exact total earns the check, and is asked about again later.
  let db=fixture([{id:'aaaaaaaa-1',total:29254,status:'paid',data:{...base}}]);
  db.raw.prepare('INSERT INTO settings VALUES(?,?)').run('telegram_bot_token_v1','1234567890:AAbbccddeeffgghhiijjkkllmmnnooppqq');
  db.raw.prepare('INSERT INTO settings VALUES(?,?)').run('telegram_chat_ids_v1','-100123');
  let health=await run(db,{answer:()=>paidResult('capturedPendingSettlement',292.54)});
  assert.equal(health.captured,1); assert.equal(health.failed,0); assert.equal(health.alerted,0);
  assert.equal(saved(db,'aaaaaaaa-1').state,'captured');
  assert.equal(saved(db,'aaaaaaaa-1').amountCents,29254);
  assert.equal(check.paymentConfirmed(check.savedPaymentVerification(saved(db,'aaaaaaaa-1'))),true,'a captured payment shows the check');

  // Asked again too soon: nothing is due, so the provider is not called at all.
  let calls=0;
  health=await run(db,{answer:()=>{calls++;return paidResult('settledSuccessfully',292.54);},now:NOW+H});
  assert.equal(health.due,0); assert.equal(calls,0,'a payment checked an hour ago is not asked about again');
  // Past the re-check window it is asked again, and settling finishes it for good.
  health=await run(db,{answer:()=>paidResult('settledSuccessfully',292.54),now:NOW+7*H});
  assert.equal(health.settled,1);
  assert.equal(saved(db,'aaaaaaaa-1').state,'settled');
  health=await run(db,{answer:()=>{throw Error('must not be asked');},now:NOW+100*H});
  assert.equal(health.due,0,'settled money is never questioned again');

  // --- Every way a paid order can turn out not to be paid. ---
  const failures=[
    ['wrong amount',{state:'review',message:'Authorize.net returned payment details that require reconciliation.'},/require reconciliation/],
    ['nothing there',{state:'pending',noPaymentFound:true},/no payment for it/],
    ['held, not collected',{state:'pending',underReview:true},/holding this payment/],
    ['declined after the fact',{state:'failed'},/unsuccessful payment/],
  ];
  for(const [name,answer,expected] of failures){
    const one=fixture([{id:'bbbbbbbb-1',total:29254,status:'shipped',data:{...base}}]);
    one.raw.prepare('INSERT INTO settings VALUES(?,?)').run('telegram_bot_token_v1','1234567890:AAbbccddeeffgghhiijjkkllmmnnooppqq');
    one.raw.prepare('INSERT INTO settings VALUES(?,?)').run('telegram_chat_ids_v1','-100123');
    const posts=[];
    const result=await run(one,{answer:()=>answer,posts});
    assert.equal(result.failed,1,name);
    assert.equal(check.paymentConfirmed(check.savedPaymentVerification(saved(one,'bbbbbbbb-1'))),false,name+' never shows a check');
    assert.match(saved(one,'bbbbbbbb-1').why,expected,name);
    // It is money, so it is said out loud: once, naming the order, with no customer detail in it.
    assert.equal(posts.length,1,name+' alerts');
    assert.match(posts[0].body.text,/^Payment problem on order #BBBBBBBB$/m);
    assert.match(posts[0].body.text,/marked paid\. Check it at the provider before shipping\./);
    assert(!/Fixture/.test(posts[0].body.text),'the alert names no customer');
    assert.equal(result.alerted,1);
    // Still broken six hours later: re-checked, still no check, and never mentioned twice.
    const again=[];
    const second=await run(one,{answer:()=>answer,posts:again,now:NOW+7*H});
    assert.equal(second.failed,1,name+' is re-checked');
    assert.deepEqual(again,[],name+' is only ever said once');
    assert.equal(second.alerted,0);
    // And when it comes good, the order earns its check without anyone being told again.
    const fixed=await run(one,{answer:()=>paidResult('settledSuccessfully',292.54),now:NOW+14*H});
    assert.equal(fixed.settled,1,name+' can recover');
    assert.equal(check.paymentConfirmed(check.savedPaymentVerification(saved(one,'bbbbbbbb-1'))),true);
  }

  // --- A provider outage is not a verdict. ---
  const outage=fixture([{id:'cccccccc-1',total:29254,status:'paid',data:{...base}}]);
  const quiet=[];
  health=await run(outage,{answer:()=>{throw Error('provider unreachable');},posts:quiet});
  assert.equal(health.unreachable,1); assert.equal(health.failed,0);
  assert.equal(saved(outage,'cccccccc-1'),undefined,'no verdict is written at all');
  assert.deepEqual(quiet,[],'and nobody is told a good payment went bad');

  // --- What is never asked about. ---
  const skipped=fixture([
    {id:'dddddddd-1',total:29254,status:'awaiting_payment',data:{...base}},
    {id:'eeeeeeee-1',total:29254,status:'paid',data:{...base,internalTest:true}},
    {id:'ffffffff-1',total:29254,status:'paid',data:{...base},created:NOW-61*86400000},
    {id:'gggggggg-1',total:29254,status:'refunded',data:{...base}},
  ]);
  health=await run(skipped,{answer:()=>{throw Error('must not be asked');}});
  assert.equal(health.due,0,'unpaid, test, ancient and refunded orders are never verified');

  // An order from another payment environment is skipped rather than answered wrongly.
  const foreign=fixture([{id:'hhhhhhhh-1',total:29254,status:'paid',data:{...base,environment:'authorizenet:sandbox'}}]);
  health=await run(foreign,{answer:()=>{throw Error('must not be asked');}});
  assert.equal(health.foreign,1); assert.equal(saved(foreign,'hhhhhhhh-1'),undefined);

  // --- Verifying must never postpone a parcel. ---
  const parcel=fixture([{id:'iiiiiiii-1',total:29254,status:'paid',data:{...base}}]);
  parcel.raw.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify({...base}),'iiiiiiii-1');
  const before=parcel.raw.prepare("SELECT data FROM orders WHERE id=?").get('iiiiiiii-1');
  await run(parcel,{answer:()=>paidResult('capturedPendingSettlement',292.54)});
  assert.notEqual(parcel.raw.prepare("SELECT data FROM orders WHERE id=?").get('iiiiiiii-1').data,before.data,'the verdict is saved');
  const sql=fs.readFileSync(path.join(root,'lib/payment-verify.ts'),'utf8');
  assert.match(sql,/UPDATE orders SET data=json_set\(data,'\$\.paymentVerified',json\(\?\)\) WHERE id=\?/,'one field only');
  assert(!/paymentVerified[\s\S]{0,200}updated=/.test(sql),'updated is never touched: it is the grace period automatic labels measure from');
  assert(!/SET status|status=\?/.test(sql),'verification never changes an order status');

  // --- Wiring. ---
  const workerSource=fs.readFileSync(path.join(root,'worker.ts'),'utf8');
  assert.match(workerSource,/runPaymentVerification\(verifyEnv/,'it runs on the 5-minute schedule');
  const ui=fs.readFileSync(path.join(root,'components/store/orders-admin.tsx'),'utf8');
  assert.match(ui,/orderPaymentStatus\(o\)/,'shared payment evidence appears on every order row');
  const display=load('lib/fulfillment.ts');
  assert.equal(display.orderPaymentStatus({status:'paid',data:{}}).label,'Paid · recorded','recorded payment never pretends it was independently verified');
  assert.equal(display.orderPaymentStatus({status:'paid',data:{paymentVerified:{state:'settled'}}}).label,'Paid · recorded','missing timestamp earns no verified claim');
  assert.equal(display.orderPaymentStatus({status:'paid',data:{paymentVerified:{at:1,state:'settled'}}}).label,'Paid · settled');
  assert.equal(display.orderPaymentStatus({status:'paid',data:{paymentVerified:{at:1,state:'failed'}}}).label,'Check payment');

  console.log('PASS: verdicts for settled, captured, wrong amount, missing, held and declined payments; the check only for a confirmed capture of the exact order total; one alert per order and never a second; recovery after a fix; a provider outage recording no verdict and alerting nobody; unpaid, test, ancient, refunded and foreign-environment orders never asked about; settled money never questioned again; and a write that touches one field and no status. Isolated SQLite, no network.');
})().catch(e=>{console.error(e);process.exitCode=1});
