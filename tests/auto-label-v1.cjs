// Automatic label purchase and the recovery that makes it safe unattended: the grace period, the
// daily cap, the hold/test/unlabelled gates, and above all that a lost outcome is adopted, never
// repeated. Isolated SQLite; EasyPost is a stub and is never called live.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),ts=require('typescript');

// --- A stubbed EasyPost that records every call, so "did we buy twice" is directly observable. ---
let shipments=new Map(),created=0,buys=0,nextRate={id:'rate_priority',carrier:'USPS',service:'Priority',rate:'11.40',currency:'USD',delivery_days:2,mode:'production'};
let failBuy=null,failCreate=null,emails=[],attempts=[],verifyResult='verified',verifies=0;
const makeShipment=id=>({id,mode:'production',rates:[nextRate],tracking_code:null,postage_label:null,selected_rate:null});
function easypostStub(){
  return {
    ShippingError:class ShippingError extends Error{},
    verifyShipAddress:async(_e,_a,now)=>{verifies++;return{status:verifyResult,at:now};},
    sendTrackingEmail:async(_e,to,orderId,_label,_name,replyTo)=>{emails.push({to,orderId,replyTo});return Boolean(replyTo);},
    readBoughtLabel:async(_e,id)=>{const s=shipments.get(id);return s&&s.selected_rate?label(s):null;},
    buyLabel:async(_env,_to,_items,_ref,_selected,_settings,attempt={})=>{
      attempts.push(attempt);
      let s;
      if(attempt.resumeShipmentId){
        s=shipments.get(attempt.resumeShipmentId);
        if(!s)throw Error('unknown shipment');
        if(s.selected_rate)return label(s); // already bought: adopt, never buy again
      } else {
        if(failCreate)throw Error('create failed');
        created++; s=makeShipment('shp_'+created); shipments.set(s.id,s);
        if(attempt.onShipment)await attempt.onShipment(s.id);
      }
      if(failBuy){const mode=failBuy;failBuy=null;
        if(mode==='charged'){ // the real danger: EasyPost charged, we never heard the answer
          buys++; s.selected_rate=nextRate; s.tracking_code='TRK'+buys; s.postage_label={label_url:'https://example.invalid/l'+buys};
        }
        throw Error('carrier timeout');}
      // The real buyLabel refuses a rate above the caller's ceiling before any money moves, and says
      // so with a code and the quoted price so the caller can ask a person instead of retrying.
      const cents=Math.round(Number(nextRate.rate)*100);
      if(typeof attempt.maxCents==='number'&&cents>attempt.maxCents){
        const refusal=Error('above the automatic limit');refusal.code='label_above_limit';refusal.cents=cents;throw refusal;}
      buys++; s.selected_rate=nextRate; s.tracking_code='TRK'+buys; s.postage_label={label_url:'https://example.invalid/l'+buys};
      return label(s);
    },
  };
}
const label=s=>({shipmentId:s.id,carrier:'USPS',service:'USPS Priority',costCents:Math.round(Number(s.selected_rate.rate)*100),tracking:s.tracking_code,trackingUrl:'https://example.invalid/t',labelUrl:s.postage_label.label_url,status:'pre_transit'});

function load(file){const name=path.join(root,file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(root);
  m.require=id=>{
    if(id==='./easypost')return easypostStub();
    if(id.startsWith('./')||id.startsWith('@/'))return load(id.replace(/^@\//,'').replace(/^\.\//,'lib/')+(id.endsWith('.ts')?'':'.ts'));
    return require(id);};
  m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,esModuleInterop:true}}).outputText,name);return m.exports;}
const auto=load('lib/auto-label.ts');

function database(){const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT,data TEXT,created INTEGER,updated INTEGER)');
  db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
  return {raw:db,prepare(sql){return{
    bind(...v){return{
      async all(){return{results:db.prepare(sql).all(...v)};},
      async run(){const r=db.prepare(sql).run(...v);return{meta:{changes:Number(r.changes)}};},
      async first(){return db.prepare(sql).get(...v)||null;}};},
    async first(){return db.prepare(sql).get()||null;}};}};}
