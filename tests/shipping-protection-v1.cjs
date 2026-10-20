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
// A parcel the provider refuses to answer about is a different problem from an unscanned one.
assert.equal(f.UNREADABLE_AFTER,3);
assert.equal(f.unreadableParcel(label({shipment:{status:'pre_transit',tracking:'T',readFails:3}})),true);
assert.equal(f.unreadableParcel(label({shipment:{status:'pre_transit',tracking:'T',readFails:2}})),false);
assert.equal(f.unreadableParcel(label()),false,'no count is not a verdict');
// Dismissing a carrier flag: only the three the carrier owns, only while it says the same thing.
const q=load('lib/order-queue.ts');
const dismissedAt=now-H;
const unscanned=label();
assert.equal(f.dismissibleReview(unscanned,now),true,'not scanned is a carrier flag');
assert.equal(f.dismissibleReview({...label(),data:{...label().data,hold:{issue:'x'}}},now),false,'a hold has its own button');
assert.equal(f.dismissibleReview({status:'paid',data:{labelApproval:{cents:9240,limitCents:7500}}},now),false,'postage over the limit needs a real decision');
assert.equal(f.dismissibleReview({status:'review',data:{}},now),false,'a payment that needs checking is not a carrier flag');
assert.equal(f.dismissibleReview({status:'paid',data:{shipment:{status:'pre_transit'},labelCreatedAt:now-2*H}},now),false,'a parcel that is not flagged has nothing to dismiss');
const returning={status:'shipped',data:{shipment:{status:'return_to_sender',tracking:'T'},labelCreatedAt:now-3*24*H}};
assert.equal(f.dismissibleReview(returning,now),true,'a carrier problem is dismissible');
assert.equal(f.dismissibleReview(stuck,now),true,'so is a stuck parcel');
// Accepted: it leaves Needs review for Shipped, and only in the admin queue.
const accept=(order,carrierStatus)=>({...order,data:{...order.data,dismissed:{at:dismissedAt,by:'owner@example.invalid',carrierStatus}}});
const okUnscanned=accept(unscanned,'pre_transit');
assert.equal(f.flagDismissed(okUnscanned),true);
assert.equal(f.orderBucket(okUnscanned,now),'review','the underlying reason is untouched');
assert.equal(f.queueBucket(okUnscanned,now),'shipped','the queue stands the flag down');
assert.equal(f.queueBucket(accept(returning,'return_to_sender'),now),'shipped');
assert.equal(f.customerOrderStatus(okUnscanned).label,'Preparing shipment','the customer view never consults a dismissal');
// Tied to the status it was given for: a different carrier answer brings the flag straight back.
assert.equal(f.flagDismissed(accept(returning,'in_transit')),false,'a stale dismissal does not match');
assert.equal(f.queueBucket(accept(returning,'in_transit'),now),'review','so the order comes back');
assert.equal(f.flagDismissed({...unscanned,data:{...unscanned.data,dismissed:{by:'x',carrierStatus:'pre_transit'}}}),false,'a dismissal with no time is not one');
// A hold can never be stood down, even if a dismissal is somehow on the record.
const heldAndDismissed={...label(),data:{...label().data,hold:{issue:'x'},dismissed:{at:dismissedAt,by:'o',carrierStatus:'pre_transit'}}};
assert.equal(f.queueBucket(heldAndDismissed,now),'review','a hold outranks any dismissal');
// The queue tags from queueBucket, so a dismissed order is counted and listed under Shipped.
const queued=q.queryOrders([{id:'dddddddd-dddd',status:'paid',total:1,created:now-30*H,data:okUnscanned.data}],{tab:'shipped'},now);
assert.equal(queued.counts.review,0); assert.equal(queued.counts.shipped,1); assert.equal(queued.orders.length,1);
assert.equal(q.queryOrders([{id:'dddddddd-dddd',status:'paid',total:1,created:now-30*H,data:unscanned.data}],{tab:'review'},now).counts.review,1,'and under Needs review without one');

