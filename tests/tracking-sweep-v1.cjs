// Carrier tracking fail-safe: which parcels get re-read, what transition is applied, and that one
// unreachable carrier never stops the rest. Isolated SQLite; the provider is a stub, never called live.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),ts=require('typescript');
let reads=[],answer=()=>{throw Error('carrier unreachable')};
function load(file){const name=path.join(root,file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(root);
  m.require=id=>{
    if(id==='./easypost')return{readShipmentTracking:async(_e,shipmentId,tracking)=>{reads.push({shipmentId,tracking});return answer(shipmentId);}};
    if(id.startsWith('./')||id.startsWith('@/'))return load(id.replace(/^@\//,'').replace(/^\.\//,'lib/')+(id.endsWith('.ts')?'':'.ts'));
    return require(id);};
  m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,esModuleInterop:true}}).outputText,name);return m.exports;}
const sweep=load('lib/tracking-sweep.ts');

// A tiny D1-shaped wrapper over isolated in-memory SQLite. No file, no network, no real order.
function database(){const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT,data TEXT,created INTEGER,updated INTEGER)');
  return {raw:db,prepare(sql){return{bind(...v){return{
    async all(){return{results:db.prepare(sql).all(...v)};},
    async run(){const r=db.prepare(sql).run(...v);return{meta:{changes:Number(r.changes)}};}};}};}};}
const NOW=1760000000000, OLD=NOW-10*3600000;
const add=(db,id,status,data,created=OLD)=>db.raw.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,status,JSON.stringify(data),created,created);
const ship=(extra={})=>({shipment:{shipmentId:'shp_'+Math.random().toString(36).slice(2,8),tracking:'TRK'+Math.random().toString(36).slice(2,8),status:'pre_transit',...extra}});
const read=(db,id)=>{const r=db.raw.prepare('SELECT status,data FROM orders WHERE id=?').get(id);return{status:r.status,data:JSON.parse(r.data)};};

(async()=>{
  // Settings come from the environment, with sane bounds.
  assert.deepEqual(sweep.sweepSettings({}),{staleMs:180*60000,limit:15},'defaults');
  assert.equal(sweep.sweepSettings({TRACKING_RECHECK_MINUTES:'30'}).staleMs,30*60000,'minutes read from a string env var');
  assert.equal(sweep.sweepSettings({TRACKING_RECHECK_MINUTES:'1'}).staleMs,180*60000,'below the floor falls back');
  assert.equal(sweep.sweepSettings({TRACKING_RECHECK_LIMIT:'500'}).limit,15,'above the ceiling falls back');

  // A parcel the carrier has started moving marks the order shipped.
  let db=database();
  add(db,'a','paid',ship());
  answer=()=>'in_transit';
  let health=await sweep.runTrackingSweep({DB:db},NOW);
  assert.equal(health.due,1); assert.equal(health.changed,1); assert.equal(health.failed,0);
  assert.equal(read(db,'a').status,'shipped','paid becomes shipped once it is moving');
  assert.equal(read(db,'a').data.shipment.status,'in_transit');
  assert.equal(read(db,'a').data.shipment.checkedAt,NOW);

  // Delivery closes it, from either paid or shipped.
  db=database(); add(db,'b','shipped',ship({status:'in_transit'})); add(db,'c','paid',ship({status:'in_transit'}));
  answer=()=>'delivered';
  await sweep.runTrackingSweep({DB:db},NOW);
  assert.equal(read(db,'b').status,'delivered');
  assert.equal(read(db,'c').status,'delivered','a forgotten order still settles');

  // Nothing is asked about when it was checked recently, is already settled, or is an internal test.
  db=database();
  add(db,'recent','paid',{...ship(),shipment:{...ship().shipment,checkedAt:NOW-60000}});
  add(db,'done','shipped',ship({status:'delivered'}));
  add(db,'returned','shipped',ship({status:'return_to_sender'}));
  add(db,'test','paid',{...ship(),internalTest:true});
  add(db,'nolabel','paid',{});
  reads=[]; answer=()=>'in_transit';
  health=await sweep.runTrackingSweep({DB:db},NOW);
  assert.equal(health.due,0,'nothing is due'); assert.equal(reads.length,0,'the carrier is not called at all');

  // One unreachable parcel does not stop the others.
  db=database(); add(db,'x','paid',ship()); add(db,'y','paid',ship());
  let calls=0; answer=()=>{calls++; if(calls===1)throw Error('carrier timeout'); return 'in_transit';};
  health=await sweep.runTrackingSweep({DB:db},NOW);
  assert.equal(health.failed,1); assert.equal(health.read,1); assert.equal(health.changed,1,'the reachable one still moved');

  // An unchanged status costs no write.
  db=database(); add(db,'same','paid',ship({status:'pre_transit'}));
  answer=()=>'pre_transit';
  health=await sweep.runTrackingSweep({DB:db},NOW);
  assert.equal(health.read,1); assert.equal(health.changed,0,'no write when the carrier says nothing new');
  assert.equal(read(db,'same').status,'paid','pre_transit is not dispatch');

  // A newer observation already stored is never overwritten by an older sweep.
  db=database(); add(db,'newer','paid',ship({checkedAt:NOW+60000}));
  answer=()=>'in_transit';
  health=await sweep.runTrackingSweep({DB:db},NOW);
  assert.equal(read(db,'newer').status,'paid','the stored newer observation wins');
  assert.equal(health.changed,0);

  // The batch is capped so one run cannot run away.
  db=database(); for(let i=0;i<20;i++) add(db,'bulk'+i,'paid',ship());
  reads=[]; answer=()=>'in_transit';
  health=await sweep.runTrackingSweep({DB:db,TRACKING_RECHECK_LIMIT:'5'},NOW);
  assert.equal(health.due,5); assert.equal(reads.length,5,'only the capped number of carrier reads');

    console.log('PASS: due selection by staleness, paid->shipped and ->delivered transitions, settled/recent/test/unlabelled skipped, carrier failure isolated, no-op when unchanged, newer observation preserved, batch capped.');
})().catch(e=>{console.error(e);process.exitCode=1});
