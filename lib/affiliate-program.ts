/** Adapted from supplied Biomod CRM: versioned agreements, explicit acceptance,
 * approval before access, private partner views and an immutable activity history.
 * Financial terms have no defaults: the owner publishes the actual agreement.
 */
import { z } from 'zod';
import agreementDocument from '../content/affiliate-agreement-v1.json';
import { activePromotions } from './promotions';
export const affiliateStatuses = ['pending', 'approved', 'rejected', 'suspended'] as const;
export type Agreement = { company:string; contact:string; payout_schedule:string; payout_methods:string; id: string; version: string; title: string; body: string; commission_bps: number; hold_days: number; minimum_payout_cents: number; created: number };
export type Member = { owner: string; email: string; name: string; website: string; audience: string; status: typeof affiliateStatuses[number]; code: string | null; agreement_id: string; accepted: number; reviewed: number | null; review_note: string; created: number; updated: number };
export const agreementInput = z.object({
 version: z.string().trim().regex(/^[A-Za-z0-9._-]{1,40}$/), title: z.string().trim().min(3).max(200),
 body: z.string().trim().min(100).max(24000), commissionBps: z.number().int().min(0).max(10000),
 holdDays: z.number().int().min(0).max(365), minimumPayoutCents: z.number().int().min(0).max(10000000),
 company:z.string().trim().min(3).max(200), contact:z.string().trim().email().max(254), payoutSchedule:z.string().trim().min(5).max(500), payoutMethods:z.string().trim().min(2).max(300),
 confirmed: z.literal(true),
});
export const applicationInput = z.object({
 agreementId: z.string().uuid(), accepted: z.literal(true), guidelinesAccepted: z.literal(true),
 name: z.string().trim().min(1).max(150),
 website: z.string().trim().url().max(500).refine(v => /^https?:\/\//i.test(v), 'Use an https or http profile URL.'),
 audience: z.string().trim().min(20).max(3000),
});
export function partnerGuide() { return {
 do: ['Describe the products as laboratory research compounds.', 'Clearly disclose that you earn a commission in each promotional post or video.', 'Use the matching lot COA and accurate product information; make only supportable statements.', 'Share your link and code with your own audience.', 'Ask Biomod to review content when unsure.'],
 avoid: ['Human or animal use, dosing, injection, mixing or reconstitution instructions.', 'Disease treatment, weight-loss promises, or before-and-after claims.', 'Coupon-site distribution, paid or fabricated reviews, and self-referrals.'],
 disclosure: 'I earn a commission from Biomod on orders through my link or code.',
 }; }
const stmt = (db: D1Database, sql: string, ...args: (string | number | null)[]) => db.prepare(sql).bind(...args);
export async function affiliateState(db: D1Database) {
 const state = await db.prepare('SELECT agreement_id,open FROM affiliate_program_state WHERE id=1').first<{agreement_id:string|null;open:number}>();
 const agreement = state?.agreement_id ? await stmt(db,'SELECT id,version,title,body,commission_bps,hold_days,minimum_payout_cents,company,contact,payout_schedule,payout_methods,created FROM affiliate_agreements WHERE id=?',state.agreement_id).first<Agreement>() : null;
 return { open: Boolean(state?.open && agreement), agreement, guide: partnerGuide() };
}
export async function affiliatePortal(db: D1Database, owner: string, email = '') {
 const state = await affiliateState(db);
 const member = await stmt(db,'SELECT * FROM affiliate_members WHERE owner=?',owner).first<Member>();
 if(!member && !await invitedAffiliate(db,email)) throw Error('This program is invitation-only. Sign in using the email address Biomod invited.');
 const schedule=await affiliateSchedule(db,owner);
 const acceptedAgreement = member ? await stmt(db,'SELECT id,version,title,body,commission_bps,hold_days,minimum_payout_cents,company,contact,payout_schedule,payout_methods,created FROM affiliate_agreements WHERE id=?',member.agreement_id).first<Agreement>() : null;
 return { ...state, schedule, earnings: await affiliateEarnings(db,owner), member: member ? { name:member.name,website:member.website,audience:member.audience,status:member.status,code:member.code,agreement_id:member.agreement_id,accepted:member.accepted,created:member.created } : null,
 acceptedAgreement, needsAcceptance: Boolean(member && state.agreement && member.agreement_id !== state.agreement.id) };
}
export async function affiliateAdmin(db: D1Database) {
 return { ...await affiliateState(db), agreementDocument, invitations:(await db.prepare('SELECT email,active,created,updated FROM affiliate_invitations ORDER BY updated DESC LIMIT 500').all()).results, earnings: await affiliateEarnings(db), schedules:(await db.prepare('SELECT f.*,fa.accepted FROM affiliate_schedule_state ss JOIN affiliate_schedules f ON f.id=ss.schedule_id LEFT JOIN affiliate_schedule_acceptances fa ON fa.schedule_id=f.id').all()).results, members:(await db.prepare('SELECT * FROM affiliate_members ORDER BY updated DESC LIMIT 500').all<Member>()).results,
 agreements:(await db.prepare('SELECT id,version,title,created FROM affiliate_agreements ORDER BY created DESC').all()).results,
 events:(await db.prepare('SELECT id,owner,actor,action,detail,created FROM affiliate_events ORDER BY created DESC LIMIT 100').all()).results,
 codes:activePromotions().map(p=>p.code) };
}
function event(db:D1Database,owner:string|null,actor:string,action:string,detail:unknown,now:number) {
 return stmt(db,'INSERT INTO affiliate_events(id,owner,actor,action,detail,created) VALUES(?,?,?,?,?,?)',crypto.randomUUID(),owner,actor,action,JSON.stringify(detail),now);
}
export async function publishAgreement(db:D1Database,actor:string,raw:unknown,now=Date.now()) {
 const input=agreementInput.parse(raw);
 if (/demo agreement|local testing|counsel supplies the real text/i.test(input.body) || /^demo/i.test(input.version)) throw Error('Publish the approved agreement, not demo text.');
 const id=crypto.randomUUID();
 // Shared agreement does not offer a commission rate. Financial terms are individual.
 input.commissionBps=0; input.holdDays=0; input.minimumPayoutCents=50000; input.payoutSchedule='Every 30 days'; input.payoutMethods='Specified in your individual schedule';
 await db.batch([
 stmt(db,'INSERT INTO affiliate_agreements(id,version,title,body,commission_bps,hold_days,minimum_payout_cents,company,contact,payout_schedule,payout_methods,created,actor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,input.version,input.title,input.body,input.commissionBps,input.holdDays,input.minimumPayoutCents,input.company,input.contact,input.payoutSchedule,input.payoutMethods,now,actor),
 stmt(db,'UPDATE affiliate_program_state SET agreement_id=?,open=0 WHERE id=1',id),
 event(db,null,actor,'agreement.published',{id,version:input.version},now),
 ]);
 return {message:'Agreement published. Enrollment is paused until you reopen it. Existing partners must accept this version before earning on new orders.'};
}
export async function setAffiliateOpen(db:D1Database,actor:string,open:boolean,now=Date.now()) {
 if(open && !(await affiliateState(db)).agreement) throw Error('Publish an approved agreement first.');
 await db.batch([stmt(db,'UPDATE affiliate_program_state SET open=? WHERE id=1',open?1:0),event(db,null,actor,'program.enrollment',{open},now)]);
 return {message:open?'Applications opened.':'Applications paused.'};
}
export async function applyAffiliate(db:D1Database,user:{id:string;email:string},raw:unknown,now=Date.now()) {
 const input=applicationInput.parse(raw);
 if(!await invitedAffiliate(db,user.email)) throw Error('This program is invitation-only. Sign in using the email address Biomod invited.');
 const current=await affiliateState(db);
 if(!current.open || current.agreement?.id!==input.agreementId) throw Error('Enrollment is closed or the agreement changed. Reload before applying.');
 const existing=await stmt(db,'SELECT owner FROM affiliate_members WHERE owner=?',user.id).first();
 if(existing) throw Error('Your application is already saved. Check its status below.');
 // INSERT ... SELECT repeats the open/version checks at write time. The acceptance
 // and audit insert depend on the member, so a concurrent program change saves nothing.
 await db.batch([
 stmt(db,`INSERT INTO affiliate_members(owner,email,name,website,audience,status,agreement_id,accepted,created,updated)
 SELECT ?,?,?,?,?,'pending',?,?,?,? FROM affiliate_program_state WHERE id=1 AND open=1 AND agreement_id=? AND EXISTS(SELECT 1 FROM affiliate_invitations WHERE email=? COLLATE NOCASE AND active=1)`,user.id,user.email,input.name,input.website,input.audience,input.agreementId,now,now,now,input.agreementId,user.email.trim()),
 stmt(db,`INSERT INTO affiliate_acceptances(owner,agreement_id,accepted) SELECT owner,agreement_id,accepted FROM affiliate_members WHERE owner=? AND accepted=?`,user.id,now),
 stmt(db,`INSERT INTO affiliate_events(id,owner,actor,action,detail,created) SELECT ?,owner,?,'application.submitted','{}',? FROM affiliate_members WHERE owner=? AND accepted=?`,crypto.randomUUID(),user.id,now,user.id,now),
 ]);
 if(!await stmt(db,'SELECT owner FROM affiliate_members WHERE owner=?',user.id).first()) throw Error('The agreement changed. Reload and try again.');
 return {message:'Application saved for review. Acceptance does not grant affiliate access.'};
}
export async function acceptAffiliateAgreement(db:D1Database,owner:string,raw:unknown,now=Date.now()) {
 const input=z.object({agreementId:z.string().uuid(),accepted:z.literal(true)}).parse(raw);
 const member=await stmt(db,'SELECT * FROM affiliate_members WHERE owner=?',owner).first<Member>();
 if(!member) throw Error('Submit an application first.');
 const state=await affiliateState(db);
 if(state.agreement?.id!==input.agreementId) throw Error('The agreement changed. Reload it before accepting.');
 await db.batch([
 stmt(db,`UPDATE affiliate_members SET agreement_id=?,accepted=?,updated=? WHERE owner=? AND EXISTS(SELECT 1 FROM affiliate_program_state WHERE agreement_id=?)`,input.agreementId,now,now,owner,input.agreementId),
 stmt(db,`INSERT OR IGNORE INTO affiliate_acceptances(owner,agreement_id,accepted) SELECT owner,agreement_id,accepted FROM affiliate_members WHERE owner=? AND agreement_id=?`,owner,input.agreementId),
 stmt(db,`INSERT INTO affiliate_events(id,owner,actor,action,detail,created) SELECT ?,owner,?,'agreement.accepted',?,? FROM affiliate_members WHERE owner=? AND agreement_id=? AND accepted=?`,crypto.randomUUID(),owner,JSON.stringify({agreementId:input.agreementId}),now,owner,input.agreementId,now),
 ]);
 if((await stmt(db,'SELECT agreement_id FROM affiliate_members WHERE owner=?',owner).first<{agreement_id:string}>())?.agreement_id!==input.agreementId) throw Error('The agreement changed. Reload it before accepting.');
 return {message:'Agreement acceptance recorded.'};
}
export async function reviewAffiliate(db:D1Database,actor:string,raw:unknown,now=Date.now()) {
 const input=z.object({owner:z.string().min(1).max(100),status:z.enum(['approved','rejected','suspended']),expectedUpdated:z.number().int(),code:z.string().trim().max(40).optional(),note:z.string().trim().min(3).max(2000)}).parse(raw);
 const member=await stmt(db,'SELECT * FROM affiliate_members WHERE owner=?',input.owner).first<Member>();
 if(!member || member.updated!==input.expectedUpdated) throw Error('Application changed. Reload before reviewing.');
 if(actor===input.owner) throw Error('Another administrator must review your application.');
 const code=input.code?.toUpperCase() || member.code;
 if(input.status==='approved') {
  if(!(await affiliateState(db)).agreement || member.agreement_id!==(await affiliateState(db)).agreement?.id) throw Error('The partner must accept the current agreement first.');
  const schedule=await affiliateSchedule(db,input.owner);
  if(!schedule?.accepted || schedule.agreement_id!==member.agreement_id) throw Error('The partner must accept their individual financial schedule first.');
  if(!code || !activePromotions().some(p=>p.code===code)) throw Error('Select an existing store promotion code. Discount prices are managed separately.');
 }
 now=Math.max(now,member.updated+1);
 const results=await db.batch([
 stmt(db,`UPDATE affiliate_members SET status=?,code=?,review_note=?,reviewed=?,reviewer=?,updated=? WHERE owner=? AND updated=? AND (?<>'approved' OR (agreement_id=(SELECT agreement_id FROM affiliate_program_state WHERE id=1) AND EXISTS(SELECT 1 FROM affiliate_schedule_state ss JOIN affiliate_schedules f ON f.id=ss.schedule_id JOIN affiliate_schedule_acceptances fa ON fa.schedule_id=f.id AND fa.owner=ss.owner WHERE ss.owner=affiliate_members.owner AND f.agreement_id=affiliate_members.agreement_id)))`,input.status,code,input.note,now,actor,now,input.owner,input.expectedUpdated,input.status),
 stmt(db,`INSERT INTO affiliate_events(id,owner,actor,action,detail,created) SELECT ?,owner,?,?,?,? FROM affiliate_members WHERE owner=? AND updated=? AND reviewer=?`,crypto.randomUUID(),actor,'application.'+input.status,JSON.stringify({note:input.note,code}),now,input.owner,now,actor),
 ]);
 if(!results[0].meta.changes) throw Error('Application changed. Reload before reviewing.');
 return {message:'Partner status updated. No email or payment was sent.'};
}
export async function affiliateEarnings(db:D1Database,owner?:string,now=Date.now()) {
 // This is an eligibility report, not a payout ledger. Uncertain/refunded payment
 // states never contribute to available earnings. Hold starts at the first
 // recorded paid state, captured independently of later fulfillment updates.
 const rows=(await stmt(db,`SELECT t.order_id,t.owner,t.code,t.commission_bps,t.hold_days,t.basis_cents,t.created,
 o.status,o.updated,o.payment_ref,o.notification_id,p.recorded_at,r.state AS review_state,r.net_cents FROM affiliate_order_terms t JOIN orders o ON o.id=t.order_id LEFT JOIN affiliate_payment_observations p ON p.order_id=t.order_id LEFT JOIN affiliate_commission_reviews r ON r.order_id=t.order_id
 ${owner?'WHERE t.owner=?':''} ORDER BY t.created DESC LIMIT 1000`,...(owner?[owner]:[])).all<{order_id:string;owner:string;code:string;commission_bps:number;hold_days:number;basis_cents:number;created:number;status:string;updated:number;payment_ref:string|null;notification_id:string|null;recorded_at:number|null;review_state:string|null;net_cents:number|null}>()).results;
 return rows.map(row=>{
  const paymentRecorded=['paid','labeling','shipped','delivered'].includes(row.status)&&Boolean(row.payment_ref?.trim()&&row.notification_id?.trim()&&row.recorded_at!==null);
  const availableAt=(row.recorded_at??row.updated)+row.hold_days*86400000;
  return {orderId:row.order_id,...(!owner?{owner:row.owner}:{}),code:row.code,created:row.created,
   originalBasisCents:row.basis_cents,basisCents:row.net_cents??row.basis_cents,commissionCents:Math.round((row.net_cents??row.basis_cents)*row.commission_bps/10000),
   state:row.review_state==='excluded'?'excluded':row.review_state==='held'?'held':paymentRecorded?(now>=availableAt?'eligible':'held'):'excluded',availableAt};
 });
}
export async function reviewCommission(db:D1Database,actor:string,raw:unknown,now=Date.now()) {
 const input=z.object({orderId:z.string().min(1).max(100),state:z.enum(['held','excluded','released']),netCents:z.number().int().min(0).max(100000000),reason:z.string().trim().min(5).max(1000)}).parse(raw);
 const terms=await stmt(db,'SELECT owner,basis_cents FROM affiliate_order_terms WHERE order_id=?',input.orderId).first<{owner:string;basis_cents:number}>();
 if(!terms || input.netCents>terms.basis_cents) throw Error('Select an attributed order and a net amount no higher than the original product amount.');
 if(terms.owner===actor) throw Error('Another administrator must review your commission.');
 await db.batch([
 stmt(db,`INSERT INTO affiliate_commission_reviews(order_id,state,net_cents,reason,actor,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET state=excluded.state,net_cents=excluded.net_cents,reason=excluded.reason,actor=excluded.actor,updated=excluded.updated`,input.orderId,input.state,input.netCents,input.reason,actor,now),
 event(db,terms.owner,actor,'commission.'+input.state,{orderId:input.orderId,netCents:input.netCents,reason:input.reason},now),
 ]);
 return {message:'Commission review recorded. No money was moved.'};
}

export type AffiliateSchedule={id:string;owner:string;agreement_id:string;commission_bps:number;hold_days:number;payout_methods:string;created:number;accepted:number|null};
export async function affiliateSchedule(db:D1Database,owner:string) {
 return stmt(db,`SELECT f.*,fa.accepted FROM affiliate_schedule_state ss JOIN affiliate_schedules f ON f.id=ss.schedule_id LEFT JOIN affiliate_schedule_acceptances fa ON fa.schedule_id=f.id AND fa.owner=ss.owner WHERE ss.owner=?`,owner).first<AffiliateSchedule>();
}
export async function offerAffiliateSchedule(db:D1Database,actor:string,raw:unknown,now=Date.now()) {
 const input=z.object({owner:z.string().min(1).max(100),commissionBps:z.number().int().min(0).max(10000),holdDays:z.number().int().min(0).max(365),payoutMethods:z.string().trim().min(2).max(300)}).parse(raw);
 if(input.owner===actor) throw Error('Another administrator must set your financial terms.');
 const state=await affiliateState(db);
 if(!state.agreement) throw Error('Publish an agreement first.');
 const id=crypto.randomUUID();
 await db.batch([
 stmt(db,`INSERT INTO affiliate_schedules(id,owner,agreement_id,commission_bps,hold_days,payout_methods,created,actor) VALUES(?,?,?,?,?,?,?,?)`,id,input.owner,state.agreement.id,input.commissionBps,input.holdDays,input.payoutMethods,now,actor),
 stmt(db,`INSERT INTO affiliate_schedule_state(owner,schedule_id) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET schedule_id=excluded.schedule_id`,input.owner,id),
 event(db,input.owner,actor,'schedule.offered',{id,commissionBps:input.commissionBps,holdDays:input.holdDays,payoutMethods:input.payoutMethods},now)
 ]);
 return {message:'Individual terms offered. New commissions require the affiliate to accept them. Previous order terms remain unchanged.'};
}
export async function acceptAffiliateSchedule(db:D1Database,owner:string,raw:unknown,now=Date.now()) {
 const input=z.object({scheduleId:z.string().uuid(),accepted:z.literal(true)}).parse(raw);
 const result=await db.batch([
 stmt(db,`INSERT OR IGNORE INTO affiliate_schedule_acceptances(schedule_id,owner,accepted) SELECT f.id,ss.owner,? FROM affiliate_schedule_state ss JOIN affiliate_schedules f ON f.id=ss.schedule_id JOIN affiliate_program_state ps ON ps.id=1 AND ps.agreement_id=f.agreement_id JOIN affiliate_members m ON m.owner=ss.owner AND m.agreement_id=f.agreement_id WHERE ss.owner=? AND ss.schedule_id=?`,now,owner,input.scheduleId),
 stmt(db,`INSERT INTO affiliate_events(id,owner,actor,action,detail,created) SELECT ?,owner,?,'schedule.accepted',?,? FROM affiliate_schedule_acceptances WHERE schedule_id=? AND owner=? AND accepted=?`,crypto.randomUUID(),owner,JSON.stringify({scheduleId:input.scheduleId}),now,input.scheduleId,owner,now)
 ]);
 if(!result[0].meta.changes) throw Error('The agreement or schedule changed or was already accepted. Reload before continuing.');
 return {message:'Your individual financial terms are accepted.'};
}

export async function invitedAffiliate(db:D1Database,email:string) {
 return Boolean(await stmt(db,'SELECT email FROM affiliate_invitations WHERE email=? COLLATE NOCASE AND active=1',email.trim()).first());
}
export async function inviteAffiliate(db:D1Database,actor:string,raw:unknown,now=Date.now()) {
 const input=z.object({email:z.string().trim().email().max(254),active:z.boolean()}).parse(raw);
 const email=input.email.toLowerCase();
 await db.batch([
 stmt(db,`INSERT INTO affiliate_invitations(email,active,created,updated,actor) VALUES(?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET active=excluded.active,updated=excluded.updated,actor=excluded.actor`,email,input.active?1:0,now,now,actor),
 event(db,null,actor,input.active?'invitation.authorized':'invitation.revoked',{email},now)
 ]);
 return {message:input.active?'Invitation access saved. Send the private link to this email yourself; no email has been sent.':'Invitation access revoked. Existing members must be suspended separately.'};
}
