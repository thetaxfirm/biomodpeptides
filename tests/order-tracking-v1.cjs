// A tracking number entered by hand: the sweep keeps following it, and the order says plainly which
// number is being followed (owner, Nov 20 2026). Isolated SQLite; the carrier is a stub, never live.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');

let shipmentReads=[],trackerReads=[],shipmentAnswer=()=>'in_transit',trackerAnswer=()=>({status:'delivered'});
function load(file,extra={}){const name=path.join(root,file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(root);
  m.require=id=>{
    if(id in extra)return extra[id];
    if(id==='react'||id==='react/jsx-runtime')return require(id);
    if(id==='sonner')return{toast:{success(){},error(){}}};
    if(id.endsWith('.module.css'))return{__esModule:true,default:new Proxy({},{get:(_,k)=>String(k)})};
    if(id==='./easypost'||id==='@/lib/easypost')return{readShipmentTracking:async(_e,shipmentId,tracking)=>{shipmentReads.push({shipmentId,tracking});return shipmentAnswer(tracking);}};
    if(id==='./easypost-tracker'||id==='@/lib/easypost-tracker')return{readTrackingCode:async(_e,code)=>{trackerReads.push(code);return trackerAnswer(code);}};
    if(id.endsWith('.json'))return require(path.join(root,id.replace(/^@\//,'').replace(/^\.\//,'lib/')));
    if(id.startsWith('./')||id.startsWith('@/'))return load(id.replace(/^@\//,'').replace(/^\.\//,'lib/')+(id.endsWith('.ts')||id.endsWith('.tsx')?'':'.ts'));
    return require(id);};
  m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,jsx:4,esModuleInterop:true}}).outputText,name);return m.exports;}
const sweep=load('lib/tracking-sweep.ts');

function database(){const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT,data TEXT,created INTEGER,updated INTEGER)');
  return {raw:db,prepare(sql){return{bind(...v){return{
    async all(){return{results:db.prepare(sql).all(...v)};},
    async run(){const r=db.prepare(sql).run(...v);return{meta:{changes:Number(r.changes)}};}};}};}};}
const NOW=1760000000000,OLD=NOW-10*3600000;
const add=(db,id,status,data,created=OLD)=>db.raw.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,status,JSON.stringify(data),created,created);
const read=(db,id)=>{const r=db.raw.prepare('SELECT status,data FROM orders WHERE id=?').get(id);return{status:r.status,data:JSON.parse(r.data)};};

