// Shared isolated built-Worker fixture. Synthetic data only; every outbound provider is intercepted.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {migrationStatements} from './sql-migration-fixture.mjs';
export async function shippingWorkerFixture({preview=false,port=3067}={}) {
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),built=path.join(root,'dist/server');
 const config=JSON.parse(await fs.readFile(path.join(built,'wrangler.json'),'utf8'));
 const files=(await fs.readdir(built,{recursive:true})).filter(n=>/\.(?:m?js)$/.test(n));
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'biomod-shipping-worker-'));
 const owner='00000001-0000-4000-8000-000000000021',sessionId='00000001-0000-4000-8000-000000000022',email='shipping-fixture@example.invalid';
 const user={id:owner,email,email_confirmed_at:'2026-01-01',user_metadata:{name:'Synthetic shipping preview'}};
 const bindings={SUPABASE_URL:'https://auth.example.invalid',SUPABASE_ANON_KEY:'fixture-only',STORE_ADMIN_EMAILS:email,EASYPOST_API_KEY:'EZAK_isolated_fixture',AUTHORIZENET_ENVIRONMENT:'live',AUTHORIZENET_API_LOGIN_ID:'fixtureLogin',AUTHORIZENET_TRANSACTION_KEY:'A'.repeat(16),AUTHORIZENET_SIGNATURE_KEY:'B'.repeat(128),AUTHORIZENET_RETURN_URL:'https://trybiomod.com/payment/return',AUTHORIZENET_CONNECTION_VERIFIED:'true',COMMERCE_MODE:'live',COMMERCE_FULFILLMENT_VERIFIED:'true',FIXED_TAX_RATE:'8.375',FIXED_TAX_STATE:'NV'};
 const calls={rates:0,buys:[],hosted:[],paymentReads:[],forbidden:0};
 const rates=[{id:'rate_ground',carrier:'USPS',service:'GroundAdvantage',rate:'9.00',currency:'USD',delivery_days:3},{id:'rate_expedited',carrier:'UPS',service:'2ndDayAir',rate:'15.00',currency:'USD',delivery_days:2},{id:'rate_overnight',carrier:'UPSDAP',service:'NextDayAir',rate:'25.00',currency:'USD',delivery_days:1}];
 const mf=new Miniflare({name:'isolated-shipping',...(preview?{host:'127.0.0.1',port}:{}),cf:false,modules:[config.main,...files.filter(n=>n!==config.main)].map(n=>({type:'ESModule',path:path.join(built,n)})),modulesRoot:built,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,assets:{directory:path.join(root,'dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:false}},bindings,d1Databases:{DB:'isolated-shipping'},d1Persist:path.join(temporary,'d1'),outboundService:async req=>{
  if(req.url==='https://auth.example.invalid/auth/v1/user'&&req.method==='GET')return Response.json(user);
  if(preview&&req.url.startsWith('https://auth.example.invalid/auth/v1/token?')&&req.method==='POST')return Response.json({user,access_token:'isolated-preview-only',refresh_token:'isolated-refresh-only',expires_in:3600});
  if(req.url==='https://api.easypost.com/v2/shipments'&&req.method==='POST'){calls.rates++;return Response.json({id:'shp_fixture',mode:'production',rates});}
  if(req.url==='https://api.easypost.com/v2/shipments/shp_fixture/buy'&&req.method==='POST'){calls.buys.push(await req.json());return Response.json({id:'shp_fixture',mode:'production',tracking_code:'SYNTHETIC_ONLY',postage_label:{label_url:'https://example.invalid/label'},tracker:{public_url:'https://example.invalid/tracking'}});}
  if(req.url==='https://api.authorize.net/xml/v1/request.api'&&req.method==='POST'){
   const body=await req.json(),kind=Object.keys(body)[0];
   if(kind==='getUnsettledTransactionListRequest'||kind==='getSettledBatchListRequest'){calls.paymentReads.push(kind);return Response.json({messages:{resultCode:'Ok'},...(kind==='getSettledBatchListRequest'?{batchList:[]}:{transactions:[]})});}
   if(kind==='getHostedPaymentPageRequest'){calls.hosted.push(body[kind]);return preview?Response.json({messages:{resultCode:'Error',message:[{code:'FIXTURE_ONLY',text:'Payment navigation is blocked in the isolated preview.'}]}}):Response.json({messages:{resultCode:'Ok'},token:'isolated-form-token'});}
  }
  calls.forbidden++;throw Error('External request prohibited in isolated shipping fixture');
 },log:new Log(LogLevel.ERROR)});
 try {
  await mf.ready;const db=await mf.getD1Database('DB');
  for(const name of(await fs.readdir(path.join(root,'drizzle'))).filter(n=>n.endsWith('.sql')).sort())await db.batch(migrationStatements(await fs.readFile(path.join(root,'drizzle',name),'utf8')).map(sql=>db.prepare(sql)));
  const catalog=JSON.parse(await fs.readFile(path.join(root,'lib/catalog-facts-v2.json'),'utf8'));
  const product=catalog.find(p=>p.slug==='bpc-157-10mg');
  for(const p of catalog.filter(p=>p.purchasable))await db.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(p.id,JSON.stringify({stockQuantity:25,...(p.id===product.id?{price:20000,inStock:true,purchasable:true,maxQuantity:25,sale:null,packPrices:{}}:{})})).run();
  const cart=[{id:product.id,quantity:1}];
  await db.prepare('INSERT INTO sessions(id,cart,wishlist,updated) VALUES(?,?,?,?)').bind(sessionId,'[]','[]',Date.now()).run();
  await db.prepare('INSERT INTO customer_carts(id,cart,updated) VALUES(?,?,?)').bind(owner,JSON.stringify(cart),Date.now()).run();
  const shippingOptions={standardEnabled:true,expeditedEnabled:true,overnightEnabled:true,freeStandardEnabled:true,standardHandlingCents:0,expeditedHandlingCents:0,overnightHandlingCents:1000,carriers:['USPS','UPS']};
  const store={packDiscounts:{1:0,3:10,5:15,10:20},shippingCents:700,freeShippingAt:20000,presalesEnabled:false,rewardsEnabled:false,affiliateEnabled:false,shippingOptions};
  await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('store',JSON.stringify(store)).run();
  const address={name:'Synthetic shipping preview',line1:'1 Example Road',line2:'',city:'Las Vegas',state:'NV',zip:'89101',country:'US',phone:'7025550100'};
  await db.prepare('INSERT INTO addresses(id,owner,data,created) VALUES(?,?,?,?)').bind('fixture-address',owner,JSON.stringify(address),Date.now()).run();
  return {mf,db,calls,owner,email,sessionId,store,product,cart,address,close:async()=>{await mf.dispose();await fs.rm(temporary,{recursive:true,force:true});}};
 } catch(error) {await mf.dispose();await fs.rm(temporary,{recursive:true,force:true});throw error;}
}
