import { withAuditDb } from './change-history';
export class RewardError extends Error { constructor(message: string, public status = 400) { super(message); } }
export type RewardEntry = { id: string; owner: string; points: number; reason: string; created: number; actor: string | null };
const ownerId = (v: unknown) => { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(v)) throw new RewardError('Choose an existing customer.'); return v; };
const cursorParts = (v: unknown) => { if (v == null || v === '') return null; if (typeof v !== 'string' || !/^\d{1,16}:[A-Za-z0-9_-]{1,100}$/.test(v)) throw new RewardError('Refresh the reward ledger.'); const [at,id]=v.split(':'); return {at:Number(at),id}; };
export async function rewardCustomers(db: D1Database, query: unknown) {
 const q = typeof query === 'string' ? query.trim().slice(0,120) : '';
 if(q.length<2) return [];
 const term='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
 return (await db.prepare(`SELECT p.id,p.name,COALESCE(c.email,(SELECT json_extract(o.data,'$.email') FROM orders o WHERE o.owner=p.id ORDER BY created DESC LIMIT 1),'') email,
 COALESCE((SELECT SUM(points) FROM rewards WHERE owner=p.id),0) balance FROM profiles p
 LEFT JOIN crm_contacts c ON c.email=(SELECT email FROM crm_contacts WHERE owner=p.id ORDER BY last_seen DESC LIMIT 1)
 WHERE p.id=? OR p.name LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM orders o WHERE o.owner=p.id AND json_extract(o.data,'$.email') LIKE ? ESCAPE '\\')
 ORDER BY p.name,p.id LIMIT 30`).bind(q,term,term,term).all<{id:string;name:string;email:string;balance:number}>()).results;
}
export async function rewardLedger(db: D1Database, rawOwner: unknown, before?: unknown) {
 const owner=ownerId(rawOwner), cursor=cursorParts(before);
 const customer=await db.prepare('SELECT id,name FROM profiles WHERE id=?').bind(owner).first<{id:string;name:string}>();
 if(!customer) throw new RewardError('Customer not found.',404);
 const totals=await db.prepare('SELECT COUNT(*) total,COALESCE(SUM(points),0) balance FROM rewards WHERE owner=?').bind(owner).first<{total:number;balance:number}>();
 const rows=(await db.prepare(`SELECT r.*,a.actor FROM rewards r LEFT JOIN reward_adjustments a ON a.reward_id=r.id WHERE r.owner=?${cursor?' AND (r.created<? OR (r.created=? AND r.id<?))':''} ORDER BY r.created DESC,r.id DESC LIMIT 51`).bind(owner,...(cursor?[cursor.at,cursor.at,cursor.id]:[])).all<RewardEntry>()).results;
 const entries=rows.slice(0,50),last=entries.at(-1);
 return {customer,balance:totals?.balance||0,total:totals?.total||0,entries,nextCursor:rows.length>50&&last?last.created+':'+last.id:null};
}
/** Append a correction; never rewrite historical points. Idempotency and expected balance protect repeat submits. */
export async function addRewardAdjustment(db: D1Database, actor: {email:string}, input: Record<string,unknown>, now=Date.now()) {
 const owner=ownerId(input.owner), points=input.points, reason=typeof input.reason==='string'?input.reason.trim():'';
 if(!Number.isInteger(points)||Number(points)===0||Math.abs(Number(points))>100000) throw new RewardError('Enter a nonzero whole number from -100000 to 100000.');
 if(reason.length<3||reason.length>200) throw new RewardError('Enter a reason from 3 to 200 characters.');
 if(typeof input.requestKey!=='string'||!/^[a-f0-9-]{36}$/.test(input.requestKey)) throw new RewardError('Refresh the adjustment form before saving.');
 if(!Number.isSafeInteger(input.expectedBalance)) throw new RewardError('Load the current balance before saving.');
 const prior=await db.prepare('SELECT r.owner,r.points,r.reason FROM reward_adjustments a JOIN rewards r ON r.id=a.reward_id WHERE a.request_key=?').bind(input.requestKey).first<{owner:string;points:number;reason:string}>();
 if(prior) { if(prior.owner!==owner||prior.points!==points||prior.reason!==reason) throw new RewardError('This adjustment key was already used. Reload before making another adjustment.',409); return {message:'Adjustment already recorded.',ledger:await rewardLedger(db,owner)}; }
 if(!await db.prepare('SELECT id FROM profiles WHERE id=?').bind(owner).first()) throw new RewardError('Customer not found.',404);
 const id=crypto.randomUUID(), audit=withAuditDb(db,{source:'admin',actor:actor.email,actorType:'staff',action:'reward.adjustment',summary:'Reward adjustment recorded'});
 const result=await audit.batch([
  audit.prepare('INSERT INTO rewards(id,owner,points,reason,created) SELECT ?,?,?,?,? WHERE COALESCE((SELECT SUM(points) FROM rewards WHERE owner=?),0)=? AND NOT EXISTS(SELECT 1 FROM reward_adjustments WHERE request_key=?)').bind(id,owner,points,reason,now,owner,input.expectedBalance,input.requestKey),
  audit.prepare('INSERT INTO reward_adjustments(request_key,reward_id,actor,created) SELECT ?,id,?,? FROM rewards WHERE id=?').bind(input.requestKey,actor.email,now,id),
 ]);
 if(!result[0]?.meta.changes) throw new RewardError('The balance changed. Reload the ledger before saving.',409);
 return {message:'Reward adjustment recorded.',ledger:await rewardLedger(db,owner)};
}
