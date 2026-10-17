// Shipping v1 (owner, Oct 17 2026): insurance and signature thresholds the owner sets, the "Dropped off"
// handoff, unscanned and stuck parcel flags, and the daily parcel alert. Synthetic fixtures and a stubbed
// EasyPost/Resend only; no network, real orders or customer data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),ts=require('typescript');
function load(file){const name=path.join(root,file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(root);
  m.require=id=>id.startsWith('./')||id.startsWith('@/')?load(id.replace(/^@\//,'').replace(/^\.\//,'lib/')+(id.endsWith('.ts')?'':'.ts')):require(id);
  m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,esModuleInterop:true}}).outputText,name);return m.exports;}
const o=load('lib/shipping-options.ts'),f=load('lib/fulfillment.ts');

// --- Thresholds: unset keeps today's behaviour (signature on every order, no insurance). ---
const unset=o.normalizeShippingOptions({});
assert.equal(unset.signatureOverCents,null); assert.equal(unset.insureOverCents,null);
assert.deepEqual(o.labelProtection(unset,5000),{signature:'SIGNATURE',insuredCents:null},'unset: every order signed, nothing insured');
assert.deepEqual(o.labelProtection(unset,null),{signature:'SIGNATURE',insuredCents:null});
const set=o.normalizeShippingOptions({signatureOverCents:30000,insureOverCents:20000});
assert.deepEqual(o.labelProtection(set,19999),{signature:null,insuredCents:null},'below both');
assert.deepEqual(o.labelProtection(set,20000),{signature:null,insuredCents:20000},'insured at the threshold, full goods value');
assert.deepEqual(o.labelProtection(set,94990),{signature:'SIGNATURE',insuredCents:94990},'both above');
assert.deepEqual(o.labelProtection(set,null),{signature:'SIGNATURE',insuredCents:null},'unknown value keeps the signature and never declares a guessed value');
assert.deepEqual(o.labelProtection(o.normalizeShippingOptions({signatureConfirmation:'none',signatureOverCents:100}),50000).signature,null,'signature off stays off');
for(const junk of [-1,1.5,'200',1e12,null]) assert.equal(o.normalizeShippingOptions({insureOverCents:junk}).insureOverCents,null,'junk threshold is not set: '+junk);
assert.equal(o.normalizeShippingOptions({insureOverCents:0}).insureOverCents,0,'zero means insure every order');
// Goods value: subtotal less discounts; shipping and tax are not insured.
assert.equal(o.goodsValueCents({subtotal:24700,discount:1470,shipping:900,tax:1946}),23230);
assert.equal(o.goodsValueCents({subtotal:0}),null); assert.equal(o.goodsValueCents(undefined),null); assert.equal(o.goodsValueCents({subtotal:'x'}),null);

// --- Unscanned and stuck flags reach staff, never the customer. ---
// A fixed clock: 10 AM Pacific, Oct 17 2026, so the daily alert's 9 AM gate is deterministic.
const H=3600000,now=new Date('2026-10-17T17:00:00Z').getTime();
const label=(extra={})=>({status:'paid',data:{shipment:{status:'pre_transit',tracking:'T'},labelCreatedAt:now-25*H,...extra}});
assert.equal(f.STALLED_LABEL_MS,24*H);
assert.equal(f.stalledLabel(label(),now),true,'a day without a scan is flagged');
assert.equal(f.stalledLabel(label({labelCreatedAt:now-23*H}),now),false);
assert.equal(f.orderBucket(label(),now),'review');
assert.equal(f.customerOrderStatus(label()).label,'Preparing shipment','the customer never sees an internal flag');
const stuck={status:'shipped',data:{shipment:{status:'in_transit',tracking:'T',checkedAt:now-5*24*H},labelCreatedAt:now-6*24*H}};
assert.equal(f.stuckInTransit(stuck,now),true); assert.equal(f.orderBucket(stuck,now),'review');
assert.equal(f.customerOrderStatus(stuck).label,'Shipped');
assert.equal(f.stuckInTransit({...stuck,data:{...stuck.data,shipment:{...stuck.data.shipment,checkedAt:now-2*24*H}}},now),false);
assert.equal(f.orderBucket({...stuck,data:{...stuck.data,shipment:{...stuck.data.shipment,checkedAt:now-2*24*H}}},now),'shipped');
assert.equal(f.carrierWords.pre_transit,'Not scanned by carrier yet'); assert.equal(f.carrierWords.unknown,'Not scanned by carrier yet');
// A real hold still reads as under review for the customer.
assert.equal(f.customerOrderStatus({...label(),data:{...label().data,hold:{issue:'x'}}}).label,'Under review');

