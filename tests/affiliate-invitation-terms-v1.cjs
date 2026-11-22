// Invitations that carry their terms: real functions over every migration in isolated SQLite.
// Synthetic people at example.invalid only; the mail provider is a local stub, so nothing is sent.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),cache={};
function load(file){if(cache[file])return cache[file].exports;const m=new Module(path.join(root,file),module);cache[file]=m;m.filename=path.join(root,file);m.paths=Module._nodeModulePaths(root);
 m.require=id=>id.endsWith('.json')?JSON.parse(fs.readFileSync(path.join(path.dirname(m.filename),id),'utf8')):id.startsWith('./')?load(path.join(path.dirname(file),id+'.ts')):require(id);
 m._compile(ts.transpileModule(fs.readFileSync(m.filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,m.filename);return m.exports;}
const t=load('lib/affiliate-invite-terms.ts'),p=load('lib/affiliate-program.ts'),o=load('lib/affiliate-onboarding.ts'),inv=load('lib/affiliate-invitations.ts'),promo=load('lib/promo-codes.ts');
const sql=new DatabaseSync(':memory:');
for(const f of fs.readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',f),'utf8'));
function stmt(query,args=[]){return{bind:(...a)=>stmt(query,a),first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:sql.prepare(query).run(...args)})};}
const db={prepare:q=>stmt(q),batch:async list=>{sql.exec('BEGIN');try{const results=[];for(const s of list)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const owner={id:'owner-fixture',email:'owner@example.invalid'};
const stored=async code=>(await promo.storedPromoList(db)).find(x=>x.code===code);
const invitation=email=>sql.prepare('SELECT * FROM affiliate_invitations WHERE email=?').get(email);
const zlib=require('node:zlib');function png(w,h){const crcT=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcT[n]=c>>>0;}const crc=b=>{let c=0xffffffff;for(const x of b)c=crcT[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;};const chunk=(k,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(k),d]);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc(td));return Buffer.concat([l,td,cr]);};const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;const raw=Buffer.concat(Array.from({length:h},(_,y)=>Buffer.concat([Buffer.from([0]),Buffer.from(Array.from({length:w*3},(_,i)=>(i*7+y*13)%251))])));return'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw,{level:0})),chunk('IEND',Buffer.alloc(0))]).toString('base64');}
const jpeg='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const vault=Buffer.alloc(32,7).toString('base64');
(async()=>{
 // The code is the name and the customer discount; commission is stored in hundredths of a percent.
 assert.equal(t.partnerCode('Lupe',10),'LUPE10');assert.equal(t.partnerCode('lupe',15),'LUPE15');assert.equal(t.partnerCode('Dr. Matt',15),'DRMATT15');assert.equal(t.partnerCode('José',10),'JOSE10');
 assert.equal(t.partnerCode('',10),'');assert.equal(t.partnerCode('L',0),'');assert.equal(t.partnerCode('Al',5),'AL5');assert.equal(t.partnerCode('x'.repeat(60),10).length,40);
 assert.equal(t.percentText(1500),'15');assert.equal(t.percentText(1250),'12.5');assert.equal(t.commissionBps('15'),1500);assert.equal(t.commissionBps(12.5),1250);
 assert.equal(t.channelsText(['online','in_person']),'online and in person');assert.equal(t.channelsText(['in_person']),'in person');

 // Refused before anything is written: bad figures, a code with spaces, a built-in store code.
 const lupe={email:'Lupe@Example.invalid',name:' Lupe ',discountPercent:10,commissionBps:1500};
 await assert.rejects(inv.saveInvitationTerms(db,owner,{...lupe,name:'  '},100),e=>e.issues[0].message==='Enter the partner’s name.');
 await assert.rejects(inv.saveInvitationTerms(db,owner,{...lupe,discountPercent:0},100),e=>/customer discount is from 1 to 90/.test(e.issues[0].message));
 await assert.rejects(inv.saveInvitationTerms(db,owner,{...lupe,discountPercent:10.5},100),e=>/whole number/.test(e.issues[0].message));
 await assert.rejects(inv.saveInvitationTerms(db,owner,{...lupe,commissionBps:10001},100),e=>/from 0 to 100%/.test(e.issues[0].message));
 await assert.rejects(inv.saveInvitationTerms(db,owner,{...lupe,email:'not-an-email'},100),e=>/valid email/.test(e.issues[0].message));
 await assert.rejects(inv.saveInvitationTerms(db,owner,{...lupe,code:'LU PE'},100),/Codes are 3 to 40/);
 await assert.rejects(inv.saveInvitationTerms(db,owner,{email:'anna@example.invalid',name:'Anna',discountPercent:20,commissionBps:1000},100),/ANNA20 is a built-in store code/);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM affiliate_invitations').get().n,0);assert.equal((await promo.storedPromoList(db)).length,0);

 // Lupe at 10 and 15: the invitation, the store code and the audit trail in one save.
 let saved=await inv.saveInvitationTerms(db,owner,lupe,100);
 assert.equal(saved.code,'LUPE10');assert.equal(saved.promo,'created');assert.equal(saved.message,'Saved. Lupe’s code is LUPE10: customers get 10% off and Lupe earns 15% of each sale. LUPE10 works at checkout now and is listed under Promo codes. Nothing has been emailed yet.');
 let row=invitation('lupe@example.invalid');assert.equal(row.active,1);assert.equal(row.name,'Lupe');assert.equal(row.code,'LUPE10');assert.equal(row.discount_percent,10);assert.equal(row.commission_bps,1500);assert.equal(row.hold_days,30);assert.equal(row.payout_methods,'Check or ACH');assert.equal(row.channels,'online,in_person');
 assert.deepEqual((await promo.storedPromotions(db)).find(x=>x.code==='LUPE10'),{code:'LUPE10',percentOff:10});
 assert.match((await stored('LUPE10')).by,/^owner@example\.invalid for partner Lupe$/);
 assert.deepEqual(sql.prepare("SELECT action FROM affiliate_events WHERE action LIKE 'invitation.%' ORDER BY rowid").all().map(x=>x.action),['invitation.authorized','invitation.terms']);
 const logged=sql.prepare("SELECT actor,actor_type,summary FROM change_events WHERE action='store.promo_code' AND entity_id='LUPE10'").get();
 assert.equal(logged.actor,'owner@example.invalid');assert.equal(logged.actor_type,'staff');assert.match(logged.summary,/LUPE10 created at 10% off for partner Lupe/);
 // Saving the same terms again changes nothing and logs no second code change.
 assert.equal((await inv.saveInvitationTerms(db,owner,lupe,101)).promo,'unchanged');
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM change_events WHERE action='store.promo_code'").get().n,1);

 // The owner's screen reads the terms back; nobody has applied or been emailed, and talking points are not approved yet.
 let admin=await p.affiliateAdmin(db);let listed=admin.invitations.find(x=>x.email==='lupe@example.invalid');
 assert.equal(listed.code,'LUPE10');assert.equal(listed.commission_bps,1500);assert.equal(listed.member,null);assert.equal(listed.email_status,null);assert.equal(admin.talkingPointsReady,false);
 // The invited person sees those terms before applying; nobody else sees anything.
 const partner={id:'partner-fixture',email:'lupe@example.invalid'};
 let portal=await p.affiliatePortal(db,partner.id,'LUPE@example.invalid');assert.equal(portal.invitation.code,'LUPE10');assert.equal(portal.invitation.commission_bps,1500);assert.equal(portal.member,null);
 await assert.rejects(p.affiliatePortal(db,'stranger','stranger@example.invalid'),/invitation-only/);

 // One code, one partner: another invitation, and a Businesses slot, cannot share it.
 await assert.rejects(inv.saveInvitationTerms(db,owner,{email:'other-lupe@example.invalid',name:'Lupe',discountPercent:10,commissionBps:1000},102),/LUPE10 already belongs to another partner/);
 sql.prepare("INSERT INTO settings(key,value) VALUES('restaurant_partners_v1',?)").run(JSON.stringify([{slot:1,name:"Mario's Pizza",percentOff:15,active:true,code:'MARIOSPIZZA15'}]));
 await assert.rejects(inv.saveInvitationTerms(db,owner,{email:'mario@example.invalid',name:'Mario',code:'mariospizza15',discountPercent:15,commissionBps:1000},102),/MARIOSPIZZA15 is used by a Businesses slot/);
 assert.equal(invitation('mario@example.invalid'),undefined);

 // "Depends on the situation": 15 and 15 renames the code, and the old one stops pricing orders.
 saved=await inv.saveInvitationTerms(db,owner,{...lupe,discountPercent:15},103);
 assert.equal(saved.code,'LUPE15');assert.equal(saved.retired,'LUPE10');assert.match(saved.message,/The old code LUPE10 was switched off/);
 assert.equal((await stored('LUPE10')).active,false);assert.deepEqual((await promo.storedPromotions(db)).map(x=>x.code),['LUPE15']);
 // 10 and 10, with the owner's own code: the percentages change, the name they agreed to does not have to.
 saved=await inv.saveInvitationTerms(db,owner,{...lupe,code:'lupe',discountPercent:10,commissionBps:1000},104);
 assert.equal(saved.code,'LUPE');assert.equal(saved.retired,'LUPE15');assert.deepEqual((await promo.storedPromotions(db)).find(x=>x.code==='LUPE'),{code:'LUPE',percentOff:10});
 saved=await inv.saveInvitationTerms(db,owner,lupe,105);assert.equal(saved.code,'LUPE10');assert.equal(saved.promo,'updated');assert.equal((await stored('LUPE10')).active,true);assert.equal((await stored('LUPE')).active,false);

 // Revoking takes the code down; authorizing again brings it back.
 let access=await inv.setInvitationAccess(db,owner,{email:'lupe@example.invalid',active:false},106);assert.match(access.message,/Code LUPE10 was switched off/);
 assert.equal(invitation('lupe@example.invalid').active,0);assert.equal((await stored('LUPE10')).active,false);
 await assert.rejects(p.affiliatePortal(db,partner.id,partner.email),/invitation-only/);
 access=await inv.setInvitationAccess(db,owner,{email:'lupe@example.invalid',active:true},107);assert.match(access.message,/Code LUPE10 works at checkout/);assert.equal((await stored('LUPE10')).active,true);
 // A mistyped address is revoked and the right one invited with the same code.
 await inv.saveInvitationTerms(db,owner,{email:'dnaa@example.invalid',name:'Dana',discountPercent:10,commissionBps:1000},108);
 await inv.setInvitationAccess(db,owner,{email:'dnaa@example.invalid',active:false},109);assert.equal((await stored('DANA10')).active,false);
 saved=await inv.saveInvitationTerms(db,owner,{email:'dana@example.invalid',name:'Dana',discountPercent:10,commissionBps:1000},110);
 assert.equal(saved.code,'DANA10');assert.equal(invitation('dnaa@example.invalid').code,null);assert.equal((await stored('DANA10')).active,true);
 // A revoked invitation whose code has since gone to a Businesses slot does not take it back or reprice it.
 await inv.saveInvitationTerms(db,owner,{email:'rio@example.invalid',name:'Rio',discountPercent:20,commissionBps:1000},110);
 await inv.setInvitationAccess(db,owner,{email:'rio@example.invalid',active:false},110);
 sql.prepare("UPDATE settings SET value=? WHERE key='restaurant_partners_v1'").run(JSON.stringify([{slot:1,name:"Mario's Pizza",percentOff:15,active:true,code:'MARIOSPIZZA15'},{slot:2,name:'Rio',percentOff:20,active:true,code:'RIO20'}]));
 access=await inv.setInvitationAccess(db,owner,{email:'rio@example.invalid',active:true},110);assert.match(access.message,/RIO20 now belongs to someone else, so set new terms/);
 assert.equal(invitation('rio@example.invalid').code,null);assert.equal(invitation('rio@example.invalid').active,1);assert.equal((await stored('RIO20')).active,false,'The stored row is the Businesses screen’s to switch on, not this one’s.');
 // A plain invitation with no terms still works the old way.
 await inv.setInvitationAccess(db,owner,{email:'plain@example.invalid',active:true},111);assert.equal(invitation('plain@example.invalid').code,null);

 // ---- The invitation email. Rebuilt from the saved terms; the browser supplies only a note.
 const agreement=(await p.affiliateState(db)).agreement;
 const message=t.invitationMessage({terms:inv.termsFromRow(invitation('dana@example.invalid')),program:{minimumPayoutCents:agreement.minimum_payout_cents,payoutSchedule:agreement.payout_schedule},email:'dana@example.invalid'});
 assert.equal(message.subject,'Your Biomod partner invitation: code DANA10');
 for(const line of ['Hi Dana,','Your code: DANA10','Your customers get 10% off at trybiomod.com, online and in person.','You earn 10% of each sale made with your code.','Earnings are paid every 30 days by Check or ACH once they reach $500, after a 30-day hold.','1. Open https://trybiomod.com/account/affiliate','(dana@example.invalid)','Biomod\ntrybiomod.com'])assert.ok(message.text.includes(line),line);
 assert.ok(!/[—–]/.test(message.text),'No dashes standing in for punctuation.');
 assert.equal(inv.termsFromRow(invitation('plain@example.invalid')),null);
 assert.equal(inv.partnerMailFrom('BIOMOD Orders <contact@trybiomod.com>'),'Biomod Partner Program <contact@trybiomod.com>');assert.equal(inv.partnerMailFrom('contact@trybiomod.com'),'Biomod Partner Program <contact@trybiomod.com>');assert.equal(inv.partnerMailFrom('Bad <not an address>'),'');
 const calls=[];let reply=()=>Response.json({id:'provider-1'});
 const deps=at=>({now:()=>at,fetch:async(url,init)=>{calls.push({url,init,body:JSON.parse(init.body)});return reply();}});
 const env={DB:db,RESEND_API_KEY:'re_fixture',ORDER_EMAIL_FROM:'BIOMOD Orders <contact@trybiomod.com>'};
 await assert.rejects(inv.sendInvitationEmail({DB:db},owner,{email:'dana@example.invalid'},deps(200)),/Store email is not set up, so nothing was sent/);
 await assert.rejects(inv.sendInvitationEmail(env,owner,{email:'plain@example.invalid'},deps(200)),/Set this partner’s terms/);
 await assert.rejects(inv.sendInvitationEmail(env,owner,{email:'dnaa@example.invalid'},deps(200)),/Save this invitation before emailing it/);
 await assert.rejects(inv.sendInvitationEmail(env,owner,{email:'nobody@example.invalid'},deps(200)),/Save this invitation before emailing it/);
 await assert.rejects(inv.sendInvitationEmail(env,owner,{email:'dana@example.invalid',note:'x'.repeat(601)},deps(200)),e=>/under 600 characters/.test(e.issues[0].message));
 sql.prepare('UPDATE affiliate_program_state SET open=0 WHERE id=1').run();
 await assert.rejects(inv.sendInvitationEmail(env,owner,{email:'dana@example.invalid'},deps(200)),/Invited applications are paused/);
 sql.prepare('UPDATE affiliate_program_state SET open=1 WHERE id=1').run();
 assert.equal(calls.length,0,'Nothing reaches the mail provider until every check passes.');
 let sent=await inv.sendInvitationEmail(env,owner,{email:'Dana@Example.invalid',note:'Great meeting you. <b>Welcome</b>'},deps(200));
 assert.equal(sent.status,'accepted');assert.match(sent.message,/Invitation emailed to dana@example\.invalid with code DANA10 \(10% off for customers, 10% to Dana\)/);
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.resend.com/emails');assert.equal(calls[0].init.headers.Authorization,'Bearer re_fixture');assert.match(calls[0].init.headers['Idempotency-Key'],/^affiliate-invitation-/);
 assert.equal(calls[0].body.from,'Biomod Partner Program <contact@trybiomod.com>');assert.deepEqual(calls[0].body.to,['dana@example.invalid']);assert.equal(calls[0].body.reply_to,'contact@trybiomod.com');assert.equal(calls[0].body.subject,message.subject);
 assert.ok(calls[0].body.text.includes('Great meeting you. <b>Welcome</b>'));assert.ok(calls[0].body.text.includes('Your code: DANA10'));
 assert.ok(calls[0].body.html.includes('Great meeting you. &#60;b&#62;Welcome&#60;/b&#62;'),'The owner’s note is escaped in the HTML part.');assert.ok(!calls[0].body.html.includes('<b>Welcome'));
 assert.ok(calls[0].body.html.includes('DANA10</strong>'));assert.ok(calls[0].body.html.includes('href="https://trybiomod.com/account/affiliate"'));assert.ok(calls[0].body.html.includes('laboratory research use only'));
 assert.deepEqual({...sql.prepare("SELECT email,status,provider_id,actor FROM affiliate_invitation_emails").get()},{email:'dana@example.invalid',status:'accepted',provider_id:'provider-1',actor:'owner-fixture'});
 assert.equal(JSON.parse(sql.prepare("SELECT detail FROM affiliate_events WHERE action='invitation.emailed'").get().detail).status,'accepted');
 listed=(await p.affiliateAdmin(db)).invitations.find(x=>x.email==='dana@example.invalid');assert.equal(listed.email_status,'accepted');assert.equal(listed.emailed,200);
 // Replies follow the store's configured reply address when one is saved.
 sql.prepare("INSERT INTO settings(key,value) VALUES('coa_delivery_v1',?)").run(JSON.stringify({enabled:false,replyTo:'Replies@Example.invalid',notifyTo:null}));
 await inv.sendInvitationEmail(env,owner,{email:'dana@example.invalid'},deps(300));assert.equal(calls[1].body.reply_to,'replies@example.invalid');assert.ok(!calls[1].body.text.includes('Great meeting you'));
 // An explicit rejection is "not sent". A lost or 5xx answer is "not confirmed", never "failed".
 reply=()=>Response.json({message:'invalid to'},{status:422});
 await assert.rejects(inv.sendInvitationEmail(env,owner,{email:'dana@example.invalid'},deps(400)),/rejected this invitation, so nothing was sent/);
 reply=()=>new Response('upstream',{status:503});
 await assert.rejects(inv.sendInvitationEmail(env,owner,{email:'dana@example.invalid'},deps(500)),/did not confirm this invitation/);
 reply=()=>{throw Error('socket closed');};
 await assert.rejects(inv.sendInvitationEmail(env,owner,{email:'dana@example.invalid'},deps(600)),/did not confirm this invitation/);
 assert.deepEqual(sql.prepare('SELECT status FROM affiliate_invitation_emails ORDER BY created').all().map(x=>x.status),['accepted','accepted','failed','unknown','unknown']);
 // Two clicks cannot send two emails; a claim that never resolved stops blocking after two minutes.
 reply=()=>Response.json({id:'provider-2'});
 sql.prepare("INSERT INTO affiliate_invitation_emails(id,email,status,subject,actor,created) VALUES('stuck','dana@example.invalid','sending','x','owner-fixture',1000)").run();
 const before=calls.length;
 await assert.rejects(inv.sendInvitationEmail(env,owner,{email:'dana@example.invalid'},deps(1000+60000)),/already being sent/);assert.equal(calls.length,before);
 assert.equal((await inv.sendInvitationEmail(env,owner,{email:'dana@example.invalid'},deps(1000+120001))).status,'accepted');
 // The daily cap counts everything that may have gone out, and stops before the provider is called.
 for(let i=0;i<inv.INVITE_EMAIL_DAILY_CAP;i++)sql.prepare("INSERT INTO affiliate_invitation_emails(id,email,status,subject,actor,created) VALUES(?,?,'accepted','x','owner-fixture',?)").run('cap-'+i,'dana@example.invalid',90000000+i);
 const capped=calls.length;
 await assert.rejects(inv.sendInvitationEmail(env,owner,{email:'dana@example.invalid'},deps(90000100)),/Daily invitation email limit reached/);assert.equal(calls.length,capped);

 // ---- Applying turns the invitation's terms into the partner's offer, with nothing left for the owner to fill in.
 const application={agreementId:agreement.id,accepted:true,guidelinesAccepted:true,name:'Lupe Sample',website:'https://example.invalid',audience:'Isolated test audience description.'};
 const applied=await p.applyAffiliate(db,partner,application,200000000);assert.match(applied.message,/Your offer is ready below/);
 let schedule=await p.affiliateSchedule(db,partner.id);assert.equal(schedule.code,'LUPE10');assert.equal(schedule.discount_percent,10);assert.equal(schedule.commission_bps,1500);assert.equal(schedule.hold_days,30);assert.equal(schedule.payout_methods,'Check or ACH');assert.equal(schedule.channels,'online,in_person');assert.equal(schedule.agreement_id,agreement.id);assert.equal(schedule.actor,'owner-fixture');assert.equal(schedule.accepted,null);
 assert.equal(JSON.parse(sql.prepare("SELECT detail FROM affiliate_events WHERE action='offer.attached'").get().detail).code,'LUPE10');
 portal=await p.affiliatePortal(db,partner.id,partner.email);assert.equal(portal.invitation,null);assert.equal(portal.schedule.code,'LUPE10');assert.equal(portal.member.status,'pending');
 listed=(await p.affiliateAdmin(db)).invitations.find(x=>x.email==='lupe@example.invalid');assert.equal(listed.member,partner.id);
 // Once they have applied, the terms live on the partner record: the invitation is neither editable nor sendable.
 await assert.rejects(inv.saveInvitationTerms(db,owner,{...lupe,commissionBps:2000},200000001),/already applied/);
 await assert.rejects(inv.sendInvitationEmail(env,owner,{email:'lupe@example.invalid'},deps(200000002)),/already applied/);
 // Revoking the used invitation leaves the partner's code working.
 await inv.setInvitationAccess(db,owner,{email:'lupe@example.invalid',active:false},200000003);assert.equal((await stored('LUPE10')).active,true);
 // Someone invited without terms gets no offer attached, exactly as before.
 await p.applyAffiliate(db,{id:'plain-fixture',email:'plain@example.invalid'},application,200000004);assert.equal(await p.affiliateSchedule(db,'plain-fixture'),null);

 // The offer cannot be signed until the owner has approved the talking points; then it carries the current version.
 let packet=await o.offerPacket(db,partner.id);assert.equal(packet.ready,false);assert.deepEqual(packet.missing,['tax details (W-9)','driver’s license photo','the one-page partner guide from Biomod']);
 await o.publishTalkingPoints(db,owner.id,{...o.defaultTalkingPoints,confirmed:true},200000005);assert.equal((await p.affiliateAdmin(db)).talkingPointsReady,true);
 await o.saveTaxProfile(db,vault,partner.id,{legalName:'Lupe Q Sample',businessName:'',classification:'individual',tinType:'ssn',tin:'123-45-6789',phone:'(775) 555-0100',address:{line1:'1 Test Way',city:'Reno',state:'NV',zip:'89501'}},200000006);
 await o.saveIdDocument(db,vault,partner.id,{side:'front',dataUrl:jpeg},200000007);
 packet=await o.offerPacket(db,partner.id);assert.equal(packet.ready,true);assert.equal(packet.packet.offer.code,'LUPE10');assert.equal(packet.packet.offer.customerDiscountPercent,10);assert.equal(packet.packet.offer.commissionPercent,15);
 assert.match(packet.packet.talkingPoints.body,/LUPE10 gives your customers 10% off/);assert.equal(packet.packet.talkingPoints.version,o.defaultTalkingPoints.version);
 await o.signOfferPacket(db,partner.id,{scheduleId:schedule.id,packetSha256:packet.sha256,typedName:'Lupe Q Sample',signature:png(60,20),consent:true,certify:true},{ip:'192.0.2.1',userAgent:'fixture'},200000008);
 await p.reviewAffiliate(db,'reviewer',{owner:partner.id,status:'approved',expectedUpdated:sql.prepare('SELECT updated FROM affiliate_members WHERE owner=?').get(partner.id).updated,code:'LUPE10',note:'Signed and verified'},200000009);
 // A paid order with LUPE10 earns Lupe her 15% of the products after the 10% discount.
 sql.prepare('INSERT INTO orders(id,owner,request_key,status,data,total,payment_ref,notification_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)').run('order-1','shopper','order-1','paid',JSON.stringify({email:'buyer@example.invalid',environment:'authorizenet:live',promo:{code:'LUPE10'},subtotal:20000,discount:2000}),19000,'pay-1','note-1',200000010,200000010);
 const earning=(await p.affiliateEarnings(db,partner.id,200000010+31*86400000))[0];assert.equal(earning.code,'LUPE10');assert.equal(earning.basisCents,18000);assert.equal(earning.commissionCents,2700);assert.equal(earning.state,'eligible');
 console.log('PASS: invitation terms create the store code, rename and revoke retire it, the invited person sees and signs them, the email is rebuilt server-side with mocked delivery, and a LUPE10 order pays 15% after a 10% discount.');
})().catch(e=>{console.error(e);process.exit(1);});
