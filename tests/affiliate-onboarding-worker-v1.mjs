// Actual compiled Worker, local D1 and synthetic auth: invite, apply, offer with code, W-9, license
// photo, drawn signature, approval, signed packet, payout, 1099 CSV and contacts. No live providers.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {shippingWorkerFixture} from './shipping-worker-fixture-v1.mjs';
const f=await shippingWorkerFixture({extraBindings:{AFFILIATE_VAULT_KEY:Buffer.alloc(32,9).toString('base64')}});
const origin='https://trybiomod.com',headers={origin,'content-type':'application/json',cookie:`bm_access=fixture-only; bm_session=${f.sessionId}`,'cf-connecting-ip':'192.0.2.44'};
const call=async(route,body,admin=false)=>{const r=await f.mf.dispatchFetch(origin+route+(admin?'?admin=1':''),{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});const text=await r.text();let parsed;try{parsed=JSON.parse(text);}catch{parsed=text;}return {status:r.status,body:parsed,type:r.headers.get('content-type'),cache:r.headers.get('cache-control')};};
const as=(id,email)=>{f.authUser.id=id;f.authUser.email=email;};
function png(w,h){const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}const crc=b=>{let c=0xffffffff;for(const x of b)c=t[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;};const chunk=(k,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const kd=Buffer.concat([Buffer.from(k),d]);const r=Buffer.alloc(4);r.writeUInt32BE(crc(kd));return Buffer.concat([l,kd,r]);};const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;const raw=Buffer.concat(Array.from({length:h},(_,y)=>Buffer.concat([Buffer.from([0]),Buffer.from(Array.from({length:w*3},(_,i)=>(i*7+y*13)%251))])));return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw,{level:0})),chunk('IEND',Buffer.alloc(0))]);}
const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=','base64');
try {
 const partner='00000001-0000-4000-8000-000000000077',pmail='partner@example.invalid';
 assert.equal((await call('/api/affiliates',{action:'invite',email:pmail,active:true})).status,200);
 const agreement=(await call('/api/affiliates',null,true)).body.agreement;
 as(partner,pmail);
 assert.equal((await call('/api/affiliates',{action:'apply',agreementId:agreement.id,accepted:true,guidelinesAccepted:true,name:'Synthetic partner',website:'https://example.invalid',audience:'Synthetic audience for isolated testing.'})).status,200);
 // Partners cannot use owner actions or open the vault.
 assert.equal((await call('/api/affiliates/onboarding',{action:'offer',owner:partner,code:'SELF50',discountPercent:50,commissionBps:9000,holdDays:0,payoutMethods:'x',channels:['online']})).status,400);
 assert.equal((await call('/api/affiliates/vault?export1099=2026')).status,403);
 let r=await call('/api/affiliates/onboarding');assert.equal(r.status,200);assert.equal(r.body.vaultReady,true);assert.equal(r.cache,'no-store');assert.equal(r.body.packet.ready,false);
 r=await call('/api/affiliates/onboarding',{action:'tax',tax:{legalName:'Pat Q Sample',businessName:'',classification:'individual',tinType:'ssn',tin:'123-45-6789',phone:'7755550100',address:{line1:'1 Test Way',line2:'',city:'Reno',state:'NV',zip:'89501'}}});assert.equal(r.status,200,JSON.stringify(r.body));
 r=await call('/api/affiliates/onboarding',{action:'tax',tax:{legalName:'Pat',classification:'individual',tinType:'ssn',tin:'12',phone:'7755550100',address:{line1:'1 Test Way',city:'Reno',state:'NV',zip:'89501'}}});assert.equal(r.status,400);assert.match(r.body.error,/tin: Enter all 9 digits/);
 r=await call('/api/affiliates/onboarding',{action:'id',side:'front',dataUrl:'data:image/jpeg;base64,'+jpeg.toString('base64')});assert.equal(r.status,200,JSON.stringify(r.body));
 r=await f.mf.dispatchFetch(origin+'/api/affiliates/onboarding',{method:'POST',headers,body:JSON.stringify({action:'id',side:'back',dataUrl:'data:image/jpeg;base64,'+'A'.repeat(1500000)})});assert.equal(r.status,413);await r.text();
 const portal=(await call('/api/affiliates/onboarding')).body;assert.equal(portal.tax.tin_last4,'6789');assert.ok(!JSON.stringify(portal).includes('123456789'));assert.deepEqual(portal.packet.missing,['an offer from Biomod']);
 // Owner publishes talking points and sends the offer; the store code is created at 10%.
 as(f.owner,f.email);
 let admin=(await call('/api/affiliates/onboarding',null,true)).body;assert.equal(admin.canOwn,true);assert.equal(admin.taxes[0].tin_last4,'6789');assert.ok(!JSON.stringify(admin).includes('123456789'));assert.ok(!JSON.stringify(admin).includes('/9j/'));
 assert.equal((await call('/api/affiliates/onboarding',{action:'talkingPoints',...admin.defaultTalkingPoints,confirmed:true})).status,200);
 r=await call('/api/affiliates/onboarding',{action:'offer',owner:partner,code:'drmatt10',discountPercent:10,commissionBps:2000,holdDays:30,payoutMethods:'Check',channels:['online','in_person']});assert.equal(r.status,200,JSON.stringify(r.body));
 const promos=await f.mf.dispatchFetch(origin+'/api/admin/promo-codes',{headers});assert.ok((await promos.json()).custom.some(p=>p.code==='DRMATT10'&&p.percentOff===10&&p.active));
 // Partner signs the exact packet with a drawn signature.
 as(partner,pmail);
 const packet=(await call('/api/affiliates/onboarding')).body.packet;assert.equal(packet.ready,true);assert.equal(packet.packet.offer.code,'DRMATT10');
 r=await call('/api/affiliates/onboarding',{action:'sign',scheduleId:packet.packet.offer.scheduleId,packetSha256:packet.sha256,typedName:'Pat Q Sample',signature:'data:image/png;base64,'+png(60,20).toString('base64'),consent:true,certify:true});assert.equal(r.status,200,JSON.stringify(r.body));
 const signatureId=r.body.signatureId;
 r=await call('/api/affiliates/vault?packet='+signatureId);assert.equal(r.status,200);assert.match(r.type,/text\/html/);assert.match(r.body,/Integrity check passed/);assert.match(r.body,/DRMATT10/);assert.match(r.body,/192\.0\.2\.44/);assert.ok(!r.body.includes('123456789'));
 // Approval, owner-only reveals with audit, payout, 1099 and contacts.
 as(f.owner,f.email);
 const member=(await call('/api/affiliates',null,true)).body.members[0];
 r=await call('/api/affiliates',{action:'review',owner:partner,status:'approved',code:'DRMATT10',note:'Signed packet and license checked',expectedUpdated:member.updated});assert.equal(r.status,200,JSON.stringify(r.body));
 const redirect=await f.mf.dispatchFetch(origin+'/r/drmatt10',{redirect:'manual'});assert.equal(redirect.status,302);assert.match(redirect.headers.get('set-cookie'),/bm_promo=DRMATT10/);
 admin=(await call('/api/affiliates/onboarding',null,true)).body;
 r=await f.mf.dispatchFetch(origin+'/api/affiliates/vault?id='+admin.ids[0].id,{headers});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/jpeg');assert.deepEqual(Buffer.from(await r.arrayBuffer()),jpeg);
 r=await call('/api/affiliates/vault?tin='+partner);assert.equal(r.body.tin,'123-45-6789');
 assert.equal((await call('/api/affiliates/onboarding',{action:'payout',owner:partner,amountCents:250000,paidOn:'2026-12-01',method:'Check'})).status,400);
 assert.equal((await call('/api/affiliates/onboarding',{action:'taxReview',owner:partner,status:'verified',note:''})).status,200);
 assert.equal((await call('/api/affiliates/onboarding',{action:'manualSale',owner:partner,soldOn:'2026-11-03',basisCents:5000,note:'Booth receipt 7'})).status,200);
 assert.equal((await call('/api/affiliates/onboarding',{action:'payout',owner:partner,amountCents:250000,paidOn:'2026-12-01',method:'Check',reference:'1001'})).status,200);
 r=await call('/api/affiliates/vault?report1099=2026');assert.equal(r.body.rows[0].reportable,true);assert.equal(r.body.thresholdCents,200000);
 r=await call('/api/affiliates/vault?export1099=2026');assert.match(r.type,/text\/csv/);assert.match(r.body,/"Pat Q Sample".*"123456789".*"2500\.00"/);
 r=await call('/api/admin/contacts');assert.equal(r.status,200);assert.ok(r.body.contacts.some(c=>c.email===pmail&&c.phones.includes('7755550100')));
 r=await call('/api/admin/contacts?format=csv');assert.match(r.type,/text\/csv/);assert.match(r.body,/partner@example\.invalid/);
 const audit=(await f.db.prepare("SELECT action FROM affiliate_events WHERE action IN ('id.viewed','tax.revealed','tax.exported1099','packet.signed','offer.sent')").all()).results.map(x=>x.action).sort();
 assert.deepEqual(audit,['id.viewed','offer.sent','packet.signed','tax.exported1099','tax.revealed']);
 as(partner,pmail);assert.equal((await call('/api/admin/contacts')).status,403);assert.equal((await call('/api/affiliates/vault?tin='+partner)).status,403);
 assert.equal(f.calls.forbidden,0);assert.equal(f.calls.buys.length,0);assert.equal(f.calls.hosted.length,0);
 console.log('PASS: built Worker and local D1: invited application, encrypted W-9 and license photo, owner offer creating DRMATT10 at 10%, signed packet with integrity check, approval and referral cookie, audited owner reveals, in-person credit, payout, 1099 CSV and contacts; no live side effects.');
} finally {await f.close();}
