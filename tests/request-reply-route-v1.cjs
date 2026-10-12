const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const file=path.resolve(__dirname,'../lib/request-reply-route.ts'),m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));let calls=0,fail=false;
m.require=name=>{assert.equal(name,'./request-replies');return {handleReplyBridge:async(env,payload)=>{calls++;if(fail)throw Error('PRIVATE DATABASE DETAIL');return {ok:true,action:payload.action};}};};m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const env={DB:{},REQUEST_REPLY_BRIDGE_TOKEN:'isolated-fixture-token-not-an-actual-key-1234567890'},url='https://store.example.invalid/api/store/reply-bridge';
const req=(body='{"action":"claim"}',headers={})=>new Request(url,{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+env.REQUEST_REPLY_BRIDGE_TOKEN,...headers},body});
(async()=>{
const run=m.exports.replyBridgeRoute;
assert.equal((await run(req(),{DB:{}})).status,503);
for(const token of ['', 'Bearer bad', 'Basic '+env.REQUEST_REPLY_BRIDGE_TOKEN,'Bearer '+env.REQUEST_REPLY_BRIDGE_TOKEN+'x','x'.repeat(301)])assert.equal((await run(req(undefined,{Authorization:token}),env)).status,401);
assert.equal(calls,0);
assert.equal((await run(req(undefined,{'content-type':'text/plain'}),env)).status,400);
assert.equal((await run(req(undefined,{'content-length':'300001'}),env)).status,413);
assert.equal((await run(req('x'.repeat(300001)),env)).status,413);
assert.equal((await run(req('bad json'),env)).status,400);assert.equal(calls,0);
const accepted=await run(req(),env);assert.equal(accepted.status,200);assert.match(accepted.headers.get('cache-control'),/no-store/);assert.equal(calls,1);
fail=true;const unavailable=await run(req(),env);assert.equal(unavailable.status,503);assert(!(await unavailable.text()).includes('PRIVATE'));
console.log('PASS: scoped bridge authenticates before dispatch, bounds streaming bodies and hides unexpected internal failures.');
})().catch(e=>{console.error(e);process.exitCode=1;});