(async()=>{
 // --- The sweep follows a parcel this store never bought a label for. ---
 // Before this, DUE required shipment.shipmentId, so a number typed in by hand was read once when
 // it was entered and then never asked about again: delivered parcels sat in Needs attention.
 {
  shipmentReads=[];trackerReads=[];
  const db=database();
  add(db,'bought','paid',{shipment:{shipmentId:'shp_fixture',tracking:'BOUGHTCODE',status:'pre_transit'}});
  add(db,'byhand','paid',{shipment:{tracking:'BYHANDCODE1',status:'pre_transit'}});
  shipmentAnswer=()=>'in_transit';trackerAnswer=()=>({status:'delivered'});
  const health=await sweep.runTrackingSweep({DB:db},NOW);
  assert.equal(health.due,2,'a parcel with only a tracking number is now due');
  assert.deepEqual(trackerReads,['BYHANDCODE1'],'the bare code is read through the tracker, not the shipment helper');
  assert.deepEqual(shipmentReads.map(r=>r.shipmentId),['shp_fixture'],'a bought label still reads through its shipment');
  assert.equal(read(db,'byhand').status,'delivered','the carrier moved the hand-entered parcel to delivered');
  assert.equal(read(db,'byhand').data.shipment.status,'delivered');
  assert.equal(read(db,'byhand').data.shipment.tracking,'BYHANDCODE1','the write never disturbs the number it was keyed on');
  assert.equal(read(db,'bought').status,'shipped');
 }
 // The write is keyed on the tracking number, so it lands on that parcel and no other.
 {
  shipmentReads=[];trackerReads=[];
  const db=database();
  add(db,'one','paid',{shipment:{tracking:'FIRSTCODE11',status:'pre_transit'}});
  add(db,'two','paid',{shipment:{tracking:'SECONDCODE2',status:'pre_transit'}});
  trackerAnswer=code=>({status:code==='FIRSTCODE11'?'delivered':'pre_transit'});
  await sweep.runTrackingSweep({DB:db},NOW);
  assert.equal(read(db,'one').status,'delivered');
  assert.equal(read(db,'two').status,'paid','an unchanged parcel is left exactly as it was');
  assert.equal(read(db,'two').data.shipment.status,'pre_transit');
 }
 // A number the carrier refuses still backs off rather than holding a slot on every run.
 {
  shipmentReads=[];trackerReads=[];
  const db=database();
  add(db,'bad','paid',{shipment:{tracking:'REFUSEDCODE',status:'pre_transit'}});
  trackerAnswer=()=>{throw Error('carrier unreachable')};
  const health=await sweep.runTrackingSweep({DB:db},NOW);
  assert.equal(health.failed,1);
  assert.equal(read(db,'bad').status,'paid','a refused read changes nothing about the order');
  assert.equal(read(db,'bad').data.shipment.readFails,1,'consecutive refusals are counted');
  assert.equal(read(db,'bad').data.shipment.sweptAt,NOW,'and it still backs off');
 }
 // An order with no tracking at all is not a parcel to chase.
 {
  shipmentReads=[];trackerReads=[];
  const db=database();
  add(db,'none','paid',{});
  trackerAnswer=()=>({status:'delivered'});
  const health=await sweep.runTrackingSweep({DB:db},NOW);
  assert.equal(health.due,0,'no tracking number, nothing to ask about');
  assert.deepEqual(trackerReads,[]);
 }

 // --- The order says which number it is following. ---
 const {OrderTracking}=load('components/store/order-tracking.tsx');
 const render=(order,permit=()=>true)=>renderToStaticMarkup(React.createElement(OrderTracking,{order,allowed:permit,busy:false,onDone(){}}));
 const order={id:'0a1b2c3d-0000-4000-8000-000000000000',status:'delivered',data:{
   previousShipment:{tracking:'OLDCODE1234',status:'failure',service:'USPS Priority'},
   shipment:{tracking:'NEWCODE5678',status:'delivered',service:'USPS Priority',reshipAt:NOW,reshipBy:'owner@example.invalid'}}};
 const html=render(order);
 const lines=html.split('<li').slice(1);
 assert.equal(lines.length,2,'both numbers are carried on the order');
 assert(/OLDCODE1234/.test(lines[0])&&/NEWCODE5678/.test(lines[1]),'the superseded number is listed first, the live one under it');
 assert(/data-live="false"/.test(lines[0])&&/No longer tracked/.test(lines[0]),'the dead number is marked out of use in words, not only by colour');
 assert(/data-live="true"/.test(lines[1])&&/Tracked: the carrier is checked on this number/.test(lines[1]),'the live number says it is the one being followed');
 assert(/Delivery failed/.test(lines[0]),'the superseded parcel keeps the carrier verdict it ended on');
 assert(/Delivered/.test(lines[1]));
 // Nothing is invented when an order has never carried a number.
 const empty=render({id:'0a1b2c3d-0000-4000-8000-000000000001',status:'paid',data:{}});
 assert(/No tracking number is recorded on this order yet/.test(empty));
 assert(!/<li/.test(empty),'an order with no parcel lists none');
 assert(/Check and record this number/.test(empty),'a paid order can still have one entered');
 // The slot is fulfilment work, and only for an order that has a parcel to replace.
 assert(!/Check and record this number/.test(render(order,()=>false)),'hidden without orders:fulfill');
 assert(!/Check and record this number/.test(render({id:'0a1b2c3d-0000-4000-8000-000000000002',status:'review',data:{}})),'an unpaid order has no parcel to replace');
 // It never offers to set a status by hand: the carrier decides, which is the whole point.
 assert(!/<select/.test(html),'no status is offered for a person to choose');
 assert(/carrier is asked about the number before anything is saved/.test(empty));

 // The admin order view is a whitelist, so the superseded parcel has to be on it. Without this the
 // panel is handed only the live shipment and the red line can never render, however many parcels
 // the order has actually carried (owner, Nov 22 2026).
 const {adminOrderView}=load('lib/catalog-visibility.ts');
 const viewed=adminOrderView({items:[],address:{},shipment:{tracking:'NEW',status:'delivered'},previousShipment:{tracking:'OLD',status:'failure'},paidAt:1760000000000});
 assert.equal(viewed.previousShipment&&viewed.previousShipment.tracking,'OLD','the superseded parcel reaches the order panel');
 assert.equal(viewed.paidAt,1760000000000,'when payment landed reaches the admin');
 assert.equal(adminOrderView({items:[],address:{},shipment:{tracking:'NEW'}}).previousShipment,undefined,'an order that never had a replacement carries none');

 // Wiring: the panel carries it, above the manual confirmation form.
 const ui=fs.readFileSync(path.join(root,'components/store/orders-admin.tsx'),'utf8');
 assert.match(ui,/<OrderTracking order=\{selected\} allowed=\{allowed\} busy=\{busy\} onDone=\{reload\}\/>/);
 assert(ui.indexOf('<OrderTracking')<ui.indexOf('Manual confirmation'),'the carrier-checked slot sits above the hand-written one');
 const route=fs.readFileSync(path.join(root,'app/api/admin/order-reship/route.ts'),'utf8');
 assert.match(route,/requireStaff\('orders:fulfill'\)/,'recording a replacement is fulfilment work');
 assert(!/sendMail|customerMail|buyLabel/i.test(route),'recording a number buys nothing and emails nobody');

 console.log('PASS: the sweep follows a hand-entered tracking number through the carrier tracker, keys its write on that number, backs off on refusal and ignores orders with no parcel; the order lists the superseded and live numbers with their state said in words; the slot is fulfilment-gated, paid-only, and offers no hand-chosen status.');
})().catch(e=>{console.error(e);process.exitCode=1});
