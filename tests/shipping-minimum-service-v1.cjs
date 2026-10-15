// Store minimum service: upgrades a slower paid service at purchase time, never downgrades, never recharges.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),ts=require('typescript');
function load(file){const name=path.join(root,file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(root);
  m.require=id=>id.startsWith('./')||id.startsWith('@/')?load(id.replace(/^@\//,'').replace(/^\.\//,'lib/')+(id.endsWith('.ts')?'':'.ts')):require(id);
  m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,esModuleInterop:true}}).outputText,name);return m.exports;}
const o=load('lib/shipping-options.ts');

// The store floor is USPS Priority unless the owner says otherwise.
assert.equal(o.defaultMinimumServiceKey,'USPS:PRIORITY','the shipped default is USPS Priority Mail');
assert.equal(o.catalogService(o.defaultMinimumServiceKey).group,'expedited','the default outranks every standard service');
assert.equal(o.normalizeShippingOptions({}).minimumServiceKey,'USPS:PRIORITY','an unconfigured store still gets the floor');
assert.equal(o.normalizeShippingOptions({minimumServiceKey:'USPS:EXPRESS'}).minimumServiceKey,'USPS:EXPRESS','an owner choice is kept');
// Turning it off is explicit, and survives a round trip; junk falls back to the default rather than removing the floor.
assert.equal(o.normalizeShippingOptions({minimumServiceKey:o.noMinimumService}).minimumServiceKey,'none','opting out is stored verbatim');
assert.equal(o.normalizeShippingOptions({minimumServiceKey:'USPS:NOPE'}).minimumServiceKey,'USPS:PRIORITY','an unknown key falls back to the default');
assert.equal(o.normalizeShippingOptions({minimumServiceKey:42}).minimumServiceKey,'USPS:PRIORITY','a non-string key falls back to the default');
// Survives per-service mode too.
const perService=o.normalizeShippingOptions({services:[{key:'USPS:PRIORITY',enabled:true,markupCents:0,label:'USPS Priority Mail',note:''}]});
assert.equal(perService.minimumServiceKey,'USPS:PRIORITY');
assert.equal(o.normalizeShippingOptions({services:[{key:'USPS:PRIORITY',enabled:true,markupCents:0,label:'USPS Priority Mail',note:''}],minimumServiceKey:o.noMinimumService}).minimumServiceKey,'none');

// The floor resolves to its catalog row, and tiers rank slowest to fastest.
assert.equal(o.minimumService({minimumServiceKey:'USPS:PRIORITY'}).name,'USPS Priority Mail');
assert.equal(o.minimumService({}).name,'USPS Priority Mail','an unconfigured store falls to the default, not to nothing');
assert.equal(o.minimumService({minimumServiceKey:o.noMinimumService}),null,'only an explicit opt-out removes the floor');
assert.equal(o.minimumService({minimumServiceKey:'USPS:NOPE'}).name,'USPS Priority Mail','junk cannot silently remove the floor');
assert.ok(o.tierRank('overnight')>o.tierRank('expedited'));
assert.ok(o.tierRank('expedited')>o.tierRank('standard'));

// The decision buyLabel makes: upgrade only when the floor is strictly faster.
const upgrades=(paidKey,floorKey)=>{const paid=o.catalogService(paidKey),floor=o.catalogService(floorKey);return o.tierRank(floor.group)>o.tierRank(paid.group);};
assert.equal(upgrades('USPS:GROUNDADVANTAGE','USPS:PRIORITY'),true,'ground upgrades to priority');
assert.equal(upgrades('USPS:PRIORITY','USPS:PRIORITY'),false,'same tier is left alone');
assert.equal(upgrades('USPS:EXPRESS','USPS:PRIORITY'),false,'a faster paid service is never downgraded');
assert.equal(upgrades('UPS:GROUND','USPS:PRIORITY'),true,'applies across carriers');

