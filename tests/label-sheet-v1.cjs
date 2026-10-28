// Batch label sheet: which labels qualify, their order, and that nothing is fabricated or injected.
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

const html=L.renderLabelSheet(entries,1760000000000);
assert(html.includes('Labels to print · 2 orders'));
assert((html.match(/class="sheet"/g)||[]).length===2,'one page per label');
assert(html.includes('referrerpolicy="no-referrer"'),'label images do not leak the admin url');
assert(html.includes('Printing does not mark anything shipped'));
assert(html.includes('noindex'));
// Nothing waiting reads as a sheet, not a crash.
assert(L.renderLabelSheet([],1).includes('No bought labels are waiting'));
// Saved names are escaped.
const nasty=L.renderLabelSheet(L.labelEntries([order('dddddddd-1111-1111-1111-111111111111','paid',ship(),{name:'<img src=x onerror=alert(1)>'})]),1);
assert(!nasty.includes('<img src=x onerror=alert(1)>')&&nasty.includes('&lt;img'),'markup in saved data is escaped');
console.log('PASS: label eligibility incl. https-only, moving and test orders, oldest-first, one page per label, no-referrer, empty sheet, markup escaped.');
