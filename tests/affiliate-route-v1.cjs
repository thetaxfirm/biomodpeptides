const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const filename=path.resolve(__dirname,'../app/api/affiliates/route.ts');let user={id:'one',email:'one@example.invalid'},role='support',calls=[],fail=null;
const m=new Module(filename,module);m.filename=filename;m.require=id=>{
 if(id==='next/server')return{NextResponse:{json:(data,init)=>Response.json(data,init)}};
 if(id==='@/lib/auth')return{requireCustomer:async()=>{if(!user)throw Error('no account');return user;},requireStaff:async()=>{if(!user||!['owner','manager'].includes(role))throw Error('forbidden');return{...user,role};}};
 if(id==='@/lib/runtime')return{database:()=>({}),runtime:()=>({RESEND_API_KEY:'fixture-only'})};
 if(id==='@/lib/affiliate-program')return Object.fromEntries(['affiliatePortal','affiliateAdmin','publishAgreement','setAffiliateOpen','applyAffiliate','acceptAffiliateAgreement','reviewAffiliate','reviewCommission','offerAffiliateSchedule','acceptAffiliateSchedule','inviteAffiliate'].map(name=>[name,async(...args)=>{calls.push([name,...args]);return{ok:true};}]));
 if(id==='@/lib/affiliate-invitations')return Object.fromEntries(['saveInvitationTerms','setInvitationAccess','sendInvitationEmail'].map(name=>[name,async(...args)=>{calls.push([name,...args]);if(fail)throw fail;return{ok:true};}]));
 throw Error(id);
};m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,filename);
function req(body,admin=false,origin='https://example.invalid'){const r=new Request('https://example.invalid/api/affiliates'+(admin?'?admin=1':''),body?{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}:{});r.nextUrl=new URL(r.url);return r;}
(async()=>{
 assert.equal((await m.exports.GET(req(null,true))).status,403);assert.equal(calls.length,0);
 await m.exports.GET(req());assert.equal(calls.pop()[2],'one','Owner scope derives from session');
 assert.equal((await m.exports.POST(req({action:'review',owner:'other'}))).status,400);assert.equal(calls.length,0);
 assert.equal((await m.exports.POST(req({action:'apply'},false,'https://attacker.invalid'))).status,403);
 role='manager';assert.equal((await m.exports.POST(req({action:'publish'}))).status,403);
 assert.equal((await m.exports.POST(req({action:'open',open:true}))).status,403);
 assert.equal((await m.exports.POST(req({action:'schedule'}))).status,403);
 assert.equal((await m.exports.POST(req({action:'invite'}))).status,403);
 // Terms and the invitation email are the owner's alone: a manager cannot promise a commission or send in the store's name.
 assert.equal((await m.exports.POST(req({action:'inviteTerms',email:'lupe@example.invalid'}))).status,403);
 assert.equal((await m.exports.POST(req({action:'inviteEmail',email:'lupe@example.invalid'}))).status,403);assert.equal(calls.length,0);
 role='owner';assert.equal((await m.exports.POST(req({action:'publish'}))).status,200);assert.equal(calls.pop()[0],'publishAgreement');
 assert.equal((await m.exports.POST(req({action:'invite',email:'lupe@example.invalid',active:false}))).status,200);
 let call=calls.pop();assert.equal(call[0],'setInvitationAccess');assert.deepEqual(call[2],{id:'one',email:'one@example.invalid'},'The actor comes from the session, never the request');
 assert.equal((await m.exports.POST(req({action:'inviteTerms',email:'lupe@example.invalid',name:'Lupe',discountPercent:10,commissionBps:1500,actor:'forged'}))).status,200);
 call=calls.pop();assert.equal(call[0],'saveInvitationTerms');assert.deepEqual(call[2],{id:'one',email:'one@example.invalid'});assert.equal(call[3].commissionBps,1500);
 assert.equal((await m.exports.POST(req({action:'inviteEmail',email:'lupe@example.invalid',note:'Hello'}))).status,200);
 call=calls.pop();assert.equal(call[0],'sendInvitationEmail');assert.equal(call[1].RESEND_API_KEY,'fixture-only','The mail binding comes from the runtime');assert.equal(call[3].note,'Hello');
 // The form's own messages reach the owner; anything unrecognised stays generic.
 fail=Object.assign(Error('zod'),{issues:[{message:'Enter the partner’s name.'}]});let res=await m.exports.POST(req({action:'inviteTerms'}));assert.equal(res.status,400);assert.equal((await res.json()).error,'Enter the partner’s name.');
 fail=Error('LUPE10 already belongs to another partner. Choose a different code.');assert.equal((await (await m.exports.POST(req({action:'inviteTerms'}))).json()).error,fail.message);
 fail=Error('The email provider did not confirm this invitation. It may or may not have gone out, so check before sending it again.');assert.equal((await (await m.exports.POST(req({action:'inviteEmail'}))).json()).error,fail.message);
 fail=Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: affiliate_invitations.code');assert.match((await (await m.exports.POST(req({action:'inviteTerms'}))).json()).error,/^Could not save\./);
 fail=null;calls=[];
 assert.equal((await (await m.exports.GET(req(null,true))).json()).mailReady,true);calls.pop();
 assert.equal((await m.exports.POST(req({action:'schedule'}))).status,200);assert.equal(calls.pop()[0],'offerAffiliateSchedule');
 await m.exports.POST(req({action:'acceptSchedule',owner:'forged'}));assert.equal(calls.pop()[2],'one');
 user=null;assert.equal((await m.exports.GET(req())).status,403);
 assert.equal((await m.exports.POST(req({action:'apply'}))).status,400);
 assert.equal((await m.exports.POST(req({action:'apply',body:'x'.repeat(31000)}))).status,413);
 console.log('Affiliate API authorization, session ownership, owner-only terms and invitations, safe error text, CSRF and payload limits passed.');
})().catch(e=>{console.error(e);process.exit(1);});
