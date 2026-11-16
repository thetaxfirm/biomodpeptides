// Which labels are waiting to be printed, and in what order. The printable output itself moved to
// a zip of borderless 4x6 PDFs on Nov 16 2026; see tests/label-archive-v1.cjs.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),ts=require('typescript');
function load(file){const name=path.join(root,file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(root);
  m.require=id=>id.startsWith('./')||id.startsWith('@/')?load(id.replace(/^@\//,'').replace(/^\.\//,'lib/')+(id.endsWith('.ts')?'':'.ts')):require(id);
  m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,esModuleInterop:true}}).outputText,name);return m.exports;}
const L=load('lib/label-sheet.ts');

const ship=(extra={})=>({tracking:'9400100000000000000000',service:'USPS Priority Mail',labelUrl:'https://labels.example.invalid/a.png',...extra});
const order=(id,status,shipment,extra={})=>({id,status,created:extra.created||1760000000000,
  data:{address:{name:extra.name||'Dana Example',city:'Reno',state:'NV'},...(shipment?{shipment}:{}),...(extra.data||{})}});

// Only labels that exist, are https, and belong to an order still waiting to be handed over.
assert.equal(L.hasStandingLabel(order('a','paid',ship())),true);
assert.equal(L.hasStandingLabel(order('b','paid',null)),false,'no label bought yet');
assert.equal(L.hasStandingLabel(order('c','paid',ship({labelUrl:'http://insecure.invalid/a.png'}))),false,'plain http is rejected');
assert.equal(L.hasStandingLabel(order('d','paid',ship({labelUrl:12}))),false,'a non-string url is rejected');
assert.equal(L.hasStandingLabel(order('e','paid',ship({status:'in_transit'}))),false,'already moving, not waiting to print');
assert.equal(L.hasStandingLabel(order('f','delivered',ship())),false);
assert.equal(L.hasStandingLabel(order('g','paid',ship(),{data:{internalTest:true}})),false,'internal tests excluded');

assert.equal(L.hasStandingLabel(order('handed','paid',ship(),{data:{handoff:{at:Date.now()}}})),false,'already handed over is not a waiting label');
assert.equal(L.hasStandingLabel(order('archived','paid',ship(),{data:{archivedAt:1}})),false,'filed records excluded');
assert.equal(L.hasStandingLabel(order('verify','paid',ship(),{data:{paymentVerified:{at:1,state:'failed'}}})),false,'payment verification failure is a decision first');
// Oldest first, unqualified dropped.
const entries=L.labelEntries([order('11111111-1111-1111-1111-111111111111','paid',ship(),{created:300}),
  order('22222222-2222-2222-2222-222222222222','paid',null,{created:100}),
  order('33333333-3333-3333-3333-333333333333','paid',ship(),{created:200})]);
assert.deepEqual(entries.map(e=>e.number),['#33333333','#11111111']);
assert.equal(entries[0].tracking,'9400100000000000000000');

// Saved customer text is carried, never interpreted: the archive names files from this.
const nasty = L.labelEntries([order('dddddddd-1111-1111-1111-111111111111','paid',ship(),{name:'<img src=x onerror=alert(1)>'})]);
assert.equal(nasty[0].customer,'<img src=x onerror=alert(1)>','the entry reports what is saved, unchanged');
assert.equal(typeof nasty[0].labelUrl,'string');
// The HTML sheet is gone. Nothing here renders a page any more.
assert.equal(typeof L.renderLabelSheet,'undefined','the bordered print sheet was removed, not left behind');
const source = fs.readFileSync(path.join(root,'lib/label-sheet.ts'),'utf8');
assert(!/<img|<!doctype|page-break/i.test(source),'and no page markup is left in the module');

console.log('PASS: only bought, https, still-waiting labels qualify, oldest first, internal tests and filed records excluded; saved text is carried unchanged; the bordered HTML sheet is gone.');