// The 48-hour reminder measures from payment, never from the label (owner, Oct 20 2026).
assert.equal(f.UNSHIPPED_REMINDER_MS,48*H);
assert.equal(f.paidAt({status:'paid',data:{paidAt:now-10*H},created:now-9*24*H}),now-10*H,'the stamp wins over the order date');
assert.equal(f.paidAt({status:'paid',data:{},created:now-10*H}),now-10*H,'older records fall back to the order date');
assert.equal(f.unshippedTooLong({status:'paid',data:{paidAt:now-49*H},created:now-49*H},now),true);
assert.equal(f.unshippedTooLong({status:'paid',data:{paidAt:now-47*H},created:now-47*H},now),false);
assert.equal(f.unshippedTooLong({status:'shipped',data:{paidAt:now-90*H},created:now-90*H},now),false,'a shipped order is never late');
assert.equal(f.unshippedTooLong({status:'awaiting_payment',data:{},created:now-90*H},now),false,'an unpaid order is not this alert');

// --- Route wiring: handoff never changes status or emails; tracked parcels are never delivered by hand. ---
const route=fs.readFileSync(path.join(root,'app/api/store/[action]/route.ts'),'utf8');
const handoff=route.slice(route.indexOf("action === 'admin-order-handoff'"),route.indexOf("action === 'admin-staff'"));
assert.match(route,/'admin-order-handoff': 'orders:fulfill'/);
assert.match(handoff,/json_set\(data,'\$\.handoff',json\(\?\)\)/);
assert(!/SET status|status=\?|sendTrackingEmail|resend/i.test(handoff),'handoff changes no status and sends nothing');
assert.match(route,/status === 'delivered' && carrierShipment\?\.tracking && carrierShipment\.status !== 'delivered'/,'hand-marked delivery refused on a tracked parcel');
for(const file of ['lib/auto-label.ts','app/api/admin/shipping/route.ts']) assert.match(fs.readFileSync(path.join(root,file),'utf8'),/valueCents: goodsValueCents\(data\)/,file+' passes the goods value');
assert.match(fs.readFileSync(path.join(root,'worker.ts'),'utf8'),/runParcelAlerts\(parcelEnv/,'the daily alert runs on the 5-minute schedule');
assert.match(fs.readFileSync(path.join(root,'lib/checkout.ts'),'utf8'),/json_set\(data,'\$\.paidAt',\?\).*json_extract\(data,'\$\.paidAt'\) IS NULL/,'payment stamps when it landed, once');
// Asking the carrier records sweptAt; checkedAt stays the carrier's own last change, so the button
// cannot hide a stuck parcel by resetting the clock the four-day alert measures.
assert.match(fs.readFileSync(path.join(root,'app/api/admin/shipping/route.ts'),'utf8'),/json_set\(data,'\$\.shipment\.sweptAt',\?\) WHERE id=\?/,'an unchanged status writes only sweptAt');

// --- Queue UI: Dropped off replaces Mark shipped. ---
const ui=fs.readFileSync(path.join(root,'components/store/orders-admin.tsx'),'utf8');
assert(!/Mark shipped/.test(ui),'the queue no longer claims a shipment by hand');
assert.match(ui,/change\('order-handoff', \{ orderId: order\.id \}/);
assert.match(ui,/The customer is not emailed/);
assert.match(ui,/unreadableParcel\(o\)\) return 'Carrier will not return tracking/,'the queue names a provider refusal for what it is');
assert.match(ui,/send\(\{ dismiss: true \}/,'the queue offers a way to accept a carrier flag');
assert.match(ui,/send\(\{ undoDismiss: true \}/,'and a way to put it back');
const shipRoute=fs.readFileSync(path.join(root,'app/api/admin/shipping/route.ts'),'utf8');
assert.match(shipRoute,/body\.dismiss === true/,'the endpoint exists');
assert.match(shipRoute,/dismissibleReview\(\{ status: order\.status, data \}\)/,'and refuses anything that is not a carrier flag');
assert.match(shipRoute,/WHERE id=\? AND coalesce\(json_extract\(data,'\$\.shipment\.status'\),''\)=\?/,'and only lands while the carrier still says the same thing');

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
  // Paid, but never reached the carrier. An order nobody bought postage for has no tracking to match
  // on, so until the 48-hour reminder it produced no alert of any kind (owner, Oct 20 2026).
  const addAt=(id,status,data,created)=>sql.prepare('INSERT INTO orders VALUES(?,?,?,?)').run(id,status,JSON.stringify(data),created);
  addAt('iiiiiiii-1','paid',{address:addr,paidAt:now-60*H},now-60*H);
  addAt('jjjjjjjj-1','paid',{address:addr,paidAt:now-72*H,labelApproval:{cents:9240,limitCents:7500,at:now-70*H}},now-72*H);
  addAt('kkkkkkkk-1','paid',{address:addr,paidAt:now-55*H,hold:{issue:'out_of_stock',at:now-50*H}},now-55*H);
  // Paid two days ago; the label itself is only hours old, so the 24-hour unscanned rule says nothing.
  addAt('llllllll-1','paid',{address:addr,paidAt:now-50*H,labelCreatedAt:now-10*H,shipment:{status:'pre_transit',tracking:'T9'}},now-50*H);
  // Inside the window, and an order placed days ago but only just paid: both stay quiet. The second is
  // why payment is stamped rather than measured from the order date, which a recovery email can precede by days.
  addAt('mmmmmmmm-1','paid',{address:addr,paidAt:now-20*H},now-20*H);
  addAt('nnnnnnnn-1','paid',{address:addr,paidAt:now-3*H},now-9*24*H);
  // A record written before paidAt existed falls back to when the order was placed.
  addAt('oooooooo-1','paid',{address:addr},now-70*H);
  // The carrier has refused this parcel three sweeps running. It still needs a person, but the thing
  // to check is the label at the provider, not whether the box was posted (owner, Oct 20 2026).
  add('pppppppp-1','paid',{address:addr,shipment:{status:'pre_transit',tracking:'TA',readFails:3},labelCreatedAt:now-30*H});
  // Two refusals is not yet a verdict: one provider wobble must not accuse a good parcel.
  add('qqqqqqqq-1','paid',{address:addr,shipment:{status:'pre_transit',tracking:'TB',readFails:2},labelCreatedAt:now-30*H});
  // Dismissed by the owner: out of the daily email until the carrier says something different.
  add('rrrrrrrr-1','paid',{address:addr,shipment:{status:'pre_transit',tracking:'TC'},labelCreatedAt:now-30*H,dismissed:{at:now-H,by:'owner@example.invalid',carrierStatus:'pre_transit'}});
  // A dismissal that no longer matches what the carrier says is no dismissal at all.
  add('ssssssss-1','shipped',{address:addr,shipment:{status:'return_to_sender',tracking:'TD',checkedAt:now-H},labelCreatedAt:now-3*24*H,dismissed:{at:now-H,by:'owner@example.invalid',carrierStatus:'in_transit'}});
  const alerts=load('lib/parcel-alerts.ts');
  const found=await alerts.parcelAlerts({DB},now);
  assert.deepEqual(found.map(a=>a.id.slice(0,1)+':'+a.kind).sort(),
    ['a:unscanned','b:unscanned','c:stuck','d:problem','i:unshipped','j:unshipped','k:unshipped','l:unshipped','o:unshipped','p:unscanned','q:unscanned','s:problem'],
    'fresh, moving, test and archived parcels stay out; recently paid and recovered checkouts stay quiet');
  const byId=Object.fromEntries(found.map(a=>[a.id.slice(0,1),a]));
  assert.equal(byId.p.unreadable,true,'three refusals is a provider problem');
  assert.equal(byId.q.unreadable,false,'two is not');
  assert.equal(byId.a.unreadable,false,'a parcel the carrier answers about is not flagged');
  assert(!found.some(a=>a.id.startsWith('r')),'a dismissed flag is out of the daily email');
  assert.equal(byId.s.kind,'problem','a dismissal that no longer matches the carrier is ignored');
  const unreadableText=alerts.parcelAlertText(found,now);
  assert.match(unreadableText,/#PPPPPPPP.*will not return tracking for it\. Open the shipment in EasyPost/,'the line sends the team to the label');
  assert.doesNotMatch(unreadableText,/#PPPPPPPP.*Find the box/,'and not to the post office');
  assert.match(unreadableText,/#AAAAAAAA.*never marked dropped off\. Find the box\./,'an ordinary unscanned parcel is unchanged');
  assert.equal(new Set(found.map(a=>a.id)).size,found.length,'an order is named once, under its most specific reason');
  const why=id=>found.find(a=>a.id.startsWith(id))?.why||'';
  assert.match(why('i'),/no postage bought yet/);
  assert.match(why('j'),/\$92\.40, above the automatic limit/);
  assert.match(why('k'),/on hold: out of stock/);
  assert.match(why('l'),/not yet scanned by the carrier/);
  assert.equal(found.find(a=>a.id.startsWith('a')).kind,'unscanned','a stale label keeps its own, more specific reason');
  const text=alerts.parcelAlertText(found,now);
  assert.match(text,/#AAAAAAAA.*never marked dropped off/); assert.match(text,/#BBBBBBBB.*marked dropped off/); assert.match(text,/Returning to sender/);
  assert.match(text,/Paid but not shipped after 48 hours:/);
  assert.match(text,/#JJJJJJJJ.*paid 3d ago, postage quoted at \$92\.40/);
  assert.match(text,/#IIIIIIII.*no postage bought yet/);
  assert(!/#MMMMMMMM|#NNNNNNNN/.test(text),'orders inside the window are never named');
  const sent=[];const fakeFetch=async(url,init)=>{sent.push({url,body:JSON.parse(init.body),key:init.headers['Idempotency-Key']});return new Response('{}',{status:200});};
  const mailEnv={DB,RESEND_API_KEY:'synthetic',ORDER_NOTIFY_EMAILS:'staff@example.invalid'};
  const early=new Date('2026-10-17T14:00:00Z').getTime();
  assert.equal((await alerts.runParcelAlerts(mailEnv,early,{fetch:fakeFetch})).reason,'too_early');
  const r1=await alerts.runParcelAlerts(mailEnv,now,{fetch:fakeFetch});
  assert.equal(r1.sent,true); assert.equal(r1.count,12); assert.equal(sent.length,1);
  assert.deepEqual(sent[0].body.to,['staff@example.invalid']); assert.equal(sent[0].body.subject,'12 parcels need a look'); assert.equal(sent[0].key,'parcel-alerts-2026-10-17');
  assert.equal((await alerts.runParcelAlerts(mailEnv,now+60000,{fetch:fakeFetch})).reason,'already_today','one digest a day'); assert.equal(sent.length,1);
  assert.equal((await alerts.runParcelAlerts({DB:{prepare(){throw Error('down');}}},now)).reason,'failed','a broken database never fails the schedule');
  console.log('PASS: owner-set insurance and signature thresholds (unset keeps today\'s behaviour), goods value, insurance on the buy, unscanned 24h, unreadable-at-the-provider and stuck 4-day staff flags hidden from customers, Dropped off handoff without status change or email, hand-marked delivery refused on tracked parcels, daily parcel alert once per day, dismissing a carrier flag (and only a carrier flag, and only while the carrier says the same thing), and the 48-hour reminder for a paid order that never reached the carrier. Synthetic only.');
})().catch(e=>{console.error(e);process.exit(1);});
