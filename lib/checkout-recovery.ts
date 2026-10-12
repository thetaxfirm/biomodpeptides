// Private, order-bound recovery. No public coupon; no client-supplied percentages.
import { createPaymentAdapter, paymentEnvironment, getPaymentStatus } from './payments';
import { checkoutTax } from './checkout-tax';
import { unavailableOrder } from './catalog-visibility';
import { coaEmail, coaSender, coaHash } from './coa-delivery';
import { readCoaConfig, type CoaEnvironment } from './coa-outbox';
export const RECOVERY_DAY = 86400000;
const WEEK = 7 * RECOVERY_DAY;
const json = (s: string): any => { try { return JSON.parse(s); } catch { return null; } };
type Order = { id:string; owner:string; status:string; data:string; total:number; checkout_ref:string; created:number; payment_ref?:string|null; notification_id?:string|null };
type Job = { order_id:string;status:string;reason:string;recipient_hash:string;unsubscribe_token:string;payload:string;savings:number;attempts:number;first_attempt_at:number|null;next_attempt_at:number;lease_until:number|null;lease_token:string|null;accepted_at:number|null;created:number };
type Dependencies = { now?:()=>number; fetch?:typeof fetch; verify?:ReturnType<typeof createPaymentAdapter>['verifyPayment'] };
export function recoveryAmounts(saved:Record<string,any>) {
 if (saved.recovery || !Array.isArray(saved.items) || !saved.items.length) throw Error('Recovery is unavailable.');
 const before = saved.items.reduce((n:number,i:any)=> { if(!Number.isSafeInteger(i.lineTotal)||i.lineTotal<0)throw Error('Invalid saved amount.');return n+i.lineTotal; },0);
 if (!Number.isSafeInteger(before)||before<=0||!Number.isSafeInteger(saved.discount)||saved.discount<0||saved.subtotal-saved.discount!==before||!Number.isSafeInteger(saved.shipping)||saved.shipping<0||!Number.isSafeInteger(saved.tax)||saved.tax<0||before+saved.shipping+saved.tax!==saved.total) throw Error('Saved totals require review.');
 const savings = Number((BigInt(before)*BigInt(75)+BigInt(500))/BigInt(1000));
 if (savings<1) throw Error('Recovery is unavailable.');
 let running=0,allocated=0;
 const items=saved.items.map((item:any)=>{running+=item.lineTotal;const cumulative=Number(BigInt(running)*BigInt(savings)/BigInt(before));const lineRecoveryDiscount=cumulative-allocated;allocated=cumulative;return {...item,lineTotal:item.lineTotal-lineRecoveryDiscount,lineRecoveryDiscount};});
 return {items,savings,amount:before-savings,discount:saved.discount+savings};
}
export function recoveryEligible(order:Order,env:CoaEnvironment,startsAt:number,now:number):boolean {
 const d=json(order.data), email=coaEmail(d?.email);
 const admin=(env.STORE_ADMIN_EMAILS||'').toLowerCase().split(',').map(x=>x.trim());
 return Boolean(d && email && !admin.includes(email) && !d.internalTest && !d.recovery && !d.campaignId && !order.payment_ref && !order.notification_id && ['awaiting_payment','pending'].includes(order.status) && d.environment===paymentEnvironment(env) && getPaymentStatus(env).state==='live' && getPaymentStatus(env).checkoutEnabled && order.created>=startsAt && now-order.created>=RECOVERY_DAY && now-order.created<WEEK && (!d.lastPaymentFormAt || (Number.isSafeInteger(d.lastPaymentFormAt) && now-d.lastPaymentFormAt>=RECOVERY_DAY)) && !unavailableOrder(d));
}
export async function recoveryAdminStatus(env:CoaEnvironment) {
 const row=await env.DB.prepare("SELECT value FROM settings WHERE key='checkout_recovery_v1'").first<{value:string}>();
 const config=json(row?.value||'null');
 const health=await env.DB.prepare("SELECT value FROM settings WHERE key='checkout_recovery_health_v1'").first<{value:string}>();
 const jobs=(await env.DB.prepare('SELECT order_id,status,reason,savings,accepted_at,created FROM checkout_recovery ORDER BY created DESC LIMIT 200').all()).results;
 return {enabled:config?.enabled===true,startsAt:config?.startsAt||null,mailConfigured:Boolean(env.RESEND_API_KEY?.trim()),health:json(health?.value||'null'),jobs};
}
export async function suppressRecovery(env:CoaEnvironment,token:string,now=Date.now()) {
 if(!/^[a-f0-9-]{36}$/.test(token))return false;
 const job=await env.DB.prepare('SELECT recipient_hash FROM checkout_recovery WHERE unsubscribe_token=?').bind(token).first<{recipient_hash:string}>();
 if(!job)return false;
 await env.DB.prepare('INSERT OR IGNORE INTO checkout_recovery_suppression(recipient_hash,created) VALUES(?,?)').bind(job.recipient_hash,now).run();
 return true;
}
async function suppressed(env:CoaEnvironment,hash:string) { return Boolean(await env.DB.prepare('SELECT 1 FROM checkout_recovery_suppression WHERE recipient_hash=?').bind(hash).first()); }
const money=(n:number)=>'$'+(n/100).toFixed(2);
export async function runCheckoutRecovery(env:CoaEnvironment,deps:Dependencies={}) {
 const now=(deps.now||Date.now)(), request=deps.fetch||fetch;
 const counters={prepared:0,accepted:0,review:0,skipped:0};
 const health=async(status:string)=>env.DB.prepare("INSERT INTO settings(key,value) VALUES('checkout_recovery_health_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({status,checkedAt:now,...counters})).run();
 try {
  const cfg=await env.DB.prepare("SELECT value FROM settings WHERE key='checkout_recovery_v1'").first<{value:string}>(),config=json(cfg?.value||'null');
  if(config?.enabled!==true){await health('disabled');return counters;}
  const sender=coaSender(env.ORDER_EMAIL_FROM||'BIOMOD <no-reply@trybiomod.com>');
  if(!Number.isSafeInteger(config.startsAt)||config.startsAt<=0||!sender||!env.RESEND_API_KEY?.trim()||getPaymentStatus(env).state!=='live'||!getPaymentStatus(env).checkoutEnabled||paymentEnvironment(env)!=='authorizenet:live'){await health('configuration_required');return counters;}
  const verify=deps.verify||createPaymentAdapter(env).verifyPayment;
  const {replyTo}=await readCoaConfig(env);
  // Bounded work; oldest eligible records first. Only post-activation checkouts.
  const orders=(await env.DB.prepare("SELECT o.* FROM orders o LEFT JOIN checkout_recovery r ON r.order_id=o.id LEFT JOIN checkout_recovery_checks c ON c.order_id=o.id WHERE (c.next_check IS NULL OR c.next_check<=?) AND r.order_id IS NULL AND o.status IN ('awaiting_payment','pending') AND o.created>=? AND o.created<=? AND o.created>? AND COALESCE(json_extract(o.data,'$.lastPaymentFormAt'),0)<=? AND COALESCE(json_extract(o.data,'$.internalTest'),0)=0 ORDER BY o.created LIMIT 3").bind(now,config.startsAt,now-RECOVERY_DAY,now-WEEK,now-RECOVERY_DAY).all<Order>()).results;
  for(const order of orders){
   await env.DB.prepare('INSERT INTO checkout_recovery_checks(order_id,next_check) VALUES(?,?) ON CONFLICT(order_id) DO UPDATE SET next_check=excluded.next_check').bind(order.id,now+6*3600000).run();
   if(!recoveryEligible(order,env,config.startsAt,now))continue;
   const saved=json(order.data),recipient=coaEmail(saved.email)!,hash=await coaHash(recipient);
   if(await suppressed(env,hash))continue;
   if(await env.DB.prepare('SELECT 1 FROM checkout_recovery WHERE recipient_hash=? AND created>?').bind(hash,now-WEEK).first())continue;
   const count=await env.DB.prepare('SELECT COUNT(*) n FROM checkout_recovery WHERE created>?').bind(now-RECOVERY_DAY).first<{n:number}>();if((count?.n||0)>=100)break;
   const verification=await verify({id:order.id,totalCents:order.total,currency:'USD'},order.checkout_ref,[],order.created);
   if(!verification.noPaymentFound||verification.state!=='pending')continue;
   const amounts=recoveryAmounts(saved),tax=await checkoutTax(env,saved.address,amounts.amount,saved.shipping);
   const token=crypto.randomUUID(),total=amounts.amount+saved.shipping+tax;
   const updated={...saved,items:amounts.items,discount:amounts.discount,tax,total,recovery:{savings:amounts.savings,appliedAt:now,percentOff:7.5}};
   const unsubscribe='https://trybiomod.com/api/recovery/unsubscribe?token='+token;
   const payload=JSON.stringify({from:sender,to:[recipient],reply_to:replyTo,subject:'Your BIOMOD checkout: an additional 7.5% off',text:'Your checkout has not been completed. We have added an extra 7.5% discount after any existing promo or pack savings.\n\nOrder '+order.id.slice(0,8)+'\nAdditional product savings: '+money(amounts.savings)+'\nUpdated total including shipping and tax: '+money(total)+'\n\nReview this order and continue securely: https://trybiomod.com/account/orders\nSign in with the email used at checkout. Please close any older payment pages before continuing. No new order is needed.\n\nIf you have already paid or a payment is being reviewed, do not pay again. Reply to this email for help.\n\nThis is a promotional checkout reminder from BIOMOD. Research products are for laboratory research only, not for human or animal use.\nBIOMOD, 6625 S Valley View Blvd, Suite D420, Las Vegas, NV 89118\nStop checkout reminders: '+unsubscribe,headers:{'List-Unsubscribe':'<'+unsubscribe+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}});
   // Both pay issuance and recovery compare the immutable old snapshot. A concurrent
   // payment form, paid callback or administrator edit causes this batch to do nothing.
   const result=await env.DB.batch([
    env.DB.prepare("UPDATE orders SET status='awaiting_payment',data=?,total=?,updated=? WHERE id=? AND data=? AND total=? AND status IN ('awaiting_payment','pending') AND payment_ref IS NULL AND notification_id IS NULL").bind(JSON.stringify(updated),total,now,order.id,order.data,order.total),
    env.DB.prepare("INSERT OR IGNORE INTO checkout_recovery(order_id,status,reason,recipient_hash,unsubscribe_token,payload,original_snapshot,savings,next_attempt_at,created,updated) SELECT ?,'queued','ready',?,?,?,?,?,?,?,? FROM orders WHERE id=? AND data=? AND total=? AND status='awaiting_payment'").bind(order.id,hash,token,payload,order.data,amounts.savings,now,now,now,order.id,JSON.stringify(updated),total)
   ]);
   if(result[1]?.meta?.changes)counters.prepared++;
  }
  const jobs=(await env.DB.prepare("SELECT * FROM checkout_recovery WHERE status IN ('queued','sending') AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY created LIMIT 3").bind(now,now).all<Job>()).results;
  for(const job of jobs){
   const lease=crypto.randomUUID();
   const claimed=await env.DB.prepare("UPDATE checkout_recovery SET status='sending',lease_token=?,lease_until=?,updated=? WHERE order_id=? AND status IN ('queued','sending') AND (lease_until IS NULL OR lease_until<=?)").bind(lease,now+180000,now,job.order_id,now).run();if(!claimed.meta.changes)continue;
   const finish=async(status:string,reason:string,provider:string|null=null)=>env.DB.prepare('UPDATE checkout_recovery SET status=?,reason=?,provider_id=COALESCE(?,provider_id),accepted_at=CASE WHEN ?=\'accepted\' THEN ? ELSE accepted_at END,lease_until=NULL,lease_token=NULL,updated=? WHERE order_id=? AND lease_token=?').bind(status,reason,provider,status,now,now,job.order_id,lease).run();
   const order=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(job.order_id).first<Order>();const saved=order&&json(order.data);
   if(!order||!saved||saved.internalTest||order.payment_ref||order.notification_id||!['awaiting_payment','pending'].includes(order.status)||unavailableOrder(saved)||saved.environment!==paymentEnvironment(env)||await suppressed(env,job.recipient_hash)||now-order.created>=WEEK){await finish('skipped','paid_test_unsubscribed_or_unavailable');counters.skipped++;continue;}
   if(job.attempts>=3||(job.first_attempt_at!==null&&now-job.first_attempt_at>=23*3600000)){await finish('review','delivery_outcome_requires_review');counters.review++;continue;}
   const verification=await verify({id:order.id,totalCents:order.total,currency:'USD'},order.checkout_ref,[],order.created);
   if(!verification.noPaymentFound||verification.state!=='pending'){await finish('skipped','payment_found_or_requires_review');counters.skipped++;continue;}
   // Persist the attempt before sending; retries use an identical immutable payload
   // and provider idempotency key, always within its 24-hour retention window.
   await env.DB.prepare('UPDATE checkout_recovery SET attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?),next_attempt_at=? WHERE order_id=? AND lease_token=?').bind(now,now+300000,job.order_id,lease).run();
   try {
    const response=await request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'biomod-checkout-recovery-v1-'+job.order_id},body:job.payload,redirect:'manual',signal:AbortSignal.timeout(15000)});
    const body=await response.json() as {id?:string};
    if(response.ok&&typeof body.id==='string'&&/^[a-f0-9-]{36}$/.test(body.id)){await finish('accepted','accepted_by_mail_provider',body.id);counters.accepted++;}
    else if(response.status>=400&&response.status<500&&![408,429].includes(response.status)){await finish('review','mail_provider_rejected');counters.review++;}
    else await finish('queued','retry_pending');
   } catch {await finish('queued','delivery_outcome_unknown_retry_pending');}
  }
  await health('completed');return counters;
 } catch {await health('failed');throw Error('Checkout recovery processing failed; inspect protected administration.');}
}