const NOW=1760000000000, OLD=NOW-3600000;
const order=(db,id,status,data,updated=OLD)=>db.raw.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,status,JSON.stringify(data),updated,updated);
const store=(db,value)=>db.raw.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('store',JSON.stringify(value));
const read=(db,id)=>{const r=db.raw.prepare('SELECT status,data FROM orders WHERE id=?').get(id);return{status:r.status,data:JSON.parse(r.data)};};
const payable=(extra={})=>({address:{name:'Fixture Recipient',line1:'1 Test St',city:'Las Vegas',state:'NV',zip:'89118'},items:[{quantity:1,product:{categories:[{slug:'research-compounds'}]}}],email:'fixture@example.invalid',shippingService:'Free standard shipping',...extra});
const reset=()=>{verifyResult='verified';verifies=0;shipments=new Map();created=0;buys=0;failBuy=null;failCreate=null;emails=[];attempts=[];nextRate={id:'rate_priority',carrier:'USPS',service:'Priority',rate:'11.40',currency:'USD',delivery_days:2,mode:'production'};};
const health=db=>{const r=db.raw.prepare("SELECT value FROM settings WHERE key='auto_label_health_v1'").get();return r?JSON.parse(r.value):null;};

(async()=>{
  // --- Settings bounds ---
  assert.deepEqual(auto.autoLabelSettings(null),{enabled:true,delayMs:20*60000,dailyCapCents:50000,perRunLimit:10,stuckMs:5*60000,maxLabelCents:7500,maxAttempts:3},'agreed defaults: 20 minutes, $500/day, $75 a label, 3 tries');
  assert.equal(auto.autoLabelSettings({maxLabelCents:2500}).maxLabelCents,2500,'the per-label ceiling is configurable');
  assert.equal(auto.autoLabelSettings({maxLabelCents:0}).maxLabelCents,7500,'a ceiling of zero would buy nothing, so it falls back');
  assert.equal(auto.autoLabelSettings({maxLabelCents:9999999}).maxLabelCents,7500,'an out-of-range ceiling falls back');
  assert.equal(auto.autoLabelSettings({maxAttempts:1}).maxAttempts,1,'one try is allowed');
  assert.equal(auto.autoLabelSettings({maxAttempts:0}).maxAttempts,3,'zero tries would stall every order, so it falls back');
  assert.equal(auto.autoLabelSettings({maxAttempts:500}).maxAttempts,3,'an out-of-range retry count falls back');
  assert.equal(auto.autoLabelSettings({enabled:false}).enabled,false,'the kill switch is honoured');
  assert.equal(auto.autoLabelSettings(null,{AUTO_LABEL_ENABLED:'false'}).enabled,false,'and can be thrown from the environment');
  assert.equal(auto.autoLabelSettings({delayMinutes:99999}).delayMs,20*60000,'an out-of-range delay falls back');
  assert.equal(auto.autoLabelSettings({dailyCapCents:-5}).dailyCapCents,50000,'a negative cap falls back');
  assert.equal(auto.autoLabelSettings({perRunLimit:500}).perRunLimit,10,'the per-run limit is bounded');
  assert.equal(auto.autoLabelSettings({dailyCapCents:0}).dailyCapCents,0,'zero is a real cap, not a missing one');

  // --- The grace period ---
  reset(); let db=database();
  order(db,'fresh','paid',payable(),NOW-60000);          // paid a minute ago
  order(db,'ready','paid',payable(),NOW-3600000);         // untouched for an hour
  let h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.due,1,'only the order past its grace period is due');
  assert.equal(h.bought,1); assert.equal(read(db,'ready').status,'paid');
  assert.equal(read(db,'ready').data.shipment.tracking,'TRK1');
  assert.equal(read(db,'ready').data.labelAuto,true,'an automatic purchase is marked as one');
  assert.equal(read(db,'fresh').data.shipment,undefined,'the fresh order is untouched');
  assert.equal(emails.length,1,'the customer is told the parcel exists');
  assert.equal(emails[0].replyTo,'','no reply address configured, so no tracking email is sent');
  // With one configured, it travels with the email — the mailer refuses to send without it.
  reset(); db=database();
  db.raw.prepare('INSERT INTO settings VALUES(?,?)').run('coa_delivery_v1',JSON.stringify({enabled:true,replyTo:'contact@example.invalid',notifyTo:null}));
  order(db,'mailed','paid',payable());
  await auto.runAutoLabels({DB:db},NOW);
  assert.equal(emails.at(-1).replyTo,'contact@example.invalid','the configured reply address is passed through');

  // --- What must never be bought automatically ---
  reset(); db=database();
  order(db,'held','paid',payable({hold:{issue:'out_of_stock'}}));
  order(db,'test','paid',payable({internalTest:true}));
  order(db,'labelled','paid',payable({shipment:{tracking:'EXISTING'}}));
  order(db,'unpaid','awaiting_payment',payable());
  order(db,'noaddress','paid',{items:[],email:'x@example.invalid'});
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.due,1,'only the addressless paid order is even selected'); // hold/test/labelled/unpaid filtered in SQL
  assert.equal(h.bought,0); assert.equal(h.skipped,1,'and it is skipped rather than attempted');
  assert.equal(buys,0,'nothing was bought');
  assert.equal(read(db,'held').status,'paid'); assert.equal(read(db,'test').data.shipment,undefined);

  // --- A saved shipping option that no longer validates is a human decision ---
  reset(); db=database();
  order(db,'bad','paid',payable({shippingOption:{tier:'standard',source:'easypost',shipping:'not-a-number'}}));
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.skipped,1); assert.equal(buys,0,'an unreadable saved option is never guessed at');
  assert.equal(read(db,'bad').status,'paid','and the order is left workable');

  // --- The daily cap ---
  reset(); db=database();
  store(db,{autoLabel:{dailyCapCents:1000}});            // $10: the first $11.40 label exhausts it
  for(const id of ['a','b','c']) order(db,id,'paid',payable());
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.bought,1,'buying stops once the cap is reached');
  assert.equal(h.capReached,true); assert.equal(h.spentCents,1140);
  assert.equal(buys,1,'the cap is enforced before the purchase, not after');
  // Spend is counted from automatic labels inside the last 24 hours only.
  reset(); db=database();
  store(db,{autoLabel:{dailyCapCents:2000}});
  order(db,'yesterday','paid',{...payable(),shipment:{costCents:5000},labelAuto:true,labelCreatedAt:NOW-2*86400000});
  order(db,'today','paid',payable());
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.spentCents,1140,'spend older than a day does not count against today');
  assert.equal(h.bought,1);
  // A label the owner bought by hand never blocks the job.
  reset(); db=database();
  store(db,{autoLabel:{dailyCapCents:2000}});
  order(db,'manual','paid',{...payable(),shipment:{costCents:9000},labelCreatedAt:NOW-1000});
  order(db,'next','paid',payable());
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.spentCents,1140,'a manual purchase is not counted against the automatic cap');
  assert.equal(h.bought,1);

  // --- The kill switch stops buying but never stops recovery ---
  reset(); db=database();
  store(db,{autoLabel:{enabled:false}});
  order(db,'waiting','paid',payable());
  shipments.set('shp_sold',{...makeShipment('shp_sold'),selected_rate:nextRate,tracking_code:'TRKSOLD',postage_label:{label_url:'https://example.invalid/sold'}});
  order(db,'stranded','labeling',{...payable(),pendingShipmentId:'shp_sold'},NOW-600000);
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.enabled,false); assert.equal(h.bought,0); assert.equal(h.due,0,'nothing is bought while switched off');
  assert.equal(h.recovered,1,'but a sold label is still rescued');
  assert.equal(read(db,'stranded').status,'paid');
  assert.equal(read(db,'stranded').data.shipment.tracking,'TRKSOLD');
  assert.equal(read(db,'stranded').data.labelAuto,undefined,'a recovered manual purchase is not relabelled automatic');
  assert.equal(read(db,'stranded').data.pendingShipmentId,undefined,'the resolved attempt is cleared');

  // --- THE CENTRAL GUARANTEE: a charge we never heard about is adopted, not repeated ---
  reset(); db=database();
  order(db,'lost','paid',payable());
  failBuy='charged';                                     // EasyPost takes the money, we time out
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.failed,1); assert.equal(buys,1,'the carrier charged once');
  assert.equal(read(db,'lost').status,'paid','the claim is released');
  assert.equal(read(db,'lost').data.pendingShipmentId,'shp_1','and the attempt is remembered');
  // A moment later nothing is touched: the request could still be in flight.
  h=await auto.runAutoLabels({DB:db},NOW+60000);
  assert.equal(h.recovered,0,'a recent attempt is left alone');
  // Once it is certainly over, recovery adopts the label that was already paid for.
  h=await auto.runAutoLabels({DB:db},NOW+600000);
  assert.equal(buys,1,'no second label was ever bought');
  assert.equal(created,1,'and no second shipment was created');
  assert.equal(h.recovered,1); assert.equal(h.bought,0,'it was adopted, not re-bought');
  assert.equal(read(db,'lost').data.shipment.tracking,'TRK1','the order carries the label that was actually paid for');
  assert.equal(read(db,'lost').data.labelAuto,true,'a recovered automatic purchase still counts against the cap');
  assert.equal(read(db,'lost').data.pendingShipmentId,undefined);
  assert.equal(read(db,'lost').data.pendingAuto,undefined);

  // --- A stranded claim with no purchase is released, not abandoned ---
  reset(); db=database();
  order(db,'empty','labeling',payable(),NOW-600000);
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.released,1); assert.equal(read(db,'empty').status,'paid','the order is workable again');
  // A claim younger than the stuck threshold is left alone: a request may still be in flight.
  reset(); db=database();
  order(db,'inflight','labeling',payable(),NOW-30000);
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.released,0); assert.equal(read(db,'inflight').status,'labeling','a live request is never interrupted');

  // --- A hold written while the purchase was in flight survives the save ---
  reset(); db=database();
  order(db,'racing','paid',payable());
  const realPrepare=db.prepare.bind(db);
  let injected=false;
  db.prepare=sql=>{const st=realPrepare(sql);
    if(!injected&&sql.includes('json_set(data,\'$.pendingShipmentId\'')){const bind=st.bind.bind(st);
      st.bind=(...v)=>{const b=bind(...v);const run=b.run.bind(b);b.run=async()=>{const r=await run();
        injected=true; // a colleague puts the order on hold mid-purchase
        db.raw.prepare("UPDATE orders SET data=json_set(data,'$.hold',json(?)) WHERE id='racing'").run(JSON.stringify({issue:'out_of_stock'}));
        return r;};return b;};}
    return st;};
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.bought,1);
  assert.deepEqual(read(db,'racing').data.hold,{issue:'out_of_stock'},'the hold placed mid-purchase is not erased');
  assert.equal(read(db,'racing').data.shipment.tracking,'TRK1','and the bought label is still recorded');
  db.prepare=realPrepare;

  // --- One bad order never stops the rest of the run ---
  reset(); db=database();
  order(db,'first','paid',payable());
  order(db,'second','paid',payable());
  failBuy='plain';
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.failed,1); assert.equal(h.bought,1,'the second order still shipped');

  // --- The per-run limit bounds one tick ---
  reset(); db=database();
  store(db,{autoLabel:{perRunLimit:2}});
  for(let i=0;i<6;i++) order(db,'bulk'+i,'paid',payable());
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.due,2); assert.equal(h.bought,2,'a single run cannot run away');

  // --- Settings we could not read are not permission to spend money ---
  reset(); db=database();
  order(db,'unread','paid',payable());
  let realPrepare2=db.prepare;
  db.prepare=sql=>{ if(sql.includes("key='store'")) return {async first(){throw Error('database unavailable');}}; return realPrepare2(sql); };
  h=await auto.runAutoLabels({DB:db},NOW);
  db.prepare=realPrepare2;
  assert.equal(h.bought,0,'an unreadable settings row stands the job down rather than using defaults');
  assert.equal(h.enabled,false);
  assert.equal(read(db,'unread').status,'paid','and the order is left exactly as it was');
  assert.equal(health(db).status,'settings_unreadable','and the reason is recorded where the admin can see it');

  // --- The per-label ceiling: above it, the order waits for a person rather than being retried ---
  reset(); db=database();
  store(db,{autoLabel:{maxLabelCents:1000}});
  order(db,'pricey','paid',payable());
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(attempts[0].maxCents,1000,'the ceiling is handed to the purchase, not merely stored');
  assert.equal(h.bought,0); assert.equal(buys,0,'nothing was charged');
  assert.equal(h.needsApproval,1,'it is reported as waiting for approval');
  assert.equal(h.failed,0,'a price is not a failure');
  assert.equal(read(db,'pricey').status,'paid','and the claim is handed back');
  assert.equal(read(db,'pricey').data.labelAttempts,undefined,'a price never burns a retry');
  assert.deepEqual(read(db,'pricey').data.labelApproval,{cents:1140,limitCents:1000,at:NOW},'what it would cost is recorded for the admin');
  assert.equal(read(db,'pricey').data.hold,undefined,'not a hold: buying it by hand must stay available');
  // Retrying would quote the same price, so the order is simply left alone.
  db.raw.prepare("UPDATE orders SET updated=? WHERE id='pricey'").run(OLD);
  h=await auto.runAutoLabels({DB:db},NOW+600000);
  assert.equal(h.due,0,'an order waiting for approval is out of the automatic queue');
  assert.equal(buys,0); assert.equal(h.needsApproval,0,'and it is not re-reported every five minutes');
  // Raise the limit past the quoted price and it becomes due again, with no extra step.
  store(db,{autoLabel:{maxLabelCents:5000}});
  h=await auto.runAutoLabels({DB:db},NOW+600000);
  assert.equal(h.due,1); assert.equal(h.bought,1,'a raised limit releases it automatically');
  assert.equal(read(db,'pricey').data.labelApproval,undefined,'and the marker is cleared with the purchase');
  // A label bought by hand clears it the same way (the save path is shared).
  reset(); db=database();
  order(db,'approved','paid',payable({labelApproval:{cents:9000,limitCents:7500,at:NOW}}));
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.due,0,'still waiting while the quote is above the ceiling');
  // The same order under the agreed $75 ceiling goes through.
  reset(); db=database();
  order(db,'normal','paid',payable());
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(attempts[0].maxCents,7500); assert.equal(h.bought,1,'an ordinary label is unaffected by the ceiling');

  // --- An order the carrier keeps refusing stops being retried and asks for a person ---
  reset(); db=database();
  store(db,{autoLabel:{maxAttempts:2}});
  order(db,'bad','paid',payable());
  failBuy='plain'; h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.failed,1); assert.equal(h.blocked,0,'one failure is not a verdict');
  assert.equal(read(db,'bad').data.labelAttempts,1);
  assert.equal(read(db,'bad').data.hold,undefined,'and the order stays in the queue');
  db.raw.prepare("UPDATE orders SET updated=? WHERE id='bad'").run(OLD);
  failBuy='plain'; h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.blocked,1,'the second failure hands it to a person');
  assert.equal(read(db,'bad').data.hold.issue,'website');
  assert.match(read(db,'bad').data.hold.note,/failed 2 times/);
  assert.equal(read(db,'bad').status,'paid','held, not stranded in labeling');
  // A held order is no longer due, so nothing retries it in silence.
  db.raw.prepare("UPDATE orders SET updated=? WHERE id='bad'").run(OLD);
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.due,0,'the hold takes it out of the automatic queue');
  assert.equal(buys,0);

  // --- A successful attempt clears the count, so an unrelated failure never accumulates ---
  reset(); db=database();
  order(db,'recovered','paid',payable({labelAttempts:2}));
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.bought,1);
  assert.equal(read(db,'recovered').data.labelAttempts,undefined,'the attempt count is cleared with the purchase');

  // --- Health is readable after an ordinary run ---
  reset(); db=database();
  order(db,'reported','paid',payable());
  h=await auto.runAutoLabels({DB:db},NOW);
  let reported=await auto.readAutoLabelHealth({DB:db});
  assert.equal(reported.status,'completed'); assert.equal(reported.bought,1); assert.equal(reported.enabled,true);
  assert.equal(reported.checkedAt,NOW,'the admin can see when the job last ran');
  // And a disabled job still says so, rather than looking like a job that never ran.
  reset(); db=database(); store(db,{autoLabel:{enabled:false}});
  await auto.runAutoLabels({DB:db},NOW);
  assert.equal((await auto.readAutoLabelHealth({DB:db})).status,'disabled');
  assert.equal(await auto.readAutoLabelHealth({DB:{prepare(){throw Error('gone');}}}),null,'an unreadable report is not an outage');

  // --- Address gate (owner, Oct 31 2026): a USPS-flagged address waits for a person ---
  reset(); db=database();
  order(db,'unit','paid',payable({addressCheck:{status:'unit_missing',at:OLD,confirmed:true}}));
  order(db,'clean','paid',payable({addressCheck:{status:'verified',at:OLD}}));
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.addressHeld,1,'the flagged order is held');
  assert.equal(h.bought,1,'the verified order still ships');
  assert.equal(verifies,0,'an order checked at checkout is not asked again');
  let unit=read(db,'unit');
  assert.equal(unit.status,'paid'); assert.equal(unit.data.shipment,undefined,'no label for a flagged address');
  assert.equal(unit.data.hold.issue,'shipping');
  assert.match(unit.data.hold.note,/apartment or unit number/);
  assert.match(unit.data.hold.note,/customer confirmed/i);
  assert.equal(unit.data.addressHeldAt,NOW);
  // Once a person clears the hold, the job ships it and never re-holds it.
  db.raw.prepare("UPDATE orders SET data=json_remove(data,'$.hold'),updated=? WHERE id='unit'").run(OLD);
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.addressHeld,0); assert.equal(h.bought,1,'cleared by a person: the label is bought');
  assert(read(db,'unit').data.shipment,'label saved after review');

  // An order paid before checkout checked addresses is checked at label time.
  reset(); db=database(); verifyResult='unit_missing';
  order(db,'legacy','paid',payable());
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(verifies,1); assert.equal(h.addressHeld,1); assert.equal(buys,0);
  assert.equal(read(db,'legacy').data.addressCheck.status,'unit_missing','the result is kept on the order for staff');
  reset(); db=database();
  order(db,'legacy-ok','paid',payable());
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.bought,1); assert.equal(read(db,'legacy-ok').data.addressCheck.status,'verified');
  // A check that cannot run never stops shipping: an outage is not a bad address.
  reset(); db=database(); verifyResult='unavailable';
  order(db,'outage','paid',payable({addressCheck:{status:'unavailable',at:OLD}}));
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(verifies,1,'an unavailable checkout check is retried'); assert.equal(h.bought,1); assert.equal(h.addressHeld,0);
  // A retry that now finds a problem holds it.
  reset(); db=database(); verifyResult='not_found';
  order(db,'retry','paid',payable({addressCheck:{status:'unavailable',at:OLD}}));
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.addressHeld,1); assert.equal(buys,0);
  // An address hold never overwrites a hold someone already placed.
  reset(); db=database(); verifyResult='verified';
  order(db,'already','paid',payable({hold:{issue:'out_of_stock',note:'restock',by:'Staff',at:OLD},addressCheck:{status:'unit_missing',at:OLD}}));
  h=await auto.runAutoLabels({DB:db},NOW);
  assert.equal(h.due,0,'a held order is not due'); assert.equal(read(db,'already').data.hold.issue,'out_of_stock');

  console.log('PASS: address gate holds USPS-flagged and customer-confirmed addresses once, re-checks older orders, never blocks on an outage.');
  console.log('PASS: grace period, hold/test/labelled/unpaid/addressless gates, unreadable saved option skipped, daily cap counted from automatic labels in the last 24h only, kill switch stops buying but not recovery, a charged-but-lost attempt is adopted rather than repeated, stranded claims released, live requests untouched, a concurrent hold survives, one failure isolated, per-run limit honoured, unreadable settings stand the job down, the per-label ceiling sends an expensive label to a person instead of retrying it, repeated failures hand the order to a person, health is reported. No live providers.');
})().catch(e=>{console.error(e);process.exitCode=1});
