// Actual compiled auth handlers, isolated migrations/cookies and synthetic provider only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { migrationStatements } from './sql-migration-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),built=path.join(root,'dist/server');
const config=JSON.parse(await fs.readFile(path.join(built,'wrangler.json'),'utf8'));
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'biomod-refresh-worker-'));
const files=(await fs.readdir(built,{recursive:true})).filter(n=>/\.(?:m?js)$/.test(n));
const email='refresh-fixture@example.invalid',session='11111111-1111-4111-8111-111111111111';
const jar=new Map([['bm_session',session],['bm_access','fixture-expired-access'],['bm_refresh','fixture-refresh-0']]);
let rotation=0,forbidden=0;const calls=[];
const mf=new Miniflare({name:'isolated-auth-refresh',cf:false,modules:[config.main,...files.filter(n=>n!==config.main)].map(n=>({type:'ESModule',path:path.join(built,n)})),modulesRoot:built,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,
 bindings:{SUPABASE_URL:'https://auth.example.invalid',SUPABASE_ANON_KEY:'fixture-public-key',STORE_ADMIN_EMAILS:email},d1Databases:{DB:'fixture-refresh'},d1Persist:path.join(temporary,'d1'),
 outboundService:async request=>{
  calls.push({url:request.url,method:request.method});
  if(request.url==='https://auth.example.invalid/auth/v1/token?grant_type=refresh_token'&&request.method==='POST'){
   const body=await request.json();
   if(body.refresh_token!=='fixture-refresh-'+rotation)return Response.json({message:'PRIVATE_FIXTURE_PROVIDER_ERROR'},{status:401});
   rotation++;return Response.json({access_token:'fixture-access-'+rotation,refresh_token:'fixture-refresh-'+rotation,expires_in:3600});
  }
  if(request.url==='https://auth.example.invalid/auth/v1/user'&&request.method==='GET'){
   if(rotation>0&&request.headers.get('authorization')==='Bearer fixture-access-'+rotation)return Response.json({id:'fixture-admin',email,email_confirmed_at:'2026-01-01',user_metadata:{name:'Fixture'}});
   return Response.json({message:'Expired synthetic token'},{status:401});
  }
  forbidden++;throw Error('Unapproved provider operation in isolated refresh fixture');
 },log:new Log(LogLevel.ERROR)});
try{
 await mf.ready;const db=await mf.getD1Database('DB');
 for(const name of(await fs.readdir(path.join(root,'drizzle'))).filter(n=>n.endsWith('.sql')).sort())await db.batch(migrationStatements(await fs.readFile(path.join(root,'drizzle',name),'utf8')).map(sql=>db.prepare(sql)));
 await db.prepare('INSERT INTO sessions(id,updated) VALUES(?,?)').bind(session,Date.now()).run();
 const cookie=()=>[...jar].map(([name,value])=>name+'='+value).join('; ');
 const call=(action,post=false,origin='https://trybiomod.com')=>mf.dispatchFetch('https://trybiomod.com/api/store/'+action,{method:post?'POST':'GET',headers:{cookie:cookie(),origin,'content-type':'application/json','cf-connecting-ip':'192.0.2.17'},...(post?{body:'{}'}:{})});
 assert.equal((await call('admin?section=overview')).status,403,'expired access cannot open administration');
 for(let i=0;i<14;i++){
  const response=await call('auth-refresh',true);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.deepEqual(await response.json(),{ok:true});assert.equal(response.headers.get('cache-control'),'no-store');
  const cookies=response.headers.getSetCookie();
  for(const name of ['bm_access','bm_refresh']){const header=cookies.find(value=>value.startsWith(name+'='));assert(header,name+' rotates');assert.match(header,/HttpOnly/i);assert.match(header,/Secure/i);assert.match(header,/SameSite=Lax/i);assert.match(header,/Path=\//i);jar.set(name,header.slice(name.length+1).split(';')[0]);}
  assert.equal(jar.get('bm_access'),'fixture-access-'+(i+1));assert.equal(jar.get('bm_refresh'),'fixture-refresh-'+(i+1));
 }
 assert.equal(rotation,14,'routine page refresh remains available after the twelfth navigation');
 const access=await call('admin?section=overview');assert.equal(access.status,200);const data=await access.json();assert.equal(data.role,'owner');assert(!JSON.stringify(data).includes('fixture-access-'));
 const count=calls.length;assert.equal((await call('auth-refresh',true,'https://other.invalid')).status,403);assert.equal(calls.length,count,'origin guard precedes provider rotation');
 jar.set('bm_refresh','fixture-invalid-refresh');const denied=await call('auth-refresh',true);assert.equal(denied.status,400);const deniedBody=JSON.stringify(await denied.json());assert(!deniedBody.includes('PRIVATE_FIXTURE'));assert(!deniedBody.includes('fixture-invalid-refresh'));assert(!denied.headers.getSetCookie().some(s=>/^bm_(access|refresh)=/.test(s)));assert.equal(rotation,14);
 jar.delete('bm_refresh');const beforeMissing=calls.length;assert.deepEqual(await(await call('auth-refresh',true)).json(),{ok:true});assert.equal(calls.length,beforeMissing,'missing refresh cookie is a no-op');
 const refreshKey=(await db.prepare("SELECT key FROM rate_limits WHERE key LIKE 'auth-refresh:%'").first()).key;
 await db.prepare('UPDATE rate_limits SET count=120,expires=? WHERE key=?').bind(Date.now()+600000,refreshKey).run();const beforeLimit=calls.length;const limited=await call('auth-refresh',true);assert.equal(limited.status,400);assert.match((await limited.json()).error,/Too many requests/);assert.equal(calls.length,beforeLimit,'refresh remains bounded before provider calls');
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM orders').first()).n,0);assert.equal(forbidden,0);
 console.log('PASS: compiled refresh recovers expired access, rotates HttpOnly/Secure/SameSite cookies fourteen times, preserves protected access, rejects invalid refresh without token leakage, keeps missing-cookie no-op and enforces origin plus120-request budget. Only synthetic auth provider.');
}finally{await mf.dispose();await fs.rm(temporary,{recursive:true,force:true});}
