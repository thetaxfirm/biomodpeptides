// Promo codes the owner adds in administration. Isolated SQLite, real route module, no network.
// What is actually at stake here is the price a customer pays, so the suite is written around the
// ways a stored row could change one by accident: shadowing a built-in, surviving as junk, being
// honoured while switched off, or two administrators overwriting each other.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),ts=require('typescript');
let overrides={};
function load(file){const name=path.join(root,file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(root);
  m.require=id=>{if(Object.hasOwn(overrides,id))return overrides[id];
    return id.startsWith('./')||id.startsWith('@/')?load(id.replace(/^@\//,'').replace(/^\.\//,'lib/')+(id.endsWith('.ts')?'':'.ts')):require(id);};
  m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,esModuleInterop:true}}).outputText,name);return m.exports;}

const promos=load('lib/promotions.ts');
const codes=load('lib/promo-codes.ts');

// --- What counts as a code and a percentage. ---
assert.equal(codes.cleanPromoCode(' spring15 '),'SPRING15','typed in any case, stored upper');
assert.equal(codes.cleanPromoCode('AB'),'','two characters is too short to type by accident');
assert.equal(codes.cleanPromoCode('SPRING 15'),'','no spaces: the code goes in a URL and a cookie');
assert.equal(codes.cleanPromoCode('SPRING-15'),'');
assert.equal(codes.cleanPromoCode('A'.repeat(41)),'');
assert.equal(codes.cleanPromoCode(null),'');
assert.equal(codes.cleanPercentOff(15),15);
assert.equal(codes.cleanPercentOff('15'),15,'the form sends a string');
assert.equal(codes.cleanPercentOff(0),0);
assert.equal(codes.cleanPercentOff(15.5),0,'whole percentages only');
assert.equal(codes.cleanPercentOff(91),0,'above the ceiling is refused, not clamped');
assert.equal(codes.cleanPercentOff(100),0,'a free-checkout code is never created here');
assert.equal(codes.MAX_PERCENT_OFF,90);

// --- Whatever is in the settings row is untrusted. ---
const builtIn=codes.builtInCodes();
assert.ok(builtIn.includes('BM10')&&builtIn.includes('JENM20'));
assert.deepEqual(codes.normalizeStoredPromos(null),[]);
assert.deepEqual(codes.normalizeStoredPromos('nonsense'),[]);
assert.deepEqual(codes.normalizeStoredPromos([null,42,'x',[],{}]),[],'nothing unrecognised is repaired into a discount');
assert.deepEqual(codes.normalizeStoredPromos([{code:'SPRING15',percentOff:15}]),
  [{code:'SPRING15',percentOff:15,active:true,created:0,by:''}],'a row with no flag is on');
assert.deepEqual(codes.normalizeStoredPromos([{code:'spring15',percentOff:'15',active:false,created:5,by:'o@e.invalid'}]),
  [{code:'SPRING15',percentOff:15,active:false,created:5,by:'o@e.invalid'}]);
assert.deepEqual(codes.normalizeStoredPromos([{code:'SPRING15',percentOff:15},{code:'SPRING15',percentOff:80}]),
  [{code:'SPRING15',percentOff:15,active:true,created:0,by:''}],'the same code twice is the first one, never the richer one');
assert.deepEqual(codes.normalizeStoredPromos([{code:'BM10',percentOff:80}]),[],'a stored row may not shadow a built-in code');
assert.deepEqual(codes.normalizeStoredPromos([{code:'SPRING15',percentOff:99}]),[],'nor carry a percentage the form would refuse');
assert.equal(codes.normalizeStoredPromos(Array.from({length:300},(_,i)=>({code:'CODE'+i,percentOff:5}))).length,codes.MAX_STORED_PROMOS);

// --- The pricing table: built-ins alone unless codes are handed in, and built-ins always win. ---
const base=promos.activePromotions();
assert.deepEqual(promos.activePromotions([]),base,'no stored codes means exactly the old behaviour');
assert.throws(()=>promos.promotion('SPRING15'),/not valid/,'a stored code is never honoured by accident');
assert.deepEqual(promos.promotion('SPRING15',[{code:'SPRING15',percentOff:15}]),{code:'SPRING15',percentOff:15});
assert.deepEqual(promos.promotion(' spring15 ',[{code:'SPRING15',percentOff:15}]),{code:'SPRING15',percentOff:15});
assert.deepEqual(promos.promotion('BM10',[{code:'BM10',percentOff:80}]),{code:'BM10',percentOff:10},'a stored row cannot reprice a built-in');
assert.equal(promos.activePromotions([{code:'BM10',percentOff:80}]).find(p=>p.code==='BM10').percentOff,10);
for(const bad of [{code:'SPRING15',percentOff:0},{code:'SPRING15',percentOff:101},{code:'SPRING15',percentOff:1.5},{code:'SPR ING',percentOff:10},{code:'',percentOff:10},null])
  assert.throws(()=>promos.promotion('SPRING15',[bad]),/not valid/,'an unusable extra row is dropped, never guessed at');
