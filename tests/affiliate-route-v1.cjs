const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const filename=path.resolve(__dirname,'../app/api/affiliates/route.ts');let user={id:'one'},role='support',calls=[];
const m=new Module(filename,module);m.filename=filename;m.require=id=>{
 if(id==='next/server')return{NextResponse:{json:(data,init)=>Response.json(data,init)}};
 if(id==='@/lib/auth')return{requireCustomer:async()=>{if(!user)throw Error('no account');return user;},requireStaff:async()=>{if(!user||!['owner','manager'].includes(role))throw Error('forbidden');return{...user,role};}};
 if(id==='@/lib/runtime')return{database:()=>({})};
 if(id==='@/lib/affiliate-program')return Object.fromEntries(['affiliatePortal','affiliateAdmin','publishAgreement','setAffiliateOpen','applyAffiliate','acceptAffiliateAgreement','reviewAffiliate','reviewCommission','offerAffiliateSchedule','acceptAffiliateSchedule'].map(name=>[name,async(...args)=>{calls.push([name,...args]);return{ok:true};}]));
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
 role='owner';assert.equal((await m.exports.POST(req({action:'publish'}))).status,200);assert.equal(calls.pop()[0],'publishAgreement');
 assert.equal((await m.exports.POST(req({action:'schedule'}))).status,200);assert.equal(calls.pop()[0],'offerAffiliateSchedule');
 await m.exports.POST(req({action:'acceptSchedule',owner:'forged'}));assert.equal(calls.pop()[2],'one');
 user=null;assert.equal((await m.exports.GET(req())).status,403);
 assert.equal((await m.exports.POST(req({action:'apply'}))).status,400);
 assert.equal((await m.exports.POST(req({action:'apply',body:'x'.repeat(31000)}))).status,413);
 console.log('Affiliate API authorization, session ownership, owner-only terms, CSRF and payload limits passed.');
})().catch(e=>{console.error(e);process.exit(1);});
