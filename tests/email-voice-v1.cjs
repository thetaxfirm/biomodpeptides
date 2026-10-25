// Email voice rules (owner, Oct 24 2026): never embarrass the customer, no research-use line in the body,
// routine emails not signed with Ash's name, VIPs flagged. Pure functions only; no network, no email.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const load=file=>{const m={exports:{}};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(m.exports,require);return m.exports;};
const {winBackTemplates}=load('lib/win-back.ts');
const {vipSignal,orderSummary}=load('lib/customer-context.ts');
const ctx={firstName:'Sheldon',items:[{name:'BPC-157',url:'https://trybiomod.com/product/bpc-157-10mg'}],orderNumber:'#ABCD1234',ordersUrl:'https://trybiomod.com/account/orders',autoRecovery:{savingsCents:500}};
for(const t of winBackTemplates){
  const body=t.body(ctx);
  assert.doesNotMatch(body,/didn.t go through|declin|failed|card was|research use|laboratory research/i,t.id+' must not embarrass the customer or carry a disclaimer');
  assert.doesNotMatch(body,/—|–/,t.id+' has no em or en dashes');
  if(t.id==='founder')assert.match(body,/\nAsh$/,'only the personal founder note is signed Ash');
  else assert.doesNotMatch(body,/\nAsh$/,t.id+' is a routine email and is not signed with Ash\'s name');
}
assert.equal(vipSignal('loulentine@gmail.com','Met you at olympia. Love to discuss a partnership.').vip,true);
assert.equal(vipSignal('llentine@echelonfit.com','cart error').vip,true,'company domain is a VIP signal');
assert.equal(vipSignal('someone@gmail.com','where is my order').vip,false);
const review=orderSummary({id:'83af686c-cef8',status:'review',total:39609,created:Date.UTC(2026,9,20),data:JSON.stringify({items:[{product:{name:'HEAT-R 30mg'},quantity:1}],address:{city:'Stuart',state:'FL'}})});
assert.equal(review.number,'83AF686C');assert.equal(review.total,'$396.09');assert.match(review.items,/HEAT-R 30mg; ships to Stuart, FL/);
assert.doesNotMatch(review.status,/declin/i,'staff wording never says declined');
const recovery=fs.readFileSync(path.join(__dirname,'..','lib/checkout-recovery.ts'),'utf8');
assert.doesNotMatch(recovery,/has not been completed/);assert.match(recovery,/after any existing promo/);
console.log('email-voice-v1: ok');
