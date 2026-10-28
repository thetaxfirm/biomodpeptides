// Email voice rules (owner, Oct 24 2026): never embarrass the customer, no research-use line in the body,
// routine emails not signed with Ash's name, VIPs flagged. Pure functions only; no network, no email.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const load=file=>{const m={exports:{}};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(m.exports,require);return m.exports;};
const {winBackTemplates}=load('lib/win-back.ts');
const {vipSignal,orderSummary}=load('lib/customer-context.ts');
const ctx={firstName:'Fixture',items:[{name:'BPC-157',url:'https://trybiomod.com/product/bpc-157-10mg'}],orderNumber:'#ABCD1234',ordersUrl:'https://trybiomod.com/account/orders',autoRecovery:{savingsCents:500}};
for(const t of winBackTemplates){
  const body=t.body(ctx);
  assert.doesNotMatch(body,/didn.t go through|site didn.t|last reminder|COMEBACK|add the items to your cart again|declin|failed|card was|research use|laboratory research/i,t.id+' must not embarrass the customer or carry a disclaimer');
  assert.doesNotMatch(body,/—|–/,t.id+' has no em or en dashes');
  if(t.id==='founder')assert.match(body,/\nAsh$/,'only the personal founder note is signed Ash');
  else assert.doesNotMatch(body,/\nAsh$/,t.id+' is a routine email and is not signed with Ash\'s name');
}
assert.equal(vipSignal('partner@example.invalid','Met you at olympia. Love to discuss a partnership.').vip,true);
assert.equal(vipSignal('buyer@company.example','cart error').vip,false,'company domain does not establish a personal relationship');
assert.equal(vipSignal('buyer@example.invalid','where is my order').vip,false);
const review=orderSummary({id:'83af686c-cef8',status:'review',total:39609,created:Date.UTC(2026,9,20),data:JSON.stringify({items:[{product:{name:'HEAT-R 30mg'},quantity:1}],address:{city:'Stuart',state:'FL'}})});
assert.equal(review.number,'83AF686C');assert.equal(review.total,'$396.09');assert.match(review.items,/HEAT-R 30mg/);assert.doesNotMatch(review.items,/Stuart|FL/,'Shipping location is not needed in drafting context');
assert.doesNotMatch(review.status,/declin/i,'staff wording never says declined');
const recovery=fs.readFileSync(path.join(__dirname,'..','lib/checkout-recovery.ts'),'utf8');
assert.doesNotMatch(recovery,/has not been completed/);assert.match(recovery,/after any existing promo/);
// Customer identity is shared by store-controlled mail while configured addresses stay intact.
const identity=load('lib/customer-mail.ts');
assert.equal(identity.customerMailFrom('Ash <shipping@example.invalid>'),'Kim C. | BioMod Customer Care <shipping@example.invalid>');
assert.equal(identity.customerMailFrom('support@example.invalid'),'Kim C. | BioMod Customer Care <support@example.invalid>');
assert.equal(identity.customerMailFrom('bad sender'),'bad sender','Identity formatting does not invent a fallback mailbox');
const unsafe='Name <a@example.invalid>\nBcc:other@example.invalid';assert.equal(identity.customerMailFrom(unsafe),unsafe,'Existing transport validation receives invalid input unchanged');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:1,target:9,esModuleInterop:true}}).outputText,f);
global.fetch=async()=>{throw Error('Network forbidden in email identity fixture');};
const report=require('./fixtures/coa-originals-v1.cjs').reports[0],linkEmail=require('../lib/coa-link.ts').coaLinkEmail(report,'https://trybiomod.com/api/coa-file/fixture');
assert(linkEmail.text.endsWith(identity.CUSTOMER_MAIL_SIGNATURE_TEXT));assert(linkEmail.html.includes(identity.CUSTOMER_MAIL_SIGNATURE_HTML));
assert(require('../lib/coa-delivery.ts').coaMessage(report).text.endsWith(identity.CUSTOMER_MAIL_SIGNATURE_TEXT));
console.log('email-voice-v1: ok');