// --- Route wiring: handoff never changes status or emails; tracked parcels are never delivered by hand. ---
const route=fs.readFileSync(path.join(root,'app/api/store/[action]/route.ts'),'utf8');
const handoff=route.slice(route.indexOf("action === 'admin-order-handoff'"),route.indexOf("action === 'admin-staff'"));
assert.match(route,/'admin-order-handoff': 'orders:fulfill'/);
assert.match(handoff,/json_set\(data,'\$\.handoff',json\(\?\)\)/);
assert(!/SET status|status=\?|sendTrackingEmail|resend/i.test(handoff),'handoff changes no status and sends nothing');
assert.match(route,/status === 'delivered' && carrierShipment\?\.tracking && carrierShipment\.status !== 'delivered'/,'hand-marked delivery refused on a tracked parcel');
for(const file of ['lib/auto-label.ts','app/api/admin/shipping/route.ts']) assert.match(fs.readFileSync(path.join(root,file),'utf8'),/valueCents: goodsValueCents\(data\)/,file+' passes the goods value');
assert.match(fs.readFileSync(path.join(root,'worker.ts'),'utf8'),/runParcelAlerts\(parcelEnv/,'the daily alert runs on the 5-minute schedule');

// --- Queue UI: Dropped off replaces Mark shipped. ---
const ui=fs.readFileSync(path.join(root,'components/store/orders-admin.tsx'),'utf8');
assert(!/Mark shipped/.test(ui),'the queue no longer claims a shipment by hand');
assert.match(ui,/change\('order-handoff', \{ orderId: order\.id \}/);
assert.match(ui,/The customer is not emailed/);

(async()=>{
  // --- The real buyLabel, EasyPost stubbed: insurance rides on the buy, the signature on the shipment. ---
  const easypost=load('lib/easypost.ts');
  const RATES=[{id:'rate_priority',carrier:'USPS',service:'Priority',rate:'11.40',currency:'USD',delivery_days:2,mode:'production'}];
  let created=[],buys=[];const realFetch=global.fetch;
  global.fetch=async(url,init)=>{const body=init.body?JSON.parse(init.body):null;
    if(url==='https://api.easypost.com/v2/shipments'){created.push(body.shipment);return Response.json({id:'shp_fixture',mode:'production',rates:RATES,options:body.shipment.options||{}});}
    if(url==='https://api.easypost.com/v2/shipments/shp_fixture/buy'){buys.push(body);const opts=created.at(-1).options||{};return Response.json({id:'shp_fixture',tracking_code:'SYNTHETIC',options:opts,...(body.insurance?{insurance:body.insurance}:{}),postage_label:{label_url:'https://example.invalid/label'},tracker:{public_url:'https://example.invalid/t'}});}
    throw Error('Unexpected external request prohibited: '+url);};
  const env={EASYPOST_API_KEY:'synthetic-fixture-key-only'},to={name:'Fixture',line1:'1 Test St',city:'Las Vegas',state:'NV',zip:'89118'},items=[{quantity:1,product:{categories:[]}}];
  const sel={carrier:'USPS',carrierService:'Priority',tier:'expedited',source:'easypost'};
  let l=await easypost.buyLabel(env,to,items,'fixture',sel,set,{valueCents:94990});
  assert.equal(buys.at(-1).insurance,'949.90','insures the full goods value'); assert.deepEqual(created.at(-1).options,{delivery_confirmation:'SIGNATURE'});
  assert.equal(l.insuredCents,94990); assert.equal(l.signature,'SIGNATURE');
  l=await easypost.buyLabel(env,to,items,'fixture',sel,set,{valueCents:10000});
  assert.equal(buys.at(-1).insurance,undefined,'below the threshold buys no insurance'); assert.equal(created.at(-1).options,undefined,'below the signature threshold asks for none');
  assert.equal(l.insuredCents,null); assert.equal(l.signature,null);
  await easypost.buyLabel(env,to,items,'fixture',sel,unset,{valueCents:94990});
  assert.equal(buys.at(-1).insurance,undefined,'unset: no insurance'); assert.deepEqual(created.at(-1).options,{delivery_confirmation:'SIGNATURE'},'unset: signature as before');
  global.fetch=realFetch;

  // --- Daily parcel alert: isolated SQLite, stubbed Resend. ---
  const {DatabaseSync}=require('node:sqlite');const sql=new DatabaseSync(':memory:');
  sql.exec("CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT,data TEXT,created INTEGER);CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)");
  const DB={prepare(q){const st=sql.prepare(q);let args=[];const api={bind(...a){args=a;return api;},async all(){return {results:st.all(...args)};},async first(){return st.get(...args)||null;},async run(){return {meta:{changes:st.run(...args).changes}};}};return api;}};
  const add=(id,status,data)=>sql.prepare('INSERT INTO orders VALUES(?,?,?,?)').run(id,status,JSON.stringify(data),now);
  const addr={name:'Fixture A',city:'Reno',state:'NV'};
  add('aaaaaaaa-1','paid',{address:addr,shipment:{status:'pre_transit',tracking:'T1'},labelCreatedAt:now-30*H});
  add('bbbbbbbb-1','paid',{address:addr,shipment:{status:'unknown',tracking:'T2'},labelCreatedAt:now-30*H,handoff:{at:now-28*H,by:'fixture'}});
  add('cccccccc-1','shipped',{address:addr,shipment:{status:'in_transit',tracking:'T3',checkedAt:now-5*24*H},labelCreatedAt:now-6*24*H});
  add('dddddddd-1','shipped',{address:addr,shipment:{status:'return_to_sender',tracking:'T4',checkedAt:now-H},labelCreatedAt:now-3*24*H});
  add('eeeeeeee-1','paid',{address:addr,shipment:{status:'pre_transit',tracking:'T5'},labelCreatedAt:now-2*H});
  add('ffffffff-1','shipped',{address:addr,shipment:{status:'in_transit',tracking:'T6',checkedAt:now-H},labelCreatedAt:now-2*24*H});
  add('gggggggg-1','paid',{address:addr,internalTest:true,shipment:{status:'pre_transit',tracking:'T7'},labelCreatedAt:now-30*H});
  add('hhhhhhhh-1','delivered',{address:addr,archivedAt:1,shipment:{status:'return_to_sender',tracking:'T8'},labelCreatedAt:now-30*H});
  const alerts=load('lib/parcel-alerts.ts');
  const found=await alerts.parcelAlerts({DB},now);
  assert.deepEqual(found.map(a=>a.id.slice(0,1)+':'+a.kind).sort(),['a:unscanned','b:unscanned','c:stuck','d:problem'],'fresh, moving, test and archived parcels stay out');
  const text=alerts.parcelAlertText(found,now);
  assert.match(text,/#AAAAAAAA.*never marked dropped off/); assert.match(text,/#BBBBBBBB.*marked dropped off/); assert.match(text,/Returning to sender/);
  const sent=[];const fakeFetch=async(url,init)=>{sent.push({url,body:JSON.parse(init.body),key:init.headers['Idempotency-Key']});return new Response('{}',{status:200});};
  const mailEnv={DB,RESEND_API_KEY:'synthetic',ORDER_NOTIFY_EMAILS:'staff@example.invalid'};
  const early=new Date('2026-10-17T14:00:00Z').getTime();
  assert.equal((await alerts.runParcelAlerts(mailEnv,early,{fetch:fakeFetch})).reason,'too_early');
  const r1=await alerts.runParcelAlerts(mailEnv,now,{fetch:fakeFetch});
  assert.equal(r1.sent,true); assert.equal(r1.count,4); assert.equal(sent.length,1);
  assert.deepEqual(sent[0].body.to,['staff@example.invalid']); assert.equal(sent[0].body.subject,'4 parcels need a look'); assert.equal(sent[0].key,'parcel-alerts-2026-10-17');
  assert.equal((await alerts.runParcelAlerts(mailEnv,now+60000,{fetch:fakeFetch})).reason,'already_today','one digest a day'); assert.equal(sent.length,1);
  assert.equal((await alerts.runParcelAlerts({DB:{prepare(){throw Error('down');}}},now)).reason,'failed','a broken database never fails the schedule');
  console.log('PASS: owner-set insurance and signature thresholds (unset keeps today\'s behaviour), goods value, insurance on the buy, unscanned 24h and stuck 4-day staff flags hidden from customers, Dropped off handoff without status change or email, hand-marked delivery refused on tracked parcels, daily parcel alert once per day. Synthetic only.');
})().catch(e=>{console.error(e);process.exit(1);});