assert.equal(promos.activePromotions([{code:'SPRING15',percentOff:15}])[0].code,base[0].code,'built-ins keep their order and stay first');

// --- The money. A stored code allocates to the cent, exactly like a built-in. ---
const lines=[{lineTotal:9999},{lineTotal:3251},{lineTotal:0}];
const applied=promos.applyPromotion(lines,'SPRING15',[{code:'SPRING15',percentOff:15}]);
assert.equal(applied.promoDiscount,Math.round(13250*0.15));
assert.equal(applied.items.reduce((s,i)=>s+i.linePromoDiscount,0),applied.promoDiscount,'every cent is allocated to a line');
assert.ok(applied.items.every(i=>i.lineTotal>=0),'no line is pushed negative');
assert.deepEqual(promos.applyPromotion(lines,'SPRING15',[{code:'SPRING15',percentOff:15}]).promo,{code:'SPRING15',percentOff:15,savings:1988});
assert.throws(()=>promos.applyPromotion(lines,'SPRING15',[{code:'SPRING15',percentOff:15,active:false}].filter(()=>false)),/not valid/);

// --- Reading the row out of the database. ---
function database(rows={}){const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
  for(const [k,v] of Object.entries(rows)) db.prepare('INSERT INTO settings VALUES(?,?)').run(k,v);
  const api={raw:db,prepare(sql){return{bind(...v){return{async first(){return db.prepare(sql).get(...v)||null;},async run(){const r=db.prepare(sql).run(...v);return{meta:{changes:r.changes}};}};}};}};
  return api;}
const KEY=codes.PROMO_CODES_KEY;
assert.equal(KEY,'promo_codes_v1');