// A saved customer charge is never rewritten by the floor.
const paidOption={id:'rate_fixture',tier:'standard',shippingService:'Free standard shipping · USPS Ground Advantage',shipping:0,carrierCents:705,handlingCents:0,days:5,carrier:'USPS',carrierService:'GroundAdvantage',source:'easypost',free:true};
const read=o.savedShippingOption(paidOption);
assert.equal(read.shipping,0,'the customer still pays what they paid');
assert.equal(read.tier,'standard');
// The default floor upgrades every standard service and leaves everything at or above it alone.
for(const row of o.shippingServiceCatalog){
  const wouldUpgrade=o.tierRank(o.catalogService(o.defaultMinimumServiceKey).group)>o.tierRank(row.group);
  assert.equal(wouldUpgrade,row.group==='standard',row.name+' is upgraded only when it is a standard service');
}
// --- The real buyLabel, with EasyPost stubbed: prove the upgrade actually changes which rate is bought. ---
const easypost=load('lib/easypost.ts');
const RATES=[
  {id:'rate_ground',carrier:'USPS',service:'GroundAdvantage',rate:'7.05',currency:'USD',delivery_days:4,mode:'production'},
  {id:'rate_priority',carrier:'USPS',service:'Priority',rate:'11.40',currency:'USD',delivery_days:2,mode:'production'},
  {id:'rate_express',carrier:'USPS',service:'Express',rate:'34.95',currency:'USD',delivery_days:1,mode:'production'},
  {id:'rate_upsground',carrier:'UPS',service:'Ground',rate:'9.80',currency:'USD',delivery_days:4,mode:'production'},
];
const env={EASYPOST_API_KEY:'synthetic-fixture-key-only'};
const to={name:'Fixture Recipient',street1:'1 Test St',city:'Las Vegas',state:'NV',zip:'89118',country:'US'};
const items=[{quantity:1,product:{categories:[{slug:'research-compounds'}]}}];
let bought=null;
const realFetch=global.fetch;
let created=[];
global.fetch=async(url,init)=>{
  const body=init.body?JSON.parse(init.body):null;
  if(url==='https://api.easypost.com/v2/shipments'){created.push(body.shipment);return Response.json({id:'shp_fixture',mode:'production',rates:RATES});}
  if(url==='https://api.easypost.com/v2/shipments/shp_fixture/buy'){bought=body.rate.id;return Response.json({id:'shp_fixture',tracking_code:'SYNTHETIC',postage_label:{label_url:'https://example.invalid/label'},tracker:{public_url:'https://example.invalid/tracking'}});}
  throw Error('Unexpected external request prohibited: '+url);
};
const buy=async(selected,settings)=>{bought=null;const label=await easypost.buyLabel(env,to,items,'fixture',selected,settings);return {bought,label};};
const easypostOption=(carrier,carrierService,tier)=>({carrier,carrierService,tier,source:'easypost'});
(async()=>{
  const withFloor=o.normalizeShippingOptions({});
  // The customer paid for the cheapest standard service; the store hands the carrier Priority instead.
  let r=await buy(easypostOption('USPS','GroundAdvantage','standard'),withFloor);
  assert.equal(r.bought,'rate_priority','a Ground selection buys a Priority label');
  assert.equal(r.label.service,'USPS Priority','the recorded service is what was actually bought');
  assert.equal(r.label.costCents,1140,'the store pays the Priority rate');
  // Across carriers: a UPS Ground selection is still floored to USPS Priority.
  r=await buy(easypostOption('UPS','Ground','standard'),withFloor);
  assert.equal(r.bought,'rate_priority','the floor applies even when the paid carrier is not USPS');
  // At or above the floor, nothing is touched.
  r=await buy(easypostOption('USPS','Priority','expedited'),withFloor);
  assert.equal(r.bought,'rate_priority','a Priority selection is left alone');
  r=await buy(easypostOption('USPS','Express','overnight'),withFloor);
  assert.equal(r.bought,'rate_express','a faster paid service is never downgraded');
  // Free standard shipping resolves to the cheapest standard rate, which is exactly the case the floor exists for.
  r=await buy({shippingService:'Free standard shipping'},withFloor);
  assert.equal(r.bought,'rate_priority','free standard shipping still goes out Priority');
  // Opting out restores the old behavior exactly.
  const noFloor=o.normalizeShippingOptions({minimumServiceKey:o.noMinimumService});
  r=await buy(easypostOption('USPS','GroundAdvantage','standard'),noFloor);
  assert.equal(r.bought,'rate_ground','with the floor off, the paid service is bought unchanged');
  r=await buy({shippingService:'Free standard shipping'},noFloor);
  assert.equal(r.bought,'rate_ground','free standard shipping is unchanged with the floor off');
  // A floor the carrier does not offer for this address must not block the purchase.
  const fedexFloor=o.normalizeShippingOptions({minimumServiceKey:o.serviceKey('FedEx','FIRST_OVERNIGHT')});
  assert.ok(o.minimumService(fedexFloor),'the fixture floor is a real catalog service');
  r=await buy(easypostOption('USPS','GroundAdvantage','standard'),fedexFloor);
  assert.equal(r.bought,'rate_ground','an unavailable floor leaves the paid service alone rather than failing');
  // --- Delivery confirmation: on the label, never on a customer quote. ---
  assert.equal(o.signatureConfirmation({}),'SIGNATURE','signature is required unless the store says otherwise');
  assert.equal(o.normalizeShippingOptions({}).signatureConfirmation,'SIGNATURE','an unconfigured store still asks for one');
  assert.equal(o.signatureConfirmation({signatureConfirmation:'ADULT_SIGNATURE'}),'ADULT_SIGNATURE','an owner choice is kept');
  assert.equal(o.signatureConfirmation({signatureConfirmation:o.noSignature}),null,'only an explicit opt-out turns it off');
  assert.equal(o.signatureConfirmation({signatureConfirmation:'WHATEVER'}),'SIGNATURE','junk cannot quietly drop the signature');
  assert.equal(o.normalizeShippingOptions({signatureConfirmation:o.noSignature}).signatureConfirmation,'none','opting out is stored verbatim');

  created=[]; r=await buy(easypostOption('USPS','GroundAdvantage','standard'),withFloor);
  assert.deepEqual(created.at(-1).options,{delivery_confirmation:'SIGNATURE'},'every label asks the carrier for a signature');
  created=[]; await buy(easypostOption('USPS','Priority','expedited'),o.normalizeShippingOptions({signatureConfirmation:'ADULT_SIGNATURE'}));
  assert.deepEqual(created.at(-1).options,{delivery_confirmation:'ADULT_SIGNATURE'});
  created=[]; await buy(easypostOption('USPS','Priority','expedited'),o.normalizeShippingOptions({signatureConfirmation:o.noSignature}));
  assert.equal(created.at(-1).options,undefined,'with it off, nothing extra is asked of the carrier');
  // Quoting must stay clean, or the customer would be charged for the store's choice.
  created=[]; await easypost.carrierShippingOptions(env,to,items,withFloor);
  assert.equal(created.at(-1).options,undefined,'a checkout quote never carries delivery confirmation');
  created=[]; await easypost.liveShippingCheck(env,to,items,withFloor);
  assert.equal(created.at(-1).options,undefined,'nor does the admin price check');

  global.fetch=realFetch;
  console.log('PASS: USPS Priority default floor, explicit opt-out, junk falls back rather than removing the floor, catalog resolution, tier ranking, upgrade-only decision across carriers, saved charge untouched; signature required on every label and never on a quote; buyLabel upgrades Ground/free-standard to Priority across carriers, never downgrades, respects the opt-out, and tolerates an unavailable floor. No live providers.');
})().catch(e=>{console.error(e);process.exitCode=1});
