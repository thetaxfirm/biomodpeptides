// Actual compiled Worker, local D1 and synthetic auth. No live providers or data.
import assert from 'node:assert/strict';
import {shippingWorkerFixture} from './shipping-worker-fixture-v1.mjs';
const f=await shippingWorkerFixture();
const origin='https://trybiomod.com',headers={origin,'content-type':'application/json',cookie:`bm_access=fixture-only; bm_session=${f.sessionId}`};
const call=async(body,admin=false)=>{const r=await f.mf.dispatchFetch(origin+'/api/affiliates'+(admin?'?admin=1':''),{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
try {
 let r=await call(null,true);assert.equal(r.status,200);assert.equal(r.body.open,false);
 r=await call({action:'publish',version:'worker-fixture',title:'Synthetic isolated terms',body:'Synthetic isolated contract fixture only. '.repeat(10),commissionBps:0,holdDays:0,minimumPayoutCents:50000,company:'Fixture Company',contact:'fixture@example.invalid',payoutSchedule:'Every 30 days',payoutMethods:'Individual schedule',confirmed:true});assert.equal(r.status,200,JSON.stringify(r.body));
 await call({action:'open',open:true});const agreement=(await call(null,true)).body.agreement;
 await call({action:'invite',email:'partner@example.invalid',active:true});
 const partner='00000001-0000-4000-8000-000000000099';f.authUser.id=partner;f.authUser.email='partner@example.invalid';
 r=await call({action:'apply',agreementId:agreement.id,accepted:true,guidelinesAccepted:true,name:'Synthetic partner',website:'https://example.invalid',audience:'Synthetic test audience for isolated testing.'});assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal((await call({action:'schedule',owner:partner,commissionBps:1200,holdDays:0,payoutMethods:'Test'})).status,400);
 f.authUser.id=f.owner;f.authUser.email=f.email;
 r=await call({action:'schedule',owner:partner,commissionBps:1200,holdDays:0,payoutMethods:'Test method'});assert.equal(r.status,200,JSON.stringify(r.body));
 f.authUser.id=partner;f.authUser.email='partner@example.invalid';r=await call();assert.equal(r.body.schedule.commission_bps,1200);assert.equal(r.body.schedule.accepted,null);
 r=await call({action:'acceptSchedule',scheduleId:r.body.schedule.id,accepted:true});assert.equal(r.status,200,JSON.stringify(r.body));
 f.authUser.id=f.owner;f.authUser.email=f.email;
 const member=(await call(null,true)).body.members[0];r=await call({action:'review',owner:partner,status:'approved',code:'ANNA20',note:'Isolated approval',expectedUpdated:member.updated});assert.equal(r.status,200,JSON.stringify(r.body));
 const redirect=await f.mf.dispatchFetch(origin+'/r/anna20',{redirect:'manual'});assert.equal(redirect.status,302);assert.match(redirect.headers.get('set-cookie'),/bm_promo=ANNA20/);
 assert.equal(f.calls.forbidden,0);assert.equal(f.calls.buys.length,0);assert.equal(f.calls.hosted.length,0);
 console.log('PASS: built Worker and local D1: application, owner-only individual schedule, partner acceptance, staff approval, referral cookie; no live side effects.');
} finally {await f.close();}
