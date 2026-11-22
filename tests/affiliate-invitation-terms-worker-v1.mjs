// Actual compiled Worker, local D1 and synthetic auth: the owner invites a partner with their terms,
// the code prices a real cart quote and appears under Promo codes, the invitation email goes to a
// stubbed mail provider, and the invited person finds the terms waiting and applies. No live providers.
import assert from 'node:assert/strict';
import {shippingWorkerFixture} from './shipping-worker-fixture-v1.mjs';
const mail=[];let mailReply=()=>Response.json({id:'provider-fixture-1'});
const f=await shippingWorkerFixture({extraBindings:{AFFILIATE_VAULT_KEY:Buffer.alloc(32,9).toString('base64'),RESEND_API_KEY:'re_fixture_only'},
 extraOutbound:async req=>{if(req.url!=='https://api.resend.com/emails'||req.method!=='POST')return null;mail.push({auth:req.headers.get('authorization'),key:req.headers.get('idempotency-key'),body:await req.json()});return mailReply();}});
const origin='https://trybiomod.com',headers={origin,'content-type':'application/json',cookie:`bm_access=fixture-only; bm_session=${f.sessionId}`,'cf-connecting-ip':'192.0.2.44'};
const call=async(route,body,admin=false)=>{const r=await f.mf.dispatchFetch(origin+route+(admin?'?admin=1':''),{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});const text=await r.text();let parsed;try{parsed=JSON.parse(text);}catch{parsed=text;}return {status:r.status,body:parsed,cache:r.headers.get('cache-control')};};
const as=(id,email)=>{f.authUser.id=id;f.authUser.email=email;};
try {
 const partner='00000001-0000-4000-8000-000000000088',pmail='lupe@example.invalid';
 // Owner: one save sets the name, the customer discount and the commission, and creates the code.
 let r=await call('/api/affiliates',{action:'inviteTerms',email:pmail,name:'Lupe',discountPercent:10,commissionBps:1500});assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.code,'LUPE10');assert.match(r.body.message,/LUPE10 works at checkout now/);
 r=await call('/api/affiliates',{action:'inviteTerms',email:pmail,name:'',discountPercent:10,commissionBps:1500});assert.equal(r.status,400);assert.equal(r.body.error,'Enter the partner’s name.');
 r=await call('/api/affiliates',{action:'inviteTerms',email:'other@example.invalid',name:'Lupe',discountPercent:10,commissionBps:1000});assert.equal(r.status,400);assert.match(r.body.error,/LUPE10 already belongs to another partner/);
 let admin=(await call('/api/affiliates',null,true)).body;
 assert.equal(admin.mailReady,true);assert.equal(admin.talkingPointsReady,false);
 let listed=admin.invitations.find(x=>x.email===pmail);assert.equal(listed.code,'LUPE10');assert.equal(listed.discount_percent,10);assert.equal(listed.commission_bps,1500);assert.equal(listed.member,null);assert.equal(listed.email_status,null);
 // The rest of the site: Promo codes lists it, and the real quote takes 10% off the fixture cart.
 const promos=await (await f.mf.dispatchFetch(origin+'/api/admin/promo-codes',{headers})).json();
 const custom=promos.custom.find(x=>x.code==='LUPE10');assert.equal(custom.percentOff,10);assert.equal(custom.active,true);assert.match(custom.by,/for partner Lupe$/);
 r=await call('/api/store/promo',{code:'lupe10'});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.promo.code,'LUPE10');assert.equal(r.body.promo.percentOff,10);assert.equal(r.body.promo.savings,2000);
 await call('/api/store/promo',{code:''});
 // The share link earns nothing and applies nothing until the partner is approved.
 let redirect=await f.mf.dispatchFetch(origin+'/r/lupe10',{redirect:'manual'});assert.equal(redirect.status,302);assert.equal(redirect.headers.get('set-cookie'),null);
 // The invitation email: only the address and the owner's note leave the browser.
 r=await call('/api/affiliates',{action:'inviteEmail',email:pmail,note:'Great meeting you.'});assert.equal(r.status,200,JSON.stringify(r.body));assert.match(r.body.message,/Invitation emailed to lupe@example\.invalid with code LUPE10/);
 assert.equal(mail.length,1);assert.equal(mail[0].auth,'Bearer re_fixture_only');assert.match(mail[0].key,/^affiliate-invitation-/);
 assert.equal(mail[0].body.from,'Biomod Partner Program <contact@trybiomod.com>');assert.deepEqual(mail[0].body.to,[pmail]);assert.equal(mail[0].body.subject,'Your Biomod partner invitation: code LUPE10');
 for(const line of ['Hi Lupe,','Great meeting you.','Your code: LUPE10','Your customers get 10% off at trybiomod.com, online and in person.','You earn 15% of each sale made with your code.','once they reach $500, after a 30-day hold.','https://trybiomod.com/account/affiliate'])assert.ok(mail[0].body.text.includes(line),line);
 assert.ok(mail[0].body.html.includes('LUPE10</strong>'));
 listed=(await call('/api/affiliates',null,true)).body.invitations.find(x=>x.email===pmail);assert.equal(listed.email_status,'accepted');assert.ok(listed.emailed>0);
 mailReply=()=>Response.json({message:'rejected'},{status:422});
 r=await call('/api/affiliates',{action:'inviteEmail',email:pmail});assert.equal(r.status,400);assert.match(r.body.error,/rejected this invitation, so nothing was sent/);
 // A partner cannot set terms or send invitations, for themselves or anyone else.
 as(partner,pmail);
 assert.equal((await call('/api/affiliates',{action:'inviteTerms',email:pmail,name:'Lupe',discountPercent:50,commissionBps:9000})).status,400);
 assert.equal((await call('/api/affiliates',{action:'inviteEmail',email:pmail})).status,400);assert.equal(mail.length,2);
 // The invited person signs in and the terms are waiting, before they have applied.
 let portal=(await call('/api/affiliates')).body;assert.equal(portal.member,null);assert.equal(portal.invitation.code,'LUPE10');assert.equal(portal.invitation.discount_percent,10);assert.equal(portal.invitation.commission_bps,1500);
 r=await call('/api/affiliates',{action:'apply',agreementId:portal.agreement.id,accepted:true,guidelinesAccepted:true,name:'Lupe Sample',website:'https://example.invalid',audience:'Synthetic audience for isolated testing.'});
 assert.equal(r.status,200,JSON.stringify(r.body));assert.match(r.body.message,/Your offer is ready below/);
 portal=(await call('/api/affiliates')).body;assert.equal(portal.schedule.code,'LUPE10');assert.equal(portal.schedule.commission_bps,1500);assert.equal(portal.invitation,null);
 // Signing waits for the W-9, the license photo and the owner's approved talking points.
 let packet=(await call('/api/affiliates/onboarding')).body.packet;assert.equal(packet.ready,false);assert.deepEqual(packet.missing,['tax details (W-9)','driver’s license photo','the one-page partner guide from Biomod']);
 // The owner sees the offer already on the partner, and the invitation marked as applied.
 as(f.owner,f.email);
 admin=(await call('/api/affiliates',null,true)).body;assert.equal(admin.invitations.find(x=>x.email===pmail).member,partner);assert.equal(admin.schedules.find(x=>x.owner===partner).code,'LUPE10');
 const onboarding=(await call('/api/affiliates/onboarding',null,true)).body;const offer=onboarding.offers.find(x=>x.owner===partner);assert.equal(offer.code,'LUPE10');assert.equal(offer.discount_percent,10);assert.equal(offer.commission_bps,1500);
 assert.equal((await call('/api/affiliates/onboarding',{action:'talkingPoints',...onboarding.defaultTalkingPoints,confirmed:true})).status,200);
 as(partner,pmail);packet=(await call('/api/affiliates/onboarding')).body.packet;assert.deepEqual(packet.missing,['tax details (W-9)','driver’s license photo']);
 as(f.owner,f.email);
 r=await call('/api/affiliates',{action:'inviteTerms',email:pmail,name:'Lupe',discountPercent:15,commissionBps:1500});assert.equal(r.status,400);assert.match(r.body.error,/already applied/);
 // Revoking an unused invitation switches its code off everywhere.
 assert.equal((await call('/api/affiliates',{action:'inviteTerms',email:'dana@example.invalid',name:'Dana',discountPercent:10,commissionBps:1000})).status,200);
 r=await call('/api/affiliates',{action:'invite',email:'dana@example.invalid',active:false});assert.equal(r.status,200);assert.match(r.body.message,/Code DANA10 was switched off/);
 r=await call('/api/store/promo',{code:'dana10'});assert.equal(r.status,400);
 const audit=(await f.db.prepare("SELECT action FROM affiliate_events WHERE action IN ('invitation.terms','invitation.emailed','offer.attached') ORDER BY created,rowid").all()).results.map(x=>x.action);
 assert.deepEqual(audit.filter(x=>x==='offer.attached').length,1);assert.equal(audit.filter(x=>x==='invitation.emailed').length,2);assert.equal(audit.filter(x=>x==='invitation.terms').length,2);
 assert.equal(f.calls.forbidden,0);assert.equal(f.calls.buys.length,0);assert.equal(f.calls.hosted.length,0);
 console.log('PASS: built Worker and local D1: an invitation saved with LUPE10, 10% for customers and 15% to the partner appears under Promo codes and prices a real quote, the invitation email reaches only the stubbed provider, the invited person finds the terms waiting and applies into a ready offer, and a revoked invitation takes its code down; no live side effects.');
} finally {await f.close();}