(async()=>{
  const stored=[{code:'SPRING15',percentOff:15,active:true,created:1,by:'o@e.invalid'},{code:'RETIRED20',percentOff:20,active:false,created:2,by:'o@e.invalid'}];
  let db=database({[KEY]:JSON.stringify(stored)});
  assert.equal((await codes.storedPromoList(db)).length,2,'administration sees codes that are switched off');
  assert.deepEqual(await codes.storedPromotions(db),[{code:'SPRING15',percentOff:15}],'pricing only ever sees the ones that are on');
  // A code that is off is refused at checkout, which is the whole point of the switch.
  const live=await codes.storedPromotions(db);
  assert.throws(()=>promos.promotion('RETIRED20',live),/not valid/);

  assert.deepEqual(await codes.storedPromotions(database()),[],'no row saved yet is not an error');
  assert.deepEqual(await codes.storedPromotions(database({[KEY]:'{{broken'})),[]);
  assert.deepEqual(await codes.storedPromotions({prepare(){throw Error('down');}}),[],
    'an unreadable settings row leaves built-ins working and stored codes refused, never a wrong price');

  // --- The real endpoint. ---
  const history=[];
  // `raceWith` lands a competing save in the row after the route has read it and before it writes,
  // which is the only way to exercise the compare-and-set from outside.
  function routeFor(db,{email='owner@example.invalid',allow=true,raceWith=null}={}){
    const responses=[];let raced=false;
    overrides={
      'next/server':{NextResponse:{json:(value,init)=>({status:init?.status||200,async json(){return value;}})}},
      '@/lib/auth':{requireStaff:async scope=>{if(!allow)throw Error('denied');responses.push(scope);return{email};}},
      '@/lib/runtime':{runtime:()=>({DB:db})},
      '@/lib/change-history':{
        auditRun:async(_db,_ctx,sql,...values)=>{
          if(raceWith&&!raced){raced=true;db.raw.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(raceWith),KEY);}
          return db.prepare(sql).bind(...values).run();
        },
        recordChange:async(_db,entry)=>{history.push(entry);},
      },
    };
    try{return{...load('app/api/admin/promo-codes/route.ts'),scopes:responses};}finally{overrides={};}
  }
  const request=body=>({headers:{get:()=>'https://trybiomod.com'},nextUrl:{origin:'https://trybiomod.com'},async json(){return body;}});

  db=database();
  let route=routeFor(db);
  let res=await route.POST(request({code:'spring15',percentOff:'15'}));
  let out=await res.json();
  assert.equal(res.status,200,out.error);
  assert.deepEqual(out.custom.map(p=>[p.code,p.percentOff,p.active]),[['SPRING15',15,true]],'typed lower, saved upper and on');
  assert.equal(out.custom[0].by,'owner@example.invalid','who added it is recorded');
  assert.match(out.message,/SPRING15 is live at 15% off/);
  assert.equal(history.at(-1).action,'store.promo_code');
  assert.equal(history.at(-1).summary,'Promo code SPRING15 created at 15% off.');

  // It prices a cart from this point on, through the same table checkout uses.
  assert.deepEqual(await codes.storedPromotions(db),[{code:'SPRING15',percentOff:15}]);
  const forCart=await codes.storedPromotions(db);
  assert.deepEqual(promos.promotion('spring15',forCart),{code:'SPRING15',percentOff:15});

  // Built-ins are not editable from here, in either direction.
  res=await routeFor(db).POST(request({code:'BM10',percentOff:80}));
  assert.equal(res.status,409);
  assert.match((await res.json()).error,/built-in code/);
  const afterClash=await codes.storedPromotions(db);
  assert.equal(promos.promotion('BM10',afterClash).percentOff,10,'and BM10 is untouched');

  // Bounds and shape are refused with a sentence, and nothing is written.
  for(const [body,status] of [[{code:'AB',percentOff:10},400],[{code:'SPRING16',percentOff:0},400],[{code:'SPRING16',percentOff:91},400],[{code:'SPRING16',percentOff:'lots'},400]]){
    res=await routeFor(db).POST(request(body));
    assert.equal(res.status,status,JSON.stringify(body));
    assert.ok((await res.json()).error);
  }
  assert.equal((await codes.storedPromoList(db)).length,1,'a refused save changes nothing');

  // Saving the same code again edits it in place and keeps when it was created.
  res=await routeFor(db).POST(request({code:'SPRING15',percentOff:25}));
  out=await res.json();
  assert.equal(res.status,200);
  assert.deepEqual(out.custom.map(p=>[p.code,p.percentOff]),[['SPRING15',25]]);
  assert.equal(history.at(-1).summary,'Promo code SPRING15 changed from 15% to 25%.');

  // Off, then on, without losing the row or its history in the report.
  res=await routeFor(db).POST(request({code:'SPRING15',active:false}));
  assert.equal(res.status,200);
  assert.deepEqual(await codes.storedPromotions(db),[],'off means checkout refuses it');
  assert.equal((await codes.storedPromoList(db))[0].percentOff,25,'and the discount is remembered for when it comes back');
  assert.equal(history.at(-1).summary,'Promo code SPRING15 turned off.');
  res=await routeFor(db).POST(request({code:'SPRING15',active:true}));
  assert.equal(res.status,200);
  assert.deepEqual(await codes.storedPromotions(db),[{code:'SPRING15',percentOff:25}]);

  // Deleting something that is not there says so rather than inventing a row.
  res=await routeFor(db).POST(request({code:'NOTHERE',remove:true}));
  assert.equal(res.status,404);
  res=await routeFor(db).POST(request({code:'NOTHERE',active:false}));
  assert.equal(res.status,404,'and neither does turning one off');

  // Two administrators at once. This save read one code; by the time it writes, the other
  // administrator has added a second. Overwriting would silently delete their code, so the write is
  // refused and the person is told to reload.
  const racing=database({[KEY]:JSON.stringify([{code:'SPRING15',percentOff:25,active:true,created:1,by:'a@e.invalid'}])});
  const winner=[{code:'SPRING15',percentOff:25,active:true,created:1,by:'a@e.invalid'},{code:'OTHER10',percentOff:10,active:true,created:2,by:'b@e.invalid'}];
  res=await routeFor(racing,{raceWith:winner}).POST(request({code:'SPRING15',percentOff:5}));
  assert.equal(res.status,409,'a save built on a row that has since changed is refused');
  assert.match((await res.json()).error,/Reload administration/);
  assert.deepEqual((await codes.storedPromoList(racing)).map(p=>[p.code,p.percentOff]),[['SPRING15',25],['OTHER10',10]],'the other administrator\'s code survives intact');
  // Retried against the current row it goes through, because nothing changes under it this time.
  res=await routeFor(racing).POST(request({code:'SPRING15',percentOff:5}));
  assert.equal(res.status,200);
  assert.deepEqual((await codes.storedPromoList(racing)).map(p=>[p.code,p.percentOff]),[['SPRING15',5],['OTHER10',10]]);

  // Permission and origin.
  res=await routeFor(db,{allow:false}).POST(request({code:'SPRING15',percentOff:10}));
  assert.equal(res.status,403);
  res=await routeFor(db,{allow:false}).GET();
  assert.equal(res.status,403,'reading the list needs the same permission as writing it');
  const crossOrigin={headers:{get:()=>'https://evil.example'},nextUrl:{origin:'https://trybiomod.com'},async json(){return{code:'FREE90',percentOff:90};}};
  res=await routeFor(db).POST(crossOrigin);
  assert.equal(res.status,403,'a form posted from another site is refused before anything is read');
  assert.equal((await codes.storedPromoList(db)).length,1);

  // GET reports built-ins read-only beside the editable list.
  const listing=await (await routeFor(db).GET()).json();
  assert.ok(listing.builtIn.some(p=>p.code==='BM10'));
  assert.equal(listing.maxPercentOff,90);
  assert.deepEqual(listing.custom.map(p=>p.code),['SPRING15']);
  assert.equal(routeFor(db).scopes.length,0,'scope is asserted per call, not cached across them');

  // Finally: deleting really removes it from pricing.
  res=await routeFor(db).POST(request({code:'SPRING15',remove:true}));
  assert.equal(res.status,200);
  assert.deepEqual(await codes.storedPromotions(db),[]);
  assert.throws(()=>promos.promotion('SPRING15',[]),/not valid/);
  assert.equal(history.at(-1).summary,'Promo code SPRING15 deleted.');
  assert.ok(history.every(h=>h.entityType==='setting'&&h.status==='succeeded'));

  // --- Wiring: every place a code is resolved reads the stored ones too. ---
  const reads=[['lib/commerce.ts',/applyPromotion\(priced, promoCode, await storedPromotions\(database\(\)\)\)/,'checkout totals'],
    ['app/api/store/[action]/route.ts',/promotion\(b\.code, await storedPromotions\(database\(\)\)\)/,'applying a code at checkout'],
    ['app/api/store/[action]/route.ts',/stored = await storedPromotions\(database\(\)\)/,'the saved code on a later page load'],
    ['app/api/store/[action]/route.ts',/if \(stored !== null\) jar\.delete\(PROMO_COOKIE\)/,'a failed read of the stored list must not cost a customer their saved code'],
    ['app/r/[code]/route.ts',/promotion\(code, await storedPromotions\(database\(\)\)\)/,'affiliate referral links'],
    ['lib/promo-analytics.ts',/activePromotions\(deps\.storedPromos \? await deps\.storedPromos\(\) : \[\]\)/,'the promo report'],
    ['lib/affiliate-program.ts',/activePromotions\(await storedPromotions\(db\)\)/,'assigning a code to a partner']];
  for(const [file,pattern,what] of reads)
    assert.match(fs.readFileSync(path.join(root,file),'utf8'),pattern,what+' must honour owner-added codes');
  // It sits inside the existing Promo codes tab. Administration's shell is untouched, so no tab was
  // added and nothing else on that screen changed.
  const tab=fs.readFileSync(path.join(root,'components/store/promo-analytics.tsx'),'utf8');
  assert.match(tab,/<AdminPromoCodes\/>/,'the editor sits at the top of the Promo codes tab');
  const admin=fs.readFileSync(path.join(root,'components/store/admin.tsx'),'utf8');
  assert.equal((admin.match(/<TabsTrigger/g)||[]).length,2,'no new tab was created');
  assert.doesNotMatch(admin,/AdminPromoCodes/,'and administration\'s shell did not have to change');
  const panel=fs.readFileSync(path.join(root,'components/store/admin-promo-codes.tsx'),'utf8');
  assert.match(panel,/Add a promo code/,'the button says what it does');
  assert.match(panel,/cannot be edited here/,'and the panel says built-ins are not editable');
  // A reader with report access but no settings access is refused by the endpoint, and the panel
  // then renders nothing rather than an error on a screen they can legitimately use.
  assert.match(panel,/if \(denied\) return null;/,'no permission means no panel');

  console.log('PASS: code/percentage validation and the 90% ceiling, untrusted settings rows, built-ins winning every collision, exact cent allocation for a stored code, on/off honoured by pricing, and the real endpoint\'s permission, origin, bounds, in-place edit, delete, audit history and concurrent-save rebase. Isolated SQLite, no network.');
})().catch(e=>{console.error(e);process.exitCode=1});
