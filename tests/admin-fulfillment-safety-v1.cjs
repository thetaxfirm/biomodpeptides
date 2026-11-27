// Cross-layer regressions: real SQLite and source helpers, no network or live data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
global.fetch=async()=>{throw Error('Network forbidden');};
function loader(stubs={}) {const cache=new Map(); return function load(file){
 const name=path.resolve(root,file);if(cache.has(name))return cache.get(name).exports;
 const m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(root);cache.set(name,m);
 m.require=id=>{if(stubs[id])return stubs[id];if(id.startsWith('@/'))return load(id.slice(2)+(id.endsWith('.json')?'':'.ts'));if(id.startsWith('./')||id.startsWith('../')){const n=path.resolve(path.dirname(name),id);if(n.endsWith('.json'))return JSON.parse(fs.readFileSync(n));return load(n+'.ts');}return require(id);};
 m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,jsx:4,esModuleInterop:true}}).outputText,name);return m.exports;
};}
const raw=new DatabaseSync(':memory:');raw.exec('CREATE TABLE orders(id TEXT PRIMARY KEY,owner TEXT,status TEXT,total INTEGER,data TEXT,created INTEGER,updated INTEGER,checkout_ref TEXT);CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
let beforeWrite=null;
const db={prepare(sql){const make=(values=[])=>({bind:(...v)=>make(v),first:async()=>raw.prepare(sql).get(...values)||null,all:async()=>({results:raw.prepare(sql).all(...values)}),run:async()=>{if(beforeWrite){const fn=beforeWrite;beforeWrite=null;fn();}const r=raw.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}});return make();}};
const NOW=Date.parse('2026-11-27T20:00:00Z'),OLD=NOW-3600000;
const preorder={percentOff:15,ships:'early November 2026',basePrice:10000};
const base={environment:'authorizenet:live',email:'fixture@example.invalid',address:{name:'Fixture',city:'Reno',state:'NV'},items:[{quantity:1,product:{name:'Fixture product'}}]};
const add=(id,status='paid',extra={},created=OLD)=>raw.prepare('INSERT INTO orders(id,owner,status,total,data,created,updated,checkout_ref) VALUES(?,?,?,?,?,?,?,?)').run(id,'fixture-owner',status,10000,JSON.stringify({...base,...extra}),created,created,'fixture-checkout');
const get=id=>{const r=raw.prepare('SELECT * FROM orders WHERE id=?').get(id);return{...r,data:JSON.parse(r.data)};};
let bought=0,answered={state:'paid',providerReference:'1',transactions:[{transId:'1',transactionStatus:'settledSuccessfully',transactionType:'authCaptureTransaction',settleAmount:'100.00'}]};
const carrier={verifyShipAddress:async()=>({status:'verified',at:NOW}),readBoughtLabel:async()=>null,sendTrackingEmail:async()=>false,buyLabel:async(_e,_a,_i,_r,_s,_c,attempt)=>{bought++;await attempt?.onShipment?.('shp_fixture');return {carrier:'Fixture',service:'Fixture',tracking:'FIXTURE',labelUrl:'https://example.invalid/fixture.pdf',status:'pre_transit',costCents:100,shipmentId:'shp_fixture'};}};
const load=loader({'./easypost':carrier,'./change-history':{recordChange:async()=>{}},'./payments':{paymentEnvironment:()=> 'authorizenet:live',createPaymentAdapter:()=>({verifyPayment:async()=>{if(answered instanceof Error)throw answered;return answered;}})},'./telegram':{sendTelegramText:async()=>{throw Error('No notifications in manual verification');}}});
const policy=load('lib/fulfillment-eligibility.ts'), f=load('lib/fulfillment.ts'), q=load('lib/order-queue.ts'), queries=load('lib/order-queue-db.ts'),auto=load('lib/auto-label.ts'),verify=load('lib/payment-verify.ts'),release=load('lib/preorder-release.ts');
(async()=>{
 add('failed-payment','paid',{paymentVerified:{at:OLD,state:'failed'}});
 add('waiting-preorder','paid',{items:[{quantity:1,product:{name:'Fixture preorder',activePreorder:preorder}}]});
 let health=await auto.runAutoLabels({DB:db},NOW);assert.equal(health.bought,0);assert.equal(bought,0,'failed payment and waiting preorder cannot spend postage');
 for(const id of ['failed-payment','waiting-preorder']){assert(policy.fulfillmentBlock(get(id)));assert.equal(raw.prepare(policy.labelClaimSql).run(NOW,id,raw.prepare('SELECT data FROM orders WHERE id=?').get(id).data).changes,0,'atomic manual/automatic claim is refused');}
 const original=get('waiting-preorder'),version=await queries.orderDataVersion(JSON.stringify(original.data));
 await release.releasePreorder(db,{orderId:'waiting-preorder',expectedVersion:version,note:'Warehouse checked the exact ordered lot.'},'fixture-staff',NOW);
 assert.deepEqual(get('waiting-preorder').data.items,original.data.items,'purchase terms never rewritten');
 assert.equal(f.preorderAwaitingRelease(get('waiting-preorder').data),false);assert.equal(q.tabForOrder(get('waiting-preorder')),'to_ship');
 await assert.rejects(()=>release.releasePreorder(db,{orderId:'waiting-preorder',expectedVersion:version,note:'Warehouse confirmed again.'},'fixture-staff',NOW),/not waiting/);
 add('stale-release','paid',{items:original.data.items});
 const stale=await queries.orderDataVersion(raw.prepare('SELECT data FROM orders WHERE id=?').get('stale-release').data);
 raw.prepare("UPDATE orders SET data=json_set(data,'$.hold',json(?)) WHERE id=?").run('{"issue":"shipping"}','stale-release');
 await assert.rejects(()=>release.releasePreorder(db,{orderId:'stale-release',expectedVersion:stale,note:'Warehouse checked stock.'},'fixture-staff',NOW),/hold/);
 raw.prepare("UPDATE orders SET data=json_remove(data,'$.hold') WHERE id=?").run('stale-release');
 raw.prepare("UPDATE orders SET data=json_set(data,'$.address.city','Changed') WHERE id=?").run('stale-release');
 await assert.rejects(()=>release.releasePreorder(db,{orderId:'stale-release',expectedVersion:stale,note:'Warehouse checked stock.'},'fixture-staff',NOW),/changed/);
 health=await auto.runAutoLabels({DB:db},NOW+3600000);assert.equal(health.bought,1);assert.equal(bought,1,'release admits only the ready preorder');
 add('race-order');assert.equal(policy.fulfillmentBlock(get('race-order')),null);
 raw.prepare("UPDATE orders SET data=json_set(data,'$.paymentVerified',json(?)) WHERE id=?").run(JSON.stringify({at:NOW,state:'failed'}),'race-order');
 assert.equal(raw.prepare(policy.labelClaimSql).run(NOW,'race-order',raw.prepare('SELECT data FROM orders WHERE id=?').get('race-order').data).changes,0,'a failure arriving after UI read blocks the atomic claim');
 // Fresh provider evidence can repair a failed verdict without collecting money or changing paid status.
 await verify.recheckPaidOrder({DB:db},'failed-payment',NOW);assert.equal(get('failed-payment').data.paymentVerified.state,'settled');assert.equal(get('failed-payment').status,'paid');
 answered=Error('provider unavailable');const before=JSON.stringify(get('failed-payment').data);await assert.rejects(()=>verify.recheckPaidOrder({DB:db},'failed-payment',NOW+1),/unavailable/);assert.equal(JSON.stringify(get('failed-payment').data),before);
 answered={state:'failed',transactions:[]};await verify.recheckPaidOrder({DB:db},'failed-payment',NOW+2);assert.equal(get('failed-payment').data.paymentVerified.state,'failed');
 const paidBefore=get('failed-payment');answered={state:'paid',providerReference:'1',transactions:[]};beforeWrite=()=>raw.prepare("UPDATE orders SET data=json_set(data,'$.hold',json(?)) WHERE id=?").run('{"issue":"shipping"}','failed-payment');
 await assert.rejects(()=>verify.recheckPaidOrder({DB:db},'failed-payment',NOW+3),/changed/);assert.equal(get('failed-payment').data.paymentVerified.state,paidBefore.data.paymentVerified.state,'concurrent hold wins');
 // Current offers replace a demonstrably expired estimate, never a saved purchase snapshot.
 const sales=load('lib/sales.ts');assert.equal(sales.currentDispatchEstimate('early November 2026',NOW),'Awaiting confirmed dispatch date');assert.equal(sales.currentDispatchEstimate('December 2026',NOW),'December 2026');assert.equal(original.data.items[0].product.activePreorder.ships,'early November 2026');
 // UI and database queues agree on carrier, payment, hold, preorder, dismissal and archive states.
 raw.exec('DELETE FROM orders');
 const variants=[{}, {internalTest:true}, {hold:{issue:'out_of_stock'}},{hold:{issue:'shipping'}},{paymentVerified:{at:NOW,state:'failed'}},{items:[{product:{activePreorder:preorder}}]}, {items:[{product:{activePreorder:preorder}}],preorderRelease:{at:NOW,by:'staff',note:'Ready'}}, {shipment:{status:'pre_transit',labelUrl:'https://example.invalid/l.pdf'}}, {shipment:{status:'pre_transit',labelUrl:'https://example.invalid/l.pdf'},handoff:{at:NOW-2*86400000}}, {shipment:{status:'in_transit',checkedAt:NOW-5*86400000}}, {shipment:{status:'delivered'}},{shipment:{status:'failure'}},{shipment:{status:'failure'},dismissed:{at:NOW,carrierStatus:'failure'}},{archivedAt:NOW},{releasedReason:'unpaid_checkout_expired'}];
 let n=0;for(const status of ['paid','shipped','delivered','cancelled','failed','refunded','review','awaiting_payment','labeling'])for(const extra of variants)add('fixture-'+String(n++).padStart(6,'0'),status,extra,OLD+n);
 const classified=(await db.prepare(queries.orderQueueCte(NOW)+' SELECT id,bucket,work FROM queues').all()).results;
 for(const row of classified){const o=get(row.id);assert.equal(row.bucket,f.queueBucket(o,NOW),row.id+' bucket');assert.equal(row.work,q.tabForOrder(o,NOW),row.id+' work');}
 const all=raw.prepare('SELECT * FROM orders ORDER BY created DESC,id DESC').all().map(r=>({...r,data:JSON.parse(r.data)}));
 for(const tab of q.queueTabs){const page=await queries.queryOrderPage(db,{tab:tab.id},NOW),expected=q.queryOrders(all,{tab:tab.id},NOW);assert.equal(page.total,expected.total,tab.id);assert.deepEqual(page.counts,expected.counts,tab.id+' counts');}
 // Corrupt old JSON/line shapes cannot make every order queue unreadable.
 add('bad-line','paid',{items:['old-import',null,2]});
 add('bad-json');raw.prepare('UPDATE orders SET data=? WHERE id=?').run('{broken','bad-json');
 add('null-json');raw.prepare('UPDATE orders SET data=? WHERE id=?').run('null','null-json');
 assert.equal((await queries.queryOrderPage(db,{id:'bad-json'},NOW)).orders[0].data.items,undefined);
 assert.equal((await queries.queryOrderPage(db,{id:'null-json'},NOW)).orders[0].data.items,undefined);
 assert.equal((await queries.queryOrderPage(db,{tab:'all',q:'old-import'},NOW)).total,0);
 // Old work cannot fall off the 5,000-row boundary; newer work cannot be crowded out of print runs.
 raw.exec('DELETE FROM orders');add('old-unresolved','paid',{email:'oldest@example.invalid'},OLD-6000);
 raw.exec('BEGIN');for(let i=0;i<5101;i++)add('history-'+String(i).padStart(6,'0'),'shipped',{shipment:{status:'in_transit',checkedAt:NOW,labelUrl:'https://example.invalid/l.pdf'}},OLD+i);raw.exec('COMMIT');
 add('new-packable','paid',{shipment:{status:'pre_transit',labelUrl:'https://example.invalid/new.pdf'}},NOW);
 let page=await queries.queryOrderPage(db,{tab:'to_ship'},NOW);assert.equal(page.total,2);assert.equal(page.truncated,false);assert.equal(page.orders[0].id,'old-unresolved');
 page=await queries.queryOrderPage(db,{tab:'all',q:'oldest@example.invalid'},NOW);assert.equal(page.orders[0].id,'old-unresolved');
 page=await queries.queryOrderPage(db,{id:'old-unresolved'},NOW);assert.equal(page.orders[0].id,'old-unresolved');assert.equal(page.orders[0].version.length,64);
 assert.deepEqual((await queries.printableOrders(db,'labels')).orders.map(o=>o.id),['new-packable']);assert.equal((await queries.printableOrders(db,'pick')).total,2);
 // Dashboard counts and sales use complete DB aggregates, with explicit UTC day boundaries.
 raw.exec('ALTER TABLE orders ADD COLUMN payment_ref TEXT; ALTER TABLE orders ADD COLUMN notification_id TEXT');
 const DAY=86400000,midnight=Math.floor(NOW/DAY)*DAY;
 add('ancient-work','paid',{},NOW-45*DAY);
 const moving={shipment:{status:'in_transit',checkedAt:NOW}};
 add('week-edge','shipped',moving,midnight-7*DAY);add('week-outside','shipped',moving,midnight-7*DAY-1);
 add('month-edge','shipped',moving,midnight-30*DAY);add('month-outside','shipped',moving,midnight-30*DAY-1);
 add('sandbox-window','shipped',{...moving,environment:'authorizenet:sandbox'},midnight-1);
 add('unknown-window','shipped',{...moving,environment:null},midnight-1);
 raw.prepare("UPDATE orders SET payment_ref='fixture-payment',notification_id='fixture-notification'").run();
 add('missing-payment','shipped',moving,midnight-1);
 const overview=await load('lib/admin-overview-db.ts').readAdminOverviewOrderSummary(db,[],NOW);
 assert.equal(overview.toShip.count,3);assert.equal(overview.toShip.oldest,NOW-45*DAY);assert.equal(overview.toShip.labels,1);
 assert.equal(overview.sales[0].live.orders,5103);assert.equal(overview.sales[0].live.grossCents,51030000);
 assert.deepEqual(overview.sales[1].live,{orders:2,paymentRecorded:1,grossCents:10000,missingPaymentRecords:1});
 assert.deepEqual(overview.sales[2].live,{orders:4,paymentRecorded:3,grossCents:30000,missingPaymentRecords:1});
 assert.equal(overview.sales[1].sandbox.orders,1);assert.equal(overview.sales[1].unknown.orders,1);
 assert.deepEqual(overview.sales.map(w=>w.label),['Today (UTC, partial)','Last 7 complete days (UTC)','Last 30 complete days (UTC)']);
 // Operational evidence has an atomic, privacy-safe audit event, even when order status stays paid.
 raw.exec('CREATE TABLE change_context(id INTEGER PRIMARY KEY,actor TEXT,actor_type TEXT,source TEXT,action TEXT,summary TEXT); CREATE TABLE change_events(id TEXT,occurred_at INTEGER,recorded_at INTEGER,source TEXT,actor TEXT,actor_type TEXT,action TEXT,entity_type TEXT,entity_id TEXT,summary TEXT,status TEXT,changes TEXT)');
 raw.exec(fs.readFileSync(path.join(root,'drizzle/0041_order_operations_audit.sql'),'utf8'));
 raw.prepare('INSERT INTO change_context VALUES(1,?,?,?,?,NULL)').run('fixture-staff','staff','admin','admin-preorder-release');
 raw.prepare("UPDATE orders SET data=json_set(data,'$.preorderRelease',json(?)) WHERE id=?").run(JSON.stringify({at:NOW,by:'fixture-staff',note:'PRIVATE-NOTE-NOT-FOR-HISTORY'}),'ancient-work');
 const audit=raw.prepare('SELECT * FROM change_events').get();assert.equal(audit.actor,'fixture-staff');assert.equal(audit.action,'admin-preorder-release');assert.equal(audit.entity_id,'ancient-work');assert(!JSON.stringify(audit).includes('PRIVATE-NOTE'));assert.deepEqual(JSON.parse(audit.changes),[{field:'Preorder released at',before:null,after:NOW}]);
 raw.exec("CREATE TRIGGER refuse_audit BEFORE INSERT ON change_events BEGIN SELECT RAISE(ABORT,'fixture audit unavailable'); END");
 const beforeAuditFailure=raw.prepare('SELECT data FROM orders WHERE id=?').get('ancient-work').data;
 assert.throws(()=>raw.prepare("UPDATE orders SET data=json_set(data,'$.paymentVerified',json(?)) WHERE id=?").run(JSON.stringify({at:NOW,state:'failed'}),'ancient-work'),/audit unavailable/);
 assert.equal(raw.prepare('SELECT data FROM orders WHERE id=?').get('ancient-work').data,beforeAuditFailure,'a missing durable audit rolls back operational changes');
 console.log('PASS: failed verification and waiting preorder cannot buy postage; audited-ready metadata preserves purchase snapshots; fresh payment recheck is read-only and race-safe; SQL queues match all work states and find orders/printable labels beyond 5,000 records. No live providers.');
})().catch(e=>{console.error(e);process.exitCode=1;});
