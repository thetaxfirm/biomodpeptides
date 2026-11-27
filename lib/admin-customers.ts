// Customer workspace reads local operational records; never requests a provider or sends a message.
import { rewardLedger } from './admin-rewards';
export class CustomerReadError extends Error { constructor(message:string,public status=400){super(message);} }
const parse=(v:string):Record<string,any>=>{try{const d=JSON.parse(v);return d&&typeof d==='object'&&!Array.isArray(d)?d:{};}catch{return {};}};
const emailAddress=(v:unknown)=>{const e=typeof v==='string'?v.trim().toLowerCase():'';if(e.length>254||!/^\S+@\S+\.\S+$/.test(e))throw new CustomerReadError('Choose a contact from the list.');return e;};
function paging(before:unknown) { if(before==null||before==='')return null;if(typeof before!=='string'||!/^\d{1,16}:[A-Za-z0-9_-]{1,100}$/.test(before))throw new CustomerReadError('Refresh this customer.');const [at,id]=before.split(':');return {at:Number(at),id}; }
function page<T extends {id:string;created:number}>(rows:T[]){const items=rows.slice(0,25),last=items.at(-1);return {items,nextCursor:rows.length>25&&last?last.created+':'+last.id:null};}
export async function customerWorkspace(db:D1Database,input:Record<string,unknown>) {
 const email=emailAddress(input.email);
 const contact=await db.prepare('SELECT email,owner,name,phone,first_seen,last_seen FROM crm_contacts WHERE email=?').bind(email).first<{email:string;owner:string|null;name:string;phone:string;first_seen:number;last_seen:number}>();
 const profiles=(await db.prepare(`SELECT id,name,phone,company,created FROM profiles WHERE id=? OR id IN (SELECT owner FROM orders WHERE lower(trim(json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.email')))=?) ORDER BY created`).bind(contact?.owner||'',email).all<{id:string;name:string;phone:string;company:string;created:number}>()).results;
 const owners=profiles.map(p=>p.id);
 const oc=paging(input.ordersBefore),rc=paging(input.requestsBefore);
 const identity="(lower(trim(json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.email')))=?"+(owners.length?" OR owner IN ("+owners.map(()=>'?').join(',')+")":"")+")", identityValues=[email,...owners];
 const orderWhere=identity;
 const requestsWhere=identity+" AND kind IN ('contact','affiliate','stock')";
 const [orderTotals,rawOrders,requestTotal,rawRequests,emailConsent]=await Promise.all([
  db.prepare(`SELECT COUNT(*) total,COALESCE(SUM(CASE WHEN status IN ('paid','labeling','shipped','delivered') AND COALESCE(json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.internalTest'),0)=0 AND json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.environment') IN ('authorizenet:live','live') AND typeof(total)='integer' AND total BETWEEN 0 AND 9007199254740991 AND NULLIF(TRIM(payment_ref),'') IS NOT NULL AND NULLIF(TRIM(notification_id),'') IS NOT NULL THEN total ELSE 0 END),0) recordedPaidCents FROM orders WHERE ${orderWhere}`).bind(...identityValues).first<{total:number;recordedPaidCents:number}>(),
  db.prepare(`SELECT id,status,total,created,data FROM orders WHERE ${orderWhere}${oc?' AND (created<? OR (created=? AND id<?))':''} ORDER BY created DESC,id DESC LIMIT 26`).bind(...identityValues,...(oc?[oc.at,oc.at,oc.id]:[])).all<{id:string;status:string;total:number;created:number;data:string}>(),
  db.prepare(`SELECT COUNT(*) total FROM requests WHERE ${requestsWhere}`).bind(...identityValues).first<{total:number}>(),
  db.prepare(`SELECT id,kind,status,created,data FROM requests WHERE ${requestsWhere}${rc?' AND (created<? OR (created=? AND id<?))':''} ORDER BY created DESC,id DESC LIMIT 26`).bind(...identityValues,...(rc?[rc.at,rc.at,rc.id]:[])).all<{id:string;kind:string;status:string;created:number;data:string}>(),
  db.prepare('SELECT created,unsubscribed_at FROM email_signups WHERE email=?').bind(email).first<{created:number;unsubscribed_at:number|null}>(),
 ]);
 // Text-offer capture stores canonical +1 numbers, one request per number. Match only this customer's phones.
 const phones=[...new Set([contact?.phone,...profiles.map(p=>p.phone)].filter((v):v is string=>Boolean(v)).map(p=>p.replace(/\D/g,'')).map(p=>p.length===10?'+1'+p:p.length===11&&p.startsWith('1')?'+'+p:'').filter(Boolean))];
 const textPreferences=phones.length?(await db.prepare(`SELECT json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.phone') phone,MIN(created) signedUp FROM requests WHERE kind='text_offer' AND json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.phone') IN (${phones.map(()=>'?').join(',')}) GROUP BY phone`).bind(...phones).all<{phone:string;signedUp:number}>()).results:[];
 const orders=page(rawOrders.results.map(r=>{const d=parse(r.data);return {id:r.id,status:r.status,total:r.total,created:r.created,environment:String(d.environment||'unclassified'),internalTest:Boolean(d.internalTest),items:(Array.isArray(d.items)?d.items:[]).map(i=>String(i?.product?.name||'Item')+' × '+Number(i?.quantity||1)).join(', ')};}));
 const conversations=page(rawRequests.results.map(r=>{const d=parse(r.data);return {id:r.id,kind:r.kind,status:r.status,created:r.created,subject:String(d.subject||'Website request'),preview:String(d.message||'').slice(0,240)};}));
 const rewards=await Promise.all(owners.map(owner=>rewardLedger(db,owner)));
 const recent=(await db.prepare(`WITH customer_requests AS (SELECT id FROM requests WHERE ${requestsWhere}),events AS (
 SELECT id,created,'Order recorded' label,status detail FROM orders WHERE ${orderWhere}
 UNION ALL SELECT id,created,'Conversation received',status FROM requests WHERE id IN (SELECT id FROM customer_requests)
 UNION ALL SELECT id,created,CASE WHEN direction='incoming' THEN 'Incoming message' ELSE 'Reply recorded' END,direction FROM request_reply_messages WHERE request_id IN (SELECT id FROM customer_requests)
 UNION ALL SELECT id,sent_at,CASE WHEN source='manual' THEN 'Contact logged by staff' ELSE 'Outside reply recorded' END,source FROM request_external_replies WHERE request_id IN (SELECT id FROM customer_requests)
 ) SELECT * FROM events ORDER BY created DESC,id DESC LIMIT 30`).bind(...identityValues,...identityValues).all<{id:string;created:number;label:string;detail:string}>()).results;
 return {email,contact:contact||null,profiles,orders:{...orders,total:orderTotals?.total||0,recordedPaidCents:orderTotals?.recordedPaidCents||0},conversations:{...conversations,total:requestTotal?.total||0},rewards,preferences:{emailMarketing:emailConsent?{state:emailConsent.unsubscribed_at?'unsubscribed':'subscribed',at:emailConsent.unsubscribed_at||emailConsent.created}:{state:'not_recorded',at:null},textMarketing:textPreferences},activity:recent};
}
