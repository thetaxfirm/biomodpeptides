// Real onboarding, offer, signature, payout, 1099 and contact functions over every migration in
// isolated SQLite. Synthetic identities only (IRS-style sample numbers); no network or customer data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),cache={};
function load(file){if(cache[file])return cache[file].exports;const m=new Module(path.join(root,file),module);cache[file]=m;m.filename=path.join(root,file);m.paths=Module._nodeModulePaths(root);
 m.require=id=>id.endsWith('.json')?JSON.parse(fs.readFileSync(path.join(path.dirname(m.filename),id),'utf8')):id.startsWith('./')?load(path.join(path.dirname(file),id+'.ts')):require(id);
 m._compile(ts.transpileModule(fs.readFileSync(m.filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,m.filename);return m.exports;}
const p=load('lib/affiliate-program.ts'),o=load('lib/affiliate-onboarding.ts'),c=load('lib/contacts.ts'),promo=load('lib/promo-codes.ts');
const sql=new DatabaseSync(':memory:');
for(const f of fs.readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',f),'utf8'));
function stmt(query,args=[]){return{bind:(...a)=>stmt(query,a),first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:sql.prepare(query).run(...args)})};}
const db={prepare:q=>stmt(q),batch:async list=>{sql.exec('BEGIN');try{const results=[];for(const s of list)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const vault=Buffer.alloc(32,7).toString('base64');
// A real 1x1 JPEG and a signature PNG large enough to be a drawn stroke.
const jpeg='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const zlib=require('node:zlib');function png(w,h){const crcT=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcT[n]=c>>>0;}const crc=b=>{let c=0xffffffff;for(const x of b)c=crcT[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;};const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc(td));return Buffer.concat([l,td,cr]);};const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;const raw=Buffer.concat(Array.from({length:h},(_,y)=>Buffer.concat([Buffer.from([0]),Buffer.from(Array.from({length:w*3},(_,i)=>(i*7+y*13)%251))])));return'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw,{level:0})),chunk('IEND',Buffer.alloc(0))]).toString('base64');}
(async()=>{
 // Vault: round trip, random IVs, and fail closed without a key.
 const sealed=await o.seal(vault,'123456789');assert.match(sealed,/^v1:/);assert.ok(!sealed.includes('123456789'));assert.equal(await o.unseal(vault,sealed),'123456789');assert.notEqual(await o.seal(vault,'123456789'),sealed);
 await assert.rejects(o.seal(undefined,'x'),/Secure storage/);await assert.rejects(o.unseal(Buffer.alloc(32,8).toString('base64'),sealed));
 const user={id:'partner-fixture',email:'partner@example.invalid'};
 await p.inviteAffiliate(db,'owner',{email:user.email,active:true},100);
 const a=(await p.affiliateState(db)).agreement;
 await p.applyAffiliate(db,user,{agreementId:a.id,accepted:true,guidelinesAccepted:true,name:'Isolated partner',website:'https://example.invalid',audience:'Isolated test audience description.'},101);
 // Talking points must be published before an offer.
 const offer={owner:user.id,code:'drmatt10',discountPercent:10,commissionBps:2000,holdDays:30,payoutMethods:'Check',channels:['online','in_person']};
 await assert.rejects(o.sendOffer(db,'owner',offer,102),/talking points/);
 await assert.rejects(o.publishTalkingPoints(db,'owner',{...o.defaultTalkingPoints,confirmed:false},102));
 await o.publishTalkingPoints(db,'owner',{...o.defaultTalkingPoints,confirmed:true},102);
 await assert.rejects(o.publishTalkingPoints(db,'owner',{...o.defaultTalkingPoints,confirmed:true},102));
 await assert.rejects(o.sendOffer(db,user.id,offer,103),/Another administrator/);
 await assert.rejects(o.sendOffer(db,'owner',{...offer,code:'DR MATT'},103));
 const sent=await o.sendOffer(db,'owner',offer,103);assert.match(sent.message,/DRMATT10.*10% off.*20% commission/);
 assert.deepEqual((await promo.storedPromotions(db)).find(x=>x.code==='DRMATT10'),{code:'DRMATT10',percentOff:10});
 // The old click-to-accept path cannot bypass signing a coded offer.
 const schedule=await p.affiliateSchedule(db,user.id);assert.equal(schedule.code,'DRMATT10');assert.equal(schedule.discount_percent,10);
 await assert.rejects(p.acceptAffiliateSchedule(db,user.id,{scheduleId:schedule.id,accepted:true},104),/must be signed/);
 // Packet waits for W-9 and license.
 let packet=await o.offerPacket(db,user.id);assert.equal(packet.ready,false);assert.deepEqual(packet.missing,['tax details (W-9)','driver’s license photo']);
 const tax={legalName:'Pat Q Sample',businessName:'',classification:'individual',tinType:'ssn',tin:'666-12-3456',phone:'(775) 555-0100',address:{line1:'1 Test Way',city:'Reno',state:'nv',zip:'89501'}};
 await assert.rejects(o.saveTaxProfile(db,vault,user.id,tax,105),/valid Social Security/);
 await assert.rejects(o.saveTaxProfile(db,undefined,user.id,{...tax,tin:'123-45-6789'},105),/Secure storage/);
 await assert.rejects(o.saveTaxProfile(db,vault,'stranger',{...tax,tin:'123-45-6789'},105),/application/);
 await o.saveTaxProfile(db,vault,user.id,{...tax,tin:'123-45-6789'},105);
 const row=sql.prepare('SELECT * FROM affiliate_tax_profiles').get();assert.equal(row.tin_last4,'6789');assert.ok(!JSON.stringify(row).includes('123456789'));assert.equal(JSON.parse(row.address).state,'NV');
 await assert.rejects(o.saveIdDocument(db,vault,user.id,{side:'front',dataUrl:'data:image/jpeg;base64,'+Buffer.from('<svg/>').toString('base64')},106),/JPEG/);
 await o.saveIdDocument(db,vault,user.id,{side:'front',dataUrl:jpeg},106);
 const doc=sql.prepare('SELECT * FROM affiliate_id_documents').get();assert.ok(!doc.cipher.includes(jpeg.split(',')[1].slice(0,20)));
 const opened=await o.readIdDocument(db,vault,'owner',doc.id,107);assert.equal(Buffer.from(opened.bytes).toString('base64'),jpeg.split(',')[1]);
 // Sign: exact packet hash, legal name and a drawn signature are required; acceptance is atomic.
 packet=await o.offerPacket(db,user.id);assert.equal(packet.ready,true);assert.equal(packet.packet.offer.commissionPercent,20);assert.match(packet.packet.talkingPoints.body,/DRMATT10 gives your customers 10% off/);
 const sign={scheduleId:schedule.id,packetSha256:packet.sha256,typedName:'pat q  sample',signature:png(60,20),consent:true,certify:true};
 await assert.rejects(o.signOfferPacket(db,user.id,{...sign,typedName:'Someone Else'},{ip:'',userAgent:''},108),/legal name/);
 await assert.rejects(o.signOfferPacket(db,user.id,{...sign,packetSha256:'0'.repeat(64)},{ip:'',userAgent:''},108),/changed/);
 await assert.rejects(o.signOfferPacket(db,user.id,{...sign,signature:png(1,1)},{ip:'',userAgent:''},108),/Draw/);
 const signed=await o.signOfferPacket(db,user.id,sign,{ip:'192.0.2.1',userAgent:'fixture'},108);
 assert.equal((await p.affiliateSchedule(db,user.id)).accepted,108);
 await assert.rejects(o.signOfferPacket(db,user.id,sign,{ip:'',userAgent:''},109),/already signed/);
 assert.throws(()=>sql.prepare('UPDATE affiliate_signatures SET typed_name=?').run('x'),/immutable/);
 const rec=await o.signatureRecord(db,signed.signatureId);assert.equal(await o.sha256(rec.packet),rec.packet_sha256);assert.equal(rec.ip,'192.0.2.1');
 // Approval uses the offered code; a paid order with it earns 20% of the discounted product amount.
 await p.reviewAffiliate(db,'reviewer',{owner:user.id,status:'approved',expectedUpdated:sql.prepare('SELECT updated FROM affiliate_members').get().updated,code:'DRMATT10',note:'Signed and verified'},110);
 sql.prepare('INSERT INTO orders(id,owner,request_key,status,data,total,payment_ref,notification_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)').run('order-1','shopper','order-1','paid',JSON.stringify({email:'Buyer@Example.invalid',address:{name:'Buyer One',phone:'775-555-0111'},environment:'authorizenet:live',promo:{code:'DRMATT10'},subtotal:20000,discount:2000}),19000,'pay-1','note-1',200,200);
 const earning=(await p.affiliateEarnings(db,user.id,200+31*86400000))[0];assert.equal(earning.basisCents,18000);assert.equal(earning.commissionCents,3600);assert.equal(earning.state,'eligible');
 // In-person credit, payouts gated on a verified W-9, then the 1099 report and export.
 await o.recordManualSale(db,'staff',{owner:user.id,soldOn:'2026-11-02',basisCents:5000,note:'Booth sale receipt 14'},111);
 assert.equal((await o.manualSales(db,user.id))[0].commission_cents,1000);
 await assert.rejects(o.recordPayout(db,'owner',{owner:user.id,amountCents:250000,paidOn:'2026-12-01',method:'Check'},112),/Verify/);
 await assert.rejects(o.reviewTaxProfile(db,user.id,{owner:user.id,status:'verified'},112),/Another administrator/);
 await o.reviewTaxProfile(db,'owner',{owner:user.id,status:'verified'},112);
 await o.recordPayout(db,'owner',{owner:user.id,amountCents:250000,paidOn:'2026-12-01',method:'Check',reference:'1001'},113);
 await o.recordPayout(db,'owner',{owner:user.id,amountCents:-10000,paidOn:'2026-12-02',method:'Check',note:'Correction'},114);
 assert.throws(()=>sql.prepare('DELETE FROM affiliate_payouts').run(),/correcting entry/);
 let report=await o.report1099(db,2026);assert.equal(report.thresholdCents,200000);assert.equal(report.rows[0].total,240000);assert.equal(report.rows[0].reportable,true);assert.deepEqual(report.rows[0].warnings,[]);
 assert.equal((await o.report1099(db,2025)).thresholdCents,60000);
 const exported=await o.export1099(db,vault,'owner',2026,115);assert.match(exported,/"123456789"/);assert.match(exported,/"2400.00"/);assert.match(exported,/"Reno","NV","89501"/);
 assert.equal((await o.revealTin(db,vault,'owner',user.id,116)).tin,'123-45-6789');
 assert.ok(sql.prepare("SELECT COUNT(*) n FROM affiliate_events WHERE action IN ('tax.revealed','tax.exported1099','id.viewed')").get().n===3);
 assert.equal(o.csv([['=HYPERLINK("x")']]),'"\'=HYPERLINK(""x"")"\r\n');
 // A changed W-9 after signing does not alter the signed packet.
 await o.saveTaxProfile(db,vault,user.id,{...tax,tin:'123-45-6780',legalName:'Pat Q Sample'},117);
 assert.equal(JSON.parse((await o.signatureRecord(db,signed.signatureId)).packet).w9.tinLast4,'6789');
 // Contacts: merged by email across accounts, orders and affiliates.
 await c.recordContact(db,{email:'BUYER@example.invalid',owner:'shopper',name:'Buyer One',phone:'',source:'account'},300);
 await c.recordContact(db,{email:'not-an-email',source:'account'},300);
 sql.prepare("INSERT INTO requests(id,owner,kind,data,created) VALUES('r1',NULL,'contact',?,150)").run(JSON.stringify({name:'Walk In',email:'walkin@example.invalid',subject:'x',message:'y'}));
 const list=await c.contactList(db);const buyer=list.find(x=>x.email==='buyer@example.invalid');
 assert.deepEqual(buyer.phones,['775-555-0111']);assert.deepEqual(buyer.sources.sort(),['account','order']);assert.equal(buyer.paidCents,19000);
 assert.ok(list.some(x=>x.email==='walkin@example.invalid'&&x.sources.includes('contact_form')));
 assert.ok(list.some(x=>x.email==='partner@example.invalid'&&x.phones.includes('(775) 555-0100')));
 assert.equal(list.length,3);
 console.log('PASS: encrypted W-9/ID vault, one-step offer with store code, signed packet, attribution at 20% after a 10% code, in-person credit, payouts, 1099 threshold/export and merged contacts.');
})().catch(e=>{console.error(e);process.exit(1);});
