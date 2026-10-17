// Backend only: immutable original reports are read from private D1 at the send boundary.
import { exactCoaReport, labelLotOf, reportForLabelLot, approvedCoaReportCount, coaReportByHash, readCoaOriginal, type OriginalCoaMetadata, type CoaBatchAssociation, coaEmail, coaSender, isCoaRequest, coaHash, verifiedCoaAttachment, coaMessage, COA_TEMPLATE_VERSION } from './coa-delivery';
import { loadCoaBatchContext } from './product-batch';
import { looksLikePitchText } from './request-issues';
export type CoaEnvironment = Record<string, string | undefined> & { DB: D1Database };
export type CoaConfig = { enabled: boolean; replyTo: string; notifyTo: string | null };
type Purpose = 'coa' | 'request-alert';
export type DeliveryStatus = { status: 'ready' | 'queued' | 'sending' | 'accepted' | 'manual_review' | 'duplicate'; reason: string; productName?: string; strength?: string; lot?: string; reportId?: string; acceptedAt: number | null; duplicateOfRequestId?: string; relatedStatus?: Exclude<DeliveryStatus['status'],'ready'>; canProcess: boolean };
export type CoaAutomationStatus = { config: CoaConfig; mailConfigured: boolean; sender: string; approvedReportCount: number; requests: Record<string, { coa: DeliveryStatus | null; alert: DeliveryStatus | null }> };
type Dependencies = { now?: () => number; fetch?: typeof fetch; uuid?: () => string };
type StoredRequest = { id: string; kind: string; data: string; created: number };
type Row = { id: string; request_id: string; purpose: Purpose; status: Exclude<DeliveryStatus['status'], 'ready'>; reason: string; recipient: string | null; recipient_hash: string | null; dedupe_key: string | null; duplicate_of: string | null; document_hash: string | null; attachment_name: string | null; product_name: string | null; strength: string | null; lot: string | null; report_id: string | null; template_version: string; sender: string | null; reply_to: string | null; subject: string | null; body: string | null; payload_hash: string | null; idempotency_key: string; attempts: number; first_attempt_at: number | null; next_attempt_at: number; lease_token: string | null; lease_until: number | null; provider_id: string | null; accepted_at: number | null; created: number; updated: number };
const DAY = 86400000, SAFE_RETRY = 23 * 3600000, LEASE = 60000;
const CAPS = { coa: 100, 'request-alert': 50 };
const DEFAULT_CONFIG: CoaConfig = { enabled: false, replyTo: 'contact@trybiomod.com', notifyTo: null };
const parse = (value: string): any => { try { return JSON.parse(value); } catch { return null; } };
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const senderFor = (env: CoaEnvironment) => coaSender(env.COA_EMAIL_FROM || env.ORDER_EMAIL_FROM || 'BIOMOD <contact@trybiomod.com>');
const mailReady = (env: CoaEnvironment) => Boolean(env.RESEND_API_KEY?.trim() && senderFor(env));
export async function readCoaConfig(env: CoaEnvironment): Promise<CoaConfig> {
 const row = await env.DB.prepare("SELECT value FROM settings WHERE key='coa_delivery_v1'").first<{value:string}>();
 const value = row && parse(row.value);
 if (!value || typeof value.enabled !== 'boolean' || !coaEmail(value.replyTo) || (value.notifyTo != null && value.notifyTo !== '' && !coaEmail(value.notifyTo))) return {...DEFAULT_CONFIG};
 return { enabled: value.enabled, replyTo: coaEmail(value.replyTo)!, notifyTo: coaEmail(value.notifyTo) };
}
export async function saveCoaConfig(env: CoaEnvironment, value: {enabled:unknown;replyTo:unknown;notifyTo?:unknown}): Promise<CoaConfig> {
 if (!value || typeof value.enabled !== 'boolean' || !coaEmail(value.replyTo) || (value.notifyTo != null && value.notifyTo !== '' && !coaEmail(value.notifyTo))) throw new Error('Enter a valid reply-to and optional notification email.');
 if (value.enabled && !mailReady(env)) throw new Error('COA email is not configured.');
 const config = {enabled:value.enabled,replyTo:coaEmail(value.replyTo)!,notifyTo:coaEmail(value.notifyTo)};
 await env.DB.prepare("INSERT INTO settings(key,value) VALUES('coa_delivery_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(config)).run();
 return config;
}
const statusOf = (row: Row, enabled: boolean): DeliveryStatus => ({ status:row.status,reason:row.reason,...(row.product_name?{productName:row.product_name}:{}),...(row.strength?{strength:row.strength}:{}),...(row.lot?{lot:row.lot}:{}),...(row.report_id?{reportId:row.report_id}:{}),acceptedAt:row.accepted_at,...(row.duplicate_of?{duplicateOfRequestId:row.duplicate_of}:{}),canProcess:row.purpose==='request-alert'&&enabled&&row.status==='queued' });
async function requestById(env: CoaEnvironment,id:string):Promise<StoredRequest|null> {
 if (!validId(id)) throw new Error('Choose an existing request.');
 return env.DB.prepare("SELECT id,kind,data,created FROM requests WHERE id=? AND kind IN ('contact','affiliate')").bind(id).first<StoredRequest>();
}
// Plain, bounded metadata only. Never copy the customer's message into an alert.
const alertLine = (value: unknown, max: number) => typeof value === 'string'
 ? value.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
function requestAlert(request: StoredRequest, data: Record<string, unknown>) {
 const name=alertLine(data.name,80)||'Name not provided',subject=alertLine(data.subject,150)||(request.kind==='affiliate'?'Partner application':'Website message');
 const category=request.kind==='affiliate'?'Partner application':looksLikePitchText(typeof data.subject==='string'?data.subject:'',typeof data.message==='string'?data.message:'')?'Likely supplier pitch (automatic suggestion; review required)':isCoaRequest(subject)?'COA request':'Customer request';
 const url='https://trybiomod.com/admin?tab=requests&request='+encodeURIComponent(request.id);
 return {subject:'New BIOMOD '+request.kind+' request: '+name,text:'A new website request was saved in store administration.\n\nName: '+name+'\nSubject: '+subject+'\nCategory: '+category+'\nReference: '+request.id+'\n\nOpen this exact request:\n'+url+'\n\nThis staff alert is not a reply to the customer.\n\nBIOMOD'};
}
async function makePlan(env:CoaEnvironment,request:StoredRequest,config:CoaConfig,purpose:Purpose,now:number,originals:readonly OriginalCoaMetadata[],associations:readonly CoaBatchAssociation[]):Promise<Row|null> {
 const data=parse(request.data); if(!data||typeof data!=='object')return null;
 // Owner rule (Oct 14 2026): the lot printed on the customer's vial decides the report, never the subject alone.
 const labelLot=labelLotOf(data);
 const report=purpose==='coa'&&request.kind==='contact'?(labelLot?reportForLabelLot(labelLot,originals,associations):exactCoaReport(data.subject,originals,associations)):null;
 if(purpose==='coa'&&(request.kind!=='contact'||!isCoaRequest(data.subject)))return null;
 if(purpose==='request-alert'&&(!config.notifyTo||request.created<now-300000||request.created>now))return null;
 const recipient=purpose==='coa'?coaEmail(data.email):config.notifyTo;
 const sender=senderFor(env),recipientHash=recipient?await coaHash(recipient):null;
 const message=report?coaMessage(report):purpose==='request-alert'?requestAlert(request,data):null;
 const reason=!recipient?'invalid_recipient':!report&&purpose==='coa'?'no_exact_original':!sender?'sender_unavailable':'ready';
 const id=request.id+':'+purpose;
 return {id,request_id:request.id,purpose,status:reason==='ready'?'queued':'manual_review',reason,recipient,recipient_hash:recipientHash,dedupe_key:report&&recipientHash?await coaHash(recipientHash+':'+report.sha256):null,duplicate_of:null,document_hash:report?.sha256||null,attachment_name:report?.filename||null,product_name:report?.productName||null,strength:report?.strength||null,lot:report?.lot||null,report_id:report?.reportId||null,template_version:purpose==='coa'?COA_TEMPLATE_VERSION:'request-alert-v2',sender,reply_to:config.replyTo,subject:message?.subject||null,body:message?.text||null,payload_hash:null,idempotency_key:'biomod-'+id+'-v1',attempts:0,first_attempt_at:null,next_attempt_at:now,lease_token:null,lease_until:null,provider_id:null,accepted_at:null,created:now,updated:now};
}
const payloadFingerprint = (row:Row) => JSON.stringify([row.recipient,row.sender,row.reply_to,row.subject,row.body,row.document_hash,row.attachment_name,row.template_version,row.idempotency_key,row.purpose]);
const columns = ['id','request_id','purpose','status','reason','recipient','recipient_hash','dedupe_key','duplicate_of','document_hash','attachment_name','product_name','strength','lot','report_id','template_version','sender','reply_to','subject','body','payload_hash','idempotency_key','attempts','first_attempt_at','next_attempt_at','lease_token','lease_until','provider_id','accepted_at','created','updated'] as const;
async function existing(env:CoaEnvironment,id:string,purpose:Purpose){return env.DB.prepare('SELECT * FROM coa_delivery_outbox WHERE request_id=? AND purpose=?').bind(id,purpose).first<Row>();}
async function duplicate(env:CoaEnvironment,key:string){return env.DB.prepare("SELECT * FROM coa_delivery_outbox WHERE purpose='coa' AND dedupe_key=? ").bind(key).first<Row>();}
async function enqueue(env:CoaEnvironment,id:string,purpose:Purpose,deps:Dependencies):Promise<DeliveryStatus|null> {
 const config=await readCoaConfig(env); if(!config.enabled)return null;
 const old=await existing(env,id,purpose);if(old)return statusOf(old,mailReady(env));
 const request=await requestById(env,id);if(!request)return null;
 const now=(deps.now||Date.now)(),context=purpose==='coa'?await loadCoaBatchContext(env.DB):{originals:[],associations:[]},plan=await makePlan(env,request,config,purpose,now,context.originals,context.associations);if(!plan)return null;
 plan.payload_hash=await coaHash(payloadFingerprint(plan));
 const values=columns.map(key=>plan[key]);
 // Insertion and active recipient/report uniqueness are enforced inside SQLite.
 await env.DB.prepare(`INSERT OR IGNORE INTO coa_delivery_outbox(${columns.join(',')}) SELECT ${columns.map(()=>'?').join(',')} WHERE ?='manual_review' OR ((SELECT COUNT(*) FROM coa_delivery_outbox WHERE purpose=? AND created>=? AND status IN ('queued','sending','accepted','manual_review'))<? AND (?='request-alert' OR (SELECT COUNT(*) FROM coa_delivery_outbox WHERE purpose='coa' AND recipient_hash=? AND created>=? AND status IN ('queued','sending','accepted','manual_review'))<3))`).bind(...values,plan.status,purpose,now-DAY,CAPS[purpose],purpose,plan.recipient_hash,now-DAY).run();
 let stored=await existing(env,id,purpose);
 if(!stored){
  const other=plan.dedupe_key?await duplicate(env,plan.dedupe_key):null;
  plan.status=other?'duplicate':'manual_review';plan.reason=other?'same_original_already_queued_accepted_or_under_review':'daily_limit';plan.dedupe_key=null;plan.duplicate_of=other?.request_id||null;
  await env.DB.prepare(`INSERT OR IGNORE INTO coa_delivery_outbox(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).bind(...columns.map(key=>plan[key])).run();
  stored=await existing(env,id,purpose);
 }
 return stored?statusOf(stored,mailReady(env)):null;
}
export const enqueueCoaRequest=(env:CoaEnvironment,id:string,deps:Dependencies={})=>enqueue(env,id,'coa',deps);
/** Call only for a newly persisted inquiry. Historical manual COA processing must not call this. */
export const enqueueRequestAlert=(env:CoaEnvironment,id:string,deps:Dependencies={})=>enqueue(env,id,'request-alert',deps);
export async function coaAutomationStatus(env:CoaEnvironment,ids:string[],deps:Dependencies={}):Promise<CoaAutomationStatus>{
 const config=await readCoaConfig(env),ready=config.enabled&&mailReady(env),requests:CoaAutomationStatus['requests']={};
 const {originals,associations}=await loadCoaBatchContext(env.DB);
 const selected=[...new Set(ids)].filter(validId).slice(0,200), rows:Row[]=[], source:StoredRequest[]=[];
 // Keep the admin's 200-request view below D1's statement parameter and subrequest limits.
 for(let offset=0;offset<selected.length;offset+=80){
  const chunk=selected.slice(offset,offset+80),marks=chunk.map(()=>'?').join(',');
  rows.push(...(await env.DB.prepare(`SELECT * FROM coa_delivery_outbox WHERE request_id IN (${marks})`).bind(...chunk).all<Row>()).results);
  source.push(...(await env.DB.prepare(`SELECT id,kind,data,created FROM requests WHERE id IN (${marks}) AND kind IN ('contact','affiliate')`).bind(...chunk).all<StoredRequest>()).results);
 }
 const relationIds=[...new Set(rows.map(row=>row.duplicate_of).filter((id):id is string=>Boolean(id)))];
 const relations:Row[]=[];
 for(let offset=0;offset<relationIds.length;offset+=80){const chunk=relationIds.slice(offset,offset+80);relations.push(...(await env.DB.prepare(`SELECT * FROM coa_delivery_outbox WHERE purpose='coa' AND request_id IN (${chunk.map(()=>'?').join(',')})`).bind(...chunk).all<Row>()).results);}
 const plans=new Map<string,Row>();
 for(const id of selected){
  const coa=rows.find(row=>row.request_id===id&&row.purpose==='coa'),alert=rows.find(row=>row.request_id===id&&row.purpose==='request-alert');
  requests[id]={coa:coa?statusOf(coa,ready):null,alert:alert?statusOf(alert,ready):null};
  const related=coa?.duplicate_of&&relations.find(row=>row.request_id===coa.duplicate_of);
  if(related&&requests[id].coa)requests[id].coa={...requests[id].coa!,relatedStatus:related.status,acceptedAt:related.status==='accepted'?related.accepted_at:null};
  if(!coa){const request=source.find(row=>row.id===id),plan=request&&await makePlan(env,request,config,'coa',(deps.now||Date.now)(),originals,associations);if(plan)plans.set(id,plan);}
 }
 const keys=[...new Set([...plans.values()].map(plan=>plan.dedupe_key).filter((key):key is string=>Boolean(key)))],duplicates:Row[]=[];
 for(let offset=0;offset<keys.length;offset+=80){const chunk=keys.slice(offset,offset+80);duplicates.push(...(await env.DB.prepare(`SELECT * FROM coa_delivery_outbox WHERE purpose='coa' AND dedupe_key IN (${chunk.map(()=>'?').join(',')})`).bind(...chunk).all<Row>()).results);}
 for(const [id,plan] of plans){const other=duplicates.find(row=>row.dedupe_key===plan.dedupe_key);
  requests[id].coa=other?{...statusOf(other,false),status:'duplicate',reason:'same_original_already_queued_accepted_or_under_review',duplicateOfRequestId:other.request_id,relatedStatus:other.status,acceptedAt:other.status==='accepted'?other.accepted_at:null,canProcess:false}:{...statusOf(plan,ready),status:plan.status==='queued'?'ready':plan.status};
 }
 return {config,mailConfigured:mailReady(env),sender:senderFor(env)||'',approvedReportCount:approvedCoaReportCount(originals,associations),requests};
}
export async function coaDeliveryStatuses(env:CoaEnvironment,ids:string[],deps:Dependencies={}){return (await coaAutomationStatus(env,ids,deps)).requests;}
async function mark(env:CoaEnvironment,row:Row,status:Row['status'],reason:string,now:number,acceptedId?:string){
 return env.DB.prepare('UPDATE coa_delivery_outbox SET status=?,reason=?,provider_id=?,accepted_at=?,lease_token=NULL,lease_until=NULL,updated=? WHERE id=? AND lease_token=? AND status=\'sending\'').bind(status,reason,acceptedId||null,acceptedId?now:null,now,row.id,row.lease_token).run().then(result=>result.meta.changes>0);
}
export async function processCoaOutbox(env:CoaEnvironment,options:{requestId?:string;purpose?:Purpose;limit?:number}={},deps:Dependencies={}){
 // Customer COAs now require Ash's approval in Jarvis. Never retry the retired
 // direct-send queue, including jobs created by an older deployed client.
 if(options.purpose==='coa')return {processed:0,accepted:0,review:0};
 const config=await readCoaConfig(env);if(!config.enabled||!mailReady(env))return {processed:0,accepted:0,review:0};
 if(options.requestId!==undefined&&!validId(options.requestId))throw new Error('Choose an existing request.');
 if(options.purpose!==undefined&&!['coa','request-alert'].includes(options.purpose))throw new Error('Choose a valid message purpose.');
 const scopeWhere=" AND purpose='request-alert'"+(options.requestId?' AND request_id=?':'')+(options.purpose?' AND purpose=?':''),scopeValues=[...(options.requestId?[options.requestId]:[]),...(options.purpose?[options.purpose]:[])];
 const now=(deps.now||Date.now)(),limit=Math.max(1,Math.min(10,Math.floor(options.limit||5)));
 // No historical request scan: only existing queued jobs are considered.
 // A terminal unknown outcome retains recipient/report dedupe until an operator investigates.
 await env.DB.prepare("UPDATE coa_delivery_outbox SET status='manual_review',reason='retry_limit_or_unknown_outcome',lease_token=NULL,lease_until=NULL,updated=? WHERE status='sending' AND attempts>=5 AND lease_until<=?"+scopeWhere).bind(now,now,...scopeValues).run();
 await env.DB.prepare("UPDATE coa_delivery_outbox SET status='manual_review',reason='retry_window_expired',lease_token=NULL,lease_until=NULL,updated=? WHERE status IN ('queued','sending') AND first_attempt_at IS NOT NULL AND first_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?)"+scopeWhere).bind(now,now-SAFE_RETRY,now,...scopeValues).run();
 const rows=(await env.DB.prepare("SELECT * FROM coa_delivery_outbox WHERE (status='queued' OR (status='sending' AND lease_until<=?)) AND next_attempt_at<=?"+scopeWhere+" ORDER BY created,id LIMIT ?").bind(now,now,...scopeValues,limit).all<Row>()).results;
 let processed=0,accepted=0,review=0;
 for(const candidate of rows){
  if(!(await readCoaConfig(env)).enabled)break;
  const claimAt=(deps.now||Date.now)(),token=(deps.uuid||(()=>crypto.randomUUID()))();
  const row=await env.DB.prepare("UPDATE coa_delivery_outbox SET status='sending',reason='sending',lease_token=?,lease_until=?,attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?),updated=? WHERE id=? AND attempts<5 AND (status='queued' OR (status='sending' AND lease_until<=?)) AND next_attempt_at<=? AND (first_attempt_at IS NULL OR first_attempt_at>?) AND (first_attempt_at IS NOT NULL OR ((SELECT COUNT(*) FROM coa_delivery_outbox WHERE purpose=? AND first_attempt_at>=?)<? AND (?='request-alert' OR (SELECT COUNT(*) FROM coa_delivery_outbox WHERE purpose='coa' AND recipient_hash=? AND first_attempt_at>=?)<3))) RETURNING *").bind(token,claimAt+LEASE,claimAt,claimAt,candidate.id,claimAt,claimAt,claimAt-SAFE_RETRY,candidate.purpose,claimAt-DAY,CAPS[candidate.purpose],candidate.purpose,candidate.recipient_hash,claimAt-DAY).first<Row>();
  if(!row)continue;processed++;
  try {
   if(row.purpose!=='request-alert')throw new Error('owner_review_required');
   if(!coaEmail(row.recipient)||!coaSender(row.sender)||!coaEmail(row.reply_to)||!row.subject||!row.body||await coaHash(payloadFingerprint(row))!==row.payload_hash)throw new Error('snapshot_integrity_failed');
   const payload:{from:string;to:string[];reply_to:string;subject:string;text:string;attachments?:{filename:string;content:string}[]}={from:row.sender!,to:[row.recipient!],reply_to:row.reply_to!,subject:row.subject,text:row.body};
   // Existing v1 snapshots retain their exact payload and idempotency key on retry.
   if(!['request-alert-v1','request-alert-v2'].includes(row.template_version))throw new Error('snapshot_integrity_failed');
   const response=await (deps.fetch||fetch)('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY!.trim(),'Content-Type':'application/json','Idempotency-Key':row.idempotency_key},body:JSON.stringify(payload),redirect:'manual',signal:AbortSignal.timeout(10000)});
   if(response.ok){const data=await response.json() as {id?:unknown};if(typeof data.id!=='string'||!/^[a-f0-9-]{36}$/.test(data.id))throw new Error('provider_outcome_unknown');if(await mark(env,row,'accepted','accepted_by_email_provider',(deps.now||Date.now)(),data.id))accepted++;}
   else if(response.status===429||response.status>=500||response.status===409)throw new Error('provider_retry');
   else {if(await mark(env,row,'manual_review','provider_rejected',(deps.now||Date.now)()))review++;}
  }catch(error){
   const reason=error instanceof Error?error.message:'';
   if(['original_integrity_failed','snapshot_integrity_failed','original_unavailable'].includes(reason)){if(await mark(env,row,'manual_review',reason,(deps.now||Date.now)()))review++;}
   else if(row.attempts>=5){if(await mark(env,row,'manual_review','retry_limit_or_unknown_outcome',(deps.now||Date.now)()))review++;}
   else {const later=(deps.now||Date.now)();await env.DB.prepare("UPDATE coa_delivery_outbox SET status='queued',reason='retry_pending_or_unknown_outcome',next_attempt_at=?,lease_token=NULL,lease_until=NULL,updated=? WHERE id=? AND lease_token=? AND status='sending'").bind(later+[300000,1800000,7200000,21600000][Math.min(row.attempts-1,3)],later,row.id,row.lease_token).run();}
  }
 }
 return {processed,accepted,review};
}
