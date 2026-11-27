// Actual admin GET dispatch, isolated service boundaries; no customer or provider I/O.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..');let role='owner',calls=[];
const fail=name=>()=>{throw Error('Unexpected dependency '+name);};
const load=(file,deps={})=>{const filename=path.join(root,file),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(root);m.require=name=>deps[name]||new Proxy({}, {get:(_,key)=>key==='__esModule'?true:/Error|Conflict$/.test(String(key))?class extends Error{}:fail(name+':'+String(key))});require('./store-api-fixture.cjs').link(m);m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,filename);return m.exports;};
const staff=load('lib/staff.ts');
class Reply extends Response {static json(data,init={}){return new Reply(JSON.stringify(data),{...init,headers:{'content-type':'application/json',...init.headers}});}}
const service=(name,result)=>async()=>{calls.push(name);return result;};
const {GET}=load('app/api/store/[action]/route.ts',{
 'next/server':{NextResponse:Reply},'@/lib/staff':staff,
 '@/lib/auth':{customer:async()=>({id:'fixture'}),requireStaffAny:async()=>({role,email:'staff@example.invalid'})},
 '@/lib/runtime':{database:()=>({}),runtime:()=>({}),all:fail('legacy all-history bootstrap')},
 '@/lib/site-updates':{hasSiteUpdateAccess:async()=>role==='owner'},
 '@/lib/commerce':{catalog:service('products',[]),config:service('config',{packDiscounts:{},freeShippingAt:20000})},
 '@/lib/settings-version':{settingsSnapshot:service('settings-version',{version:'fixture'})},
 '@/lib/product-batch':{adminBatchRecords:service('batches',[])},
 '@/lib/checkout-recovery':{recoveryAdminStatus:service('recovery',{status:'fixture'})},
 '@/lib/coa-outbox':{coaAutomationStatus:service('automation',{})},
});
const get=async(section,nextRole='owner')=>{role=nextRole;calls=[];return GET({nextUrl:new URL('https://example.invalid/api/store/admin?section='+section)},{params:Promise.resolve({action:'admin'})});};
(async()=>{
 for(const section of ['overview','contacts','rewards','changes','traffic','promos','affiliates','updates']){const response=await get(section);assert.equal(response.status,200,section);const body=await response.json();assert.equal(body.section,section);assert.deepEqual(calls,[],section+' shell must not read other sections');assert.equal(body.orders,undefined);assert.equal(body.requests,undefined);assert.equal(body.products,undefined);}
 let response=await get('orders');assert.equal(response.status,200);assert.deepEqual(calls,['recovery']);
 response=await get('orders','catalog');assert.equal(response.status,403);assert.deepEqual(calls,[],'Catalog cannot read recovery data through a section selector');
 response=await get('overview','catalog');assert.equal(response.status,200);assert.equal((await response.json()).section,'products');assert.deepEqual(calls,['settings-version','config','products','batches']);
 response=await get('requests','support');assert.equal(response.status,200);assert.deepEqual(calls,[],'Inbox loads its own queue, without settings or recovery');
 response=await get('settings','fulfillment');assert.equal(response.status,403);assert.deepEqual(calls,[]);
 response=await get('unrecognized');assert.equal(response.status,400);assert.equal(response.headers.get('cache-control'),'no-store');
 console.log('PASS: section-specific reads, no unused bootstrap orders/messages, role-gated recovery, safe initial catalog destination and independent screen access.');
})().catch(e=>{console.error(e);process.exitCode=1;});
