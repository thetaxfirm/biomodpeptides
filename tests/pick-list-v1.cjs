// Printable pick sheets: which orders qualify, how lines merge, and that the sheet leaks no contact details.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),ts=require('typescript');
function load(file){const name=path.join(root,file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(root);
  m.require=id=>id.startsWith('./')||id.startsWith('@/')?load(id.replace(/^@\//,'').replace(/^\.\//,'lib/')+(id.endsWith('.ts')?'':'.ts')):require(id);
  m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,esModuleInterop:true}}).outputText,name);return m.exports;}
const p=load('lib/pick-list.ts');

const order=(id,status,extra={})=>({id,status,created:extra.created||1760000000000,data:{
  address:{name:extra.name||'Dana Example',city:'Reno',state:'NV',line1:'900 Example Ave',zip:'89501'},
  email:'dana@example.invalid',phone:'7755550000',
  items:extra.items||[{id:1,quantity:2,lineTotal:9000,product:{name:'AZURE 10 mg',price:4500}}],
  ...(extra.data||{})}});

// Everything still to be packed, and nothing else.
assert.equal(p.needsPicking(order('a','paid')),true,'paid and waiting');
assert.equal(p.needsPicking(order('b','paid',{data:{shipment:{tracking:'X'}}})),true,'labelled but not handed over still needs picking');
assert.equal(p.canPick(order('b','paid',{data:{shipment:{tracking:'X'}}})),true,'a single labelled order prints on the same terms');
assert.equal(p.needsPicking(order('b2','paid',{data:{shipment:{tracking:'X',status:'in_transit'}}})),false,'already moving is done');
assert.equal(p.needsPicking(order('c','pending')),false,'unpaid is never picked');
assert.equal(p.needsPicking(order('d','delivered')),false);
assert.equal(p.needsPicking(order('e','paid',{data:{hold:{issue:'stock',by:'x',at:1}}})),false,'a hold stops picking');
assert.equal(p.needsPicking(order('f','paid',{data:{internalTest:true}})),false,'internal tests are excluded');

// Oldest first, and only qualifying orders.
const entries=p.pickEntries([order('11111111-1111-1111-1111-111111111111','paid',{created:300}),order('22222222-2222-2222-2222-222222222222','pending',{created:100}),order('33333333-3333-3333-3333-333333333333','paid',{created:200})]);
assert.deepEqual(entries.map(e=>e.number),['#33333333','#11111111'],'unpaid dropped, oldest first');
assert.equal(entries[0].units,2);

// A bought label is flagged on the sheet, so the picker knows that parcel is ready to go.
const labelled=p.pickEntry(order('ffffffff-1111-1111-1111-111111111111','paid',{data:{shipment:{tracking:'X',labelUrl:'https://labels.example.invalid/a.png'}}}));
assert.equal(labelled.labelled,true);
assert(p.renderPickList([labelled],1,true).includes('label bought'));
assert.equal(p.pickEntry(order('99999999-1111-1111-1111-111111111111','paid')).labelled,false);

// Merging: one row per product, quantities added, distinct notes kept beside it.
const merged=p.mergeLines([
  {name:'AZURE 10 mg',detail:'Lot A-1',quantity:2},
  {name:'AZURE 10 mg',detail:'Lot A-2',quantity:3},
  {name:'AZURE 10 mg',detail:'Lot A-1',quantity:1},
  {name:'FORGE 5 mg',detail:'',quantity:1}]);
assert.deepEqual(merged.map(l=>[l.name,l.quantity]),[['AZURE 10 mg',6],['FORGE 5 mg',1]],'one row per product, quantities summed');
assert.equal(merged[0].detail,'Lot A-1 · Lot A-2','distinct notes kept once each');
assert.equal(merged[1].detail,'');

// The same product on two saved lines of one order prints once.
const twice=p.pickEntry(order('eeeeeeee-1111-1111-1111-111111111111','paid',{items:[
  {id:1,quantity:2,lineTotal:1,product:{name:'AZURE 10 mg'}},
  {id:2,quantity:3,lineTotal:1,product:{name:'AZURE 10 mg'}},
  {id:3,quantity:1,lineTotal:1,product:{name:'FORGE 5 mg'}}]}));
assert.equal(twice.units,6,'the unit count still counts every unit');
const sheet=p.renderPickList([twice],1,true);
assert.equal((sheet.match(/>AZURE 10 mg</g)||[]).length,1,'printed once');
assert(sheet.includes('>5<'),'with the combined quantity');

// The same product across orders combines into one pull line.
const totals=p.pickTotals(p.pickEntries([
  order('aaaaaaaa-1111-1111-1111-111111111111','paid',{items:[{id:1,quantity:2,lineTotal:1,product:{name:'AZURE 10 mg'}},{id:2,quantity:1,lineTotal:1,product:{name:'FORGE 5 mg'}}]}),
  order('bbbbbbbb-1111-1111-1111-111111111111','paid',{items:[{id:1,quantity:3,lineTotal:1,product:{name:'AZURE 10 mg'}}]}),
]));
assert.deepEqual(totals.map(t=>[t.name,t.quantity]),[['AZURE 10 mg',5],['FORGE 5 mg',1]],'combined and sorted by name');

// Zero-quantity lines never reach the sheet.
assert.deepEqual(p.pickEntry(order('cccccccc-1111-1111-1111-111111111111','paid',{items:[{id:1,quantity:0,lineTotal:0,product:{name:'Nothing'}}]})).lines,[]);

// The sheet shows what to pull, and withholds what a picker has no need for.
const html=p.renderPickList(entries,1760000000000);
assert(html.includes('Pull from stock'));
assert(html.includes('#33333333')&&html.includes('#11111111'));
assert(html.includes('Dana Example')&&html.includes('Reno, NV'));
assert(!html.includes('dana@example.invalid'),'no customer email on a warehouse sheet');
assert(!html.includes('7755550000'),'no customer phone');
assert(!html.includes('900 Example Ave'),'no street address; the label carries it');
assert(html.includes('noindex'));
// A single-order sheet drops the combined pull block.
const one=p.renderPickList([entries[0]],1760000000000,true);
assert(one.includes('Pick list #33333333')&&!one.includes('Pull from stock'));
// Nothing waiting is a readable sheet, not a crash.
assert(p.renderPickList([],1760000000000).includes('Nothing is waiting'));
// Order names are escaped, never injected.
const nasty=p.renderPickList(p.pickEntries([order('dddddddd-1111-1111-1111-111111111111','paid',{name:'<script>alert(1)</script>'})]),1);
assert(!nasty.includes('<script>alert(1)</script>')&&nasty.includes('&lt;script&gt;'),'markup in saved data is escaped');
console.log('PASS: picking covers to-ship and label-bought, excludes moving/held/test, oldest-first queue, one row per product with quantities summed and notes kept, combined pull totals, single-order sheet, empty sheet, contact details withheld, markup escaped.');
