// Private operational correspondence. These functions never send email.
import { coaEmail, coaHash, coaMessage, exactCoaReport, labelLotMismatch, labelLotOf, hasInvalidLabelLot, lotComparisonKey, resolveLotOriginal, reportForLabelLot, coaReportByHash, readCoaOriginal, verifiedCoaAttachment, isCoaRequest, type OriginalCoaMetadata } from './coa-delivery';
import { customerContext, orderFollowUp, type CustomerContext } from './customer-context';
import { loadCoaBatchContext } from './product-batch';
import { withAuditDb, type AuditActor } from './change-history';
import { activePromotions } from './promotions';
import { openRequestsForBridge, recordMailboxReplies } from './request-external';
import { isIssue, issueLabel, resolutionLabel, looksLikePitchText } from './request-issues';
import { matchedCoaReplyProblem } from './reply-composer';
import { aiDraftGate, looksLikeSolicitation, type GateResult } from './reply-gate';
import { followupStateStatements, answeredFollowupStateStatements } from './request-followups';
export const REPLY_SENDER = 'contact@trybiomod.com';
type Env = { DB: D1Database };
type Actor = { email: string; role: string };
export type ReplyCoa = {state:'matched'|'needs_review'|'already_sent'|'not_requested';reason:string;extras?:ReplyCoa[];productName?:string;strength?:string;lot?:string;reportId?:string;chemicalIdentity?:string;sha256?:string;filename?:string};
export type ReplyMessage = {id:string;direction:'incoming'|'outgoing';body:string;created:number;
 /** Outgoing only, so staff can see exactly what went where and who pressed Send. */
 from?:string;to?:string;subject?:string;sentBy?:string;attachment?:string;source?:'recovery'|'mailbox'};
// Who sent it and what was attached, read from the draft that produced the message.
const MESSAGE_COLUMNS="m.id,m.direction,m.body,m.created,m.sender msg_from,m.recipient msg_to,m.attachment_hash,CASE WHEN m.direction='outgoing' AND m.reply_job_id IS NULL THEN 'mailbox' END msg_source,d.subject msg_subject,d.approved_by msg_by,d.coa_json msg_coa";
type MessageRow=ReplyMessage&{msg_source?:'mailbox'|null;msg_from?:string|null;msg_to?:string|null;attachment_hash?:string|null;msg_subject?:string|null;msg_by?:string|null;msg_coa?:string|null};
function messageOf(row:MessageRow):ReplyMessage{const{msg_source,msg_from,msg_to,attachment_hash,msg_subject,msg_by,msg_coa,...m}=row;const base:ReplyMessage={id:m.id,direction:m.direction,body:m.body,created:m.created};if(m.direction!=='outgoing')return base;
 let attachment='';if(attachment_hash){try{const coa=JSON.parse(msg_coa||'{}');attachment=coa.sha256===attachment_hash?(coa.filename||coa.reportId||'Lab report PDF'):'Lab report PDF';}catch{attachment='Lab report PDF';}}
 return {...base,...(msg_source?{source:msg_source}:{}),...(msg_from?{from:msg_from}:{}),...(msg_to?{to:msg_to}:{}),...(msg_subject?{subject:msg_subject}:{}),...(msg_by?{sentBy:msg_by}:{}),...(attachment?{attachment}:{})};}
export type ReplySummary = {id:string;requestId:string;revision:number;status:'queued'|'preparing'|'ready'|'needs_review'|'sending'|'sent'|'cancelled';mode:'ai'|'staff';sender:string;recipient:string;subject:string;body:string;preparedBy:string;updated:number;readyId?:string;model?:string;coa:ReplyCoa;history:ReplyMessage[];reason?:string;instruction?:string;purpose?:'checkout_recovery'|'reply';approvedAt?:number;approvedBy?:string;coaChoice?:string|null};
type Row={id:string;request_id:string;revision:number;status:ReplySummary['status'];mode:'ai'|'staff';sender:string;recipient:string;subject:string;proposed_body:string;instruction:string;body:string;prepared_by:string;request_hash:string;coa_json:string;ready_id:string|null;model:string|null;reason:string|null;attempts:number;lease_token:string|null;lease_until:number|null;send_locked_at:number|null;send_body_hash:string|null;provider_message_id:string|null;provider_thread_id:string|null;sent_at:number|null;created:number;updated:number;approved_at:number|null;approved_by:string|null;ai_draft:string|null;coa_choice:string|null};
type Inquiry={id:string;kind:string;data:string;created:number;status?:string};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const LEASE=300000;
const fail=(message:string,status=409):never=>{throw Object.assign(new Error(message),{status});};
const object=(v:unknown):Record<string,any>=>{if(!v||typeof v!=='object'||Array.isArray(v))fail('Invalid reply request.',400);return v as Record<string,any>;};
const parse=(v:string)=>{try{return object(JSON.parse(v));}catch{return {};}};
const text=(v:unknown,max:number,required=false):string=>{if(typeof v!=='string'||v.length>max||/[\u0000]/.test(v)||(required&&!v.trim()))fail('Enter a valid reply value.',400);return v as string;};
const id=(v:unknown)=>{if(typeof v!=='string'||!UUID.test(v))fail('Choose an existing reply.',400);return v as string;};
const revision=(v:unknown)=>{if(!Number.isSafeInteger(v)||Number(v)<1)fail('Choose the current reply revision.',400);return v as number;};
const reference=(v:unknown)=>{if(typeof v!=='string'||!v.trim()||v.length>512||/[\s\x00-\x1f\x7f]/.test(v))fail('Invalid provider reference.',400);return v as string;};
const stamp=(v:unknown)=>{if(!Number.isSafeInteger(v)||Number(v)<0||Number(v)>Date.now()+300000)fail('Invalid message date.',400);return v as number;};
const audit=(actor?:Actor):AuditActor=>actor?{source:actor.role==='system'?'system':'admin',actor:actor.email,actorType:actor.role==='system'?'system':'staff'}:{source:'system',actor:'Jarvis reply bridge',actorType:'system'};
const dbFor=(env:Env,actor?:Actor)=>withAuditDb(env.DB,audit(actor));
const rowFor=(env:Env,jobId:string)=>env.DB.prepare('SELECT * FROM request_reply_drafts WHERE id=?').bind(jobId).first<Row>();
const inquiryFor=(env:Env,requestId:string)=>env.DB.prepare("SELECT id,kind,data,created,status FROM requests WHERE id=? AND kind IN ('contact','affiliate','stock')").bind(requestId).first<Inquiry>();
const source=(request:Inquiry)=>{const d=parse(request.data),labelLot=labelLotOf(d);return {...(labelLot?{labelLot}:{}),name:typeof d.name==='string'?d.name.slice(0,100):'',email:coaEmail(d.email)||'',subject:typeof d.subject==='string'?d.subject.slice(0,150):request.kind==='affiliate'?'Partner application':request.kind==='stock'?'Product availability':'Website message',message:typeof d.message==='string'?d.message.slice(0,5000):'',created:request.created,origin:d.origin==='order'?'order' as const:d.origin==='coa-link'?'coa-link' as const:'website' as const};};
const facts=(report:OriginalCoaMetadata)=>({productName:report.productName,strength:report.strength,lot:report.lot,reportId:report.reportId,chemicalIdentity:report.chemicalIdentity,sha256:report.sha256,filename:report.filename});
const storedCoa=(row:Row):ReplyCoa=>{const v=parse(row.coa_json);return ['matched','needs_review','already_sent','not_requested'].includes(v.state)?v as ReplyCoa:{state:'needs_review',reason:'Report details require review.'};};
const noAttachmentClaim=(body:string)=>{
 // Fail closed for common affirmative attachment claims; clarification can simply ask for the lot.
 const plain=body.replace(/<blockquote[\s\S]*?<\/blockquote>/gi,'').replace(/<[^>]*>/g,' ');
 if(/\b(?:attached|enclosed)\b|\b(?:please\s+)?(?:find|see|review|sending|send|include|included)\b[^.\n]{0,60}\b(?:attachment|pdf|report)\b/i.test(plain))fail('This reply mentions an attachment but no original is approved. Edit it to request clarification.',409);
};
// choice: null = match the request's exact product/lot automatically; '' = no report;
// a sha256 = an approved original a staff member picked by hand from the private registry.
const matchedAttachmentCopy=(body:string)=>{const problem=matchedCoaReplyProblem(body);if(problem)fail(problem);};
type CoaPlan={coa:ReplyCoa;report?:OriginalCoaMetadata;attachment?:{filename:string;sha256:string;base64:string};extras?:{filename:string;sha256:string;base64:string}[]};
const choiceList=(choice:string|null)=>typeof choice==='string'&&choice.includes(',')?choice.split(',').filter(Boolean):null;
// Several chosen originals (comma-separated hashes): the first is the primary report; every extra must verify too.
async function coaFor(env:Env,request:Inquiry,ignoreId?:string,choice:string|null=null):Promise<CoaPlan>{
 const list=choiceList(choice);if(!list)return coaForOne(env,request,ignoreId,choice);
 const unique=[...new Set(list)].slice(0,5);const primary=await coaForOne(env,request,ignoreId,unique[0]);if(primary.coa.state!=='matched')return primary;
 const extras:{coa:ReplyCoa;attachment:{filename:string;sha256:string;base64:string}}[]=[];
 for(const sha of unique.slice(1)){const plan=await coaForOne(env,request,ignoreId,sha);if(plan.coa.state!=='matched'||!plan.attachment)return {coa:{...plan.coa,state:'needs_review',reason:'One of the chosen reports cannot be attached: '+plan.coa.reason}};extras.push({coa:plan.coa,attachment:plan.attachment});}
 return {...primary,coa:{...primary.coa,extras:extras.map(e=>e.coa)},extras:extras.map(e=>e.attachment)};
}
async function coaForOne(env:Env,request:Inquiry,ignoreId?:string,choice:string|null=null):Promise<CoaPlan>{
 const inquiry=source(request),chosen=typeof choice==='string'&&HASH.test(choice);
 if(choice==='')return {coa:{state:'not_requested',reason:'No report is attached to this reply.'}};
 if(!chosen&&!isCoaRequest(inquiry.subject))return {coa:{state:'not_requested',reason:'No COA was requested in this inquiry.'}};
 try{
  if(hasInvalidLabelLot(parse(request.data)))return {coa:{state:'needs_review',reason:'The vial lot contains invalid characters. Confirm the lot with the customer before attaching a report.'}};
  const context=await loadCoaBatchContext(env.DB),picked=chosen?context.originals.filter(item=>item.sha256===choice):[],labelLot=labelLotOf(parse(request.data)),report=chosen?(picked.length===1?picked[0]:null):labelLot?reportForLabelLot(labelLot,context.originals,context.associations):exactCoaReport(inquiry.subject,context.originals,context.associations);
  if(chosen&&!report)return {coa:{state:'needs_review',reason:'The chosen report is no longer an approved original. Choose another report.'}};
  const comparisonLot=labelLot||report?.lot;
  if(comparisonLot&&context.originals.filter(item=>lotComparisonKey(item.lot)===lotComparisonKey(comparisonLot)).length>1){
   const resolved=resolveLotOriginal(comparisonLot,context.originals,context.associations);
   if(!resolved)return {coa:{state:'needs_review',reason:'More than one approved report uses this lot number. Resolve the report records before attaching a COA.'}};
   if(chosen&&report?.sha256!==resolved.sha256)return {coa:{state:'needs_review',reason:'This lot has a different approved report selected in product records. Choose that original before sending.'}};
  }
  // Owner rule (Oct 14 2026), after a wrong-lot COA: never attach a report for a lot other than the one on the customer's vial.
  const wrongLot=report?labelLotMismatch(labelLot,report.lot):null;if(wrongLot)return {coa:{state:'needs_review',reason:wrongLot}};
  // Preserve old accepted/uncertain outcomes even if the current catalog association has changed.
  const own=chosen?null:await env.DB.prepare("SELECT a.status,a.attempts,a.accepted_at,a.duplicate_of,b.status AS related_status,b.attempts AS related_attempts FROM coa_delivery_outbox a LEFT JOIN coa_delivery_outbox b ON b.request_id=a.duplicate_of AND b.purpose='coa' WHERE a.request_id=? AND a.purpose='coa'").bind(request.id).first<any>();
  // Owner rule (Oct 12): a customer who asks for a report gets the PDF, even if it was emailed before.
  // Earlier sends only change the wording; the one guard kept is two copies sending at the same moment.
  const earlier=own&&(own.status==='accepted'||own.related_status==='accepted'||own.status==='sending'||own.related_status==='sending'||own.attempts>0||own.related_attempts>0);
  if(!report)return {coa:{state:'needs_review',reason:'No exact approved private original matches the product, strength, form and current lot. Review the original before attaching it.'}};
  const prior=await env.DB.prepare("SELECT status,attempts FROM coa_delivery_outbox WHERE purpose='coa' AND recipient_hash=? AND document_hash=? AND status!='duplicate' AND (status IN ('accepted','sending') OR attempts>0) ORDER BY CASE WHEN status='accepted' THEN 0 ELSE 1 END LIMIT 1").bind(await coaHash(inquiry.email),report.sha256).first<any>();
  const sent=await env.DB.prepare("SELECT id FROM request_reply_messages WHERE direction='outgoing' AND recipient=? AND attachment_hash=? LIMIT 1").bind(inquiry.email,report.sha256).first();
  const resend=Boolean(earlier||prior||sent);
  const locked=await env.DB.prepare("SELECT id FROM request_reply_drafts WHERE id!=? AND recipient=? AND status='sending' AND json_extract(coa_json,'$.sha256')=? LIMIT 1").bind(ignoreId||'',inquiry.email,report.sha256).first();
  if(locked)return {coa:{state:'needs_review',reason:'Another reply with this report to this customer is sending right now. Wait for it to finish.',...facts(report)}};
  const original=await readCoaOriginal(env.DB,report);if(!original)throw Error('missing');const attachment=await verifiedCoaAttachment(original);
  const current=await loadCoaBatchContext(env.DB);if(chosen?current.originals.filter(item=>item.sha256===report.sha256).length!==1:!coaReportByHash(report.sha256,current.originals,current.associations))throw Error('changed');
  if(comparisonLot&&current.originals.filter(item=>lotComparisonKey(item.lot)===lotComparisonKey(comparisonLot)).length>1&&resolveLotOriginal(comparisonLot,current.originals,current.associations)?.sha256!==report.sha256)throw Error('changed');
  return {coa:{state:'matched',reason:(resend?'This report was emailed to this customer before; it is attached again. ':'')+(chosen?'Chosen approved original. Its PDF hash is verified again before sending.':'Exact approved product, strength, form, lot and original PDF hash verified.'),...facts(report)},report,attachment:{filename:attachment.filename,sha256:report.sha256,base64:attachment.content}};
 }catch{return {coa:{state:'needs_review',reason:'The original report cannot be verified. Review the product, strength, lot and original document before attaching it.'}};}
}
// Immutable provider payloads remain in storage; the inbox and next drafting turn get readable text.
function readableMessage(body:string):string {
 if(!/<\/?(?:p|div|br|blockquote|html|body|span|table|li|pre)\b/i.test(body))return body;
 return body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?\s*>|<\/(?:p|div|blockquote|li|tr|pre)>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&(amp|lt|gt|quot|apos|nbsp);|&#(x[0-9a-f]+|[0-9]+);/gi,(whole,named,numeric)=>{if(named)return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '} as Record<string,string>)[named.toLowerCase()];const n=numeric[0].toLowerCase()==='x'?parseInt(numeric.slice(1),16):Number(numeric);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):whole;}).trim().slice(0,60000);
}
const visibleMessage=(m:ReplyMessage):ReplyMessage=>({...m,body:readableMessage(m.body)});
async function eligibilityRevision(env:Env){const r=await env.DB.prepare('SELECT revision FROM request_reply_coa_guard WHERE id=1').first<{revision:number}>();if(!r||!Number.isSafeInteger(r.revision))fail('Original-report send safeguards are unavailable.');return r!.revision;}
// Other requests from this exact customer provide context; they remain separate cases.
const inquiryMessages=(request:Inquiry):ReplyMessage[]=>{const d=parse(request.data);if(d.origin==='order')return [];const incoming=source(request);const body=d.origin==='coa-link'?'COA request form submitted. No written customer message was included.\n'+incoming.subject+(typeof d.labelLot==='string'?'\nLot entered: '+d.labelLot:''):incoming.message;return [{id:'original:'+request.id,direction:'incoming',body,created:request.created}];};
async function siblingMessages(env:Env,request:Inquiry):Promise<ReplyMessage[]>{
 const email=source(request).email;if(!email)return [];const since=Date.now()-90*86400000;
 const [requests,messages]=await Promise.all([
  env.DB.prepare("SELECT id,kind,data,created FROM requests WHERE id!=? AND kind IN ('contact','affiliate','stock') AND lower(trim(json_extract(data,'$.email')))=? AND status NOT IN ('spam','deleted') AND created>? ORDER BY created DESC LIMIT 10").bind(request.id,email,since).all<Inquiry>(),
  // Prior answers matter as much as prior questions. Both the request identity and message envelope
  // must match this customer; a name, account similarity or another customer's message is not evidence.
  env.DB.prepare(`SELECT ${MESSAGE_COLUMNS} FROM request_reply_messages m JOIN requests r ON r.id=m.request_id LEFT JOIN request_reply_drafts d ON d.id=m.reply_job_id WHERE r.id!=? AND r.kind IN ('contact','affiliate','stock') AND lower(trim(json_extract(r.data,'$.email')))=? AND r.status NOT IN ('spam','deleted') AND m.created>? AND ((m.direction='outgoing' AND lower(trim(m.recipient))=?) OR (m.direction='incoming' AND lower(trim(m.sender))=?)) ORDER BY m.created DESC,m.id DESC LIMIT 20`).bind(request.id,email,since,email,email).all<MessageRow>(),
 ]);
 return [...requests.results.flatMap(inquiryMessages),...messages.results.map(r=>visibleMessage(messageOf(r)))].filter(m=>m.body.trim());
}
async function recoveryMessages(env:Env,request:Inquiry):Promise<ReplyMessage[]>{
 const email=source(request).email;if(!email)return [];
 const rows=(await env.DB.prepare("SELECT c.order_id,c.accepted_at,c.savings AS savings_cents FROM checkout_recovery c JOIN orders o ON o.id=c.order_id WHERE lower(trim(json_extract(o.data,'$.email')))=? AND c.status='accepted' AND c.accepted_at IS NOT NULL ORDER BY c.accepted_at DESC LIMIT 20").bind(email).all<{order_id:string;accepted_at:number;savings_cents:number}>()).results;
 return rows.map(r=>({id:'recovery:'+r.order_id,direction:'outgoing',source:'recovery',created:r.accepted_at,body:'Checkout reminder accepted by the email provider. Inbox delivery is not confirmed.'+(r.savings_cents>0?' The saved order includes $'+(r.savings_cents/100).toFixed(2)+' in recovery savings.':'')}));
}
async function historyFor(env:Env,request:Inquiry):Promise<ReplyMessage[]>{const rows=(await env.DB.prepare(`SELECT ${MESSAGE_COLUMNS} FROM request_reply_messages m LEFT JOIN request_reply_drafts d ON d.id=m.reply_job_id WHERE m.request_id=? ORDER BY m.created DESC,m.id DESC LIMIT 20`).bind(request.id).all<MessageRow>()).results;return [...inquiryMessages(request),...rows.reverse().map(r=>visibleMessage(messageOf(r)))].sort((a,b)=>a.created-b.created).slice(-21);}
async function customerHistoryFor(env:Env,request:Inquiry):Promise<ReplyMessage[]>{return [...await recoveryMessages(env,request),...await siblingMessages(env,request)].sort((a,b)=>a.created-b.created).slice(-21);}
const recoveryPurpose=(row:Pick<Row,'instruction'>)=>row.instruction==='purpose:checkout_recovery'||row.instruction.startsWith('purpose:checkout_recovery\n');
const draftInstruction=(row:Pick<Row,'instruction'>)=>recoveryPurpose(row)?row.instruction.slice('purpose:checkout_recovery'.length).trimStart():row.instruction;
const summary=(row:Row,history:ReplyMessage[]):ReplySummary=>({id:row.id,requestId:row.request_id,revision:row.revision,status:row.status,mode:row.mode,sender:row.sender,recipient:row.recipient,subject:row.subject,body:row.status==='cancelled'?'':row.body||row.proposed_body,preparedBy:row.prepared_by,updated:row.updated,...(row.ready_id?{readyId:row.ready_id}:{}),...(row.model?{model:row.model}:{}),coa:storedCoa(row),history,...(row.reason?{reason:row.reason}:{}),purpose:recoveryPurpose(row)?'checkout_recovery':'reply',...(draftInstruction(row)?{instruction:draftInstruction(row)}:{}),...(row.approved_at?{approvedAt:row.approved_at,approvedBy:row.approved_by||''}:{}),coaChoice:row.coa_choice??null});
export async function summarizeRequestReplies(env:Env,ids:string[]):Promise<Record<string,ReplySummary>>{
 const unique=[...new Set(ids)].filter(v=>UUID.test(v)).slice(0,200),out:Record<string,ReplySummary>={};
 for(let offset=0;offset<unique.length;offset+=60){const chunk=unique.slice(offset,offset+60),marks=chunk.map(()=>'?').join(',');const rows=(await env.DB.prepare(`SELECT * FROM request_reply_drafts WHERE request_id IN (${marks})`).bind(...chunk).all<Row>()).results;if(!rows.length)continue;
  const sources=(await env.DB.prepare(`SELECT id,kind,data,created FROM requests WHERE id IN (${marks})`).bind(...chunk).all<Inquiry>()).results;
  const messages=(await env.DB.prepare(`SELECT m.request_id,${MESSAGE_COLUMNS} FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY request_id ORDER BY created DESC,id DESC) AS rn FROM request_reply_messages WHERE request_id IN (${marks})) m LEFT JOIN request_reply_drafts d ON d.id=m.reply_job_id WHERE m.rn<=20 ORDER BY m.created,m.id`).bind(...chunk).all<MessageRow&{request_id:string}>()).results;
  for(const row of rows){const request=sources.find(r=>r.id===row.request_id);if(request)out[row.request_id]=summary(row,[...inquiryMessages(request),...messages.filter(m=>m.request_id===row.request_id).map(({request_id:_,...m})=>visibleMessage(messageOf(m)))].sort((a,b)=>a.created-b.created).slice(-21));}
 }return out;
}
export async function replyCustomerContext(env:Env,requestId:string):Promise<CustomerContext|null>{
 const request=await inquiryFor(env,requestId);if(!request)return null;const incoming=source(request);
 return customerContext(env.DB as any,incoming.email,incoming.subject+'\n'+incoming.message);
}
export type ReplyAttachmentInput={requestId:string;expectedRevision:number|null;coaSha256?:string|null};
export type ReplyAttachmentPreview={requestId:string;revision:number|null;coaChoice:string|null;coa:ReplyCoa;checkedAt:number};
function validateCoaChoice(choice:unknown){
 if(choice!==undefined&&choice!==null&&choice!==''&&(typeof choice!=='string'||choice.split(',').length>5||!choice.split(',').every(v=>HASH.test(v))))fail('Choose a valid report.',400);
}
/** Read-only attachment check for the current composer. Never saves a draft, approves or sends. */
export async function previewReplyAttachments(env:Env,input:ReplyAttachmentInput,actor:Actor):Promise<ReplyAttachmentPreview>{
 if(!['owner','manager','support'].includes(actor.role)||!coaEmail(actor.email))fail('Reply attachment checks are not permitted.',403);
 const requestId=id(input.requestId);validateCoaChoice(input.coaSha256);
 if(input.expectedRevision!==null&&(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1))fail('Choose the current reply revision.',400);
 const request=await inquiryFor(env,requestId);if(!request)fail('Request not found.',404);
 const available=(inquiry:Inquiry|null)=>{if(!inquiry||['spam','deleted'].includes(inquiry.status||''))fail('Restore this request before checking attachments.');if(!source(inquiry!).email)fail('The original request needs a valid recipient.',400);};
 available(request);
 const old=await env.DB.prepare('SELECT * FROM request_reply_drafts WHERE request_id=?').bind(requestId).first<Row>();
 const current=(row:Row|null)=>{if((row?.revision??null)!==input.expectedRevision)fail('This reply changed. Refresh before checking attachments.');if(row?.status==='sending'||row?.send_locked_at)fail('A send is awaiting confirmation. Review its outcome before changing attachments.');};
 current(old);
 const choice=input.coaSha256===undefined?(old?.coa_choice??null):input.coaSha256;
 const plan=await coaFor(env,request!,old?.id,choice);
 // A slow original-PDF read must not label an older request or reply as verified.
 const [latestRequest,latestReply]=await Promise.all([inquiryFor(env,requestId),env.DB.prepare('SELECT * FROM request_reply_drafts WHERE request_id=?').bind(requestId).first<Row>()]);
 available(latestRequest);current(latestReply);
 if(latestRequest!.data!==request!.data)fail('The customer request changed. Refresh before checking attachments.');
 return {requestId,revision:old?.revision??null,coaChoice:choice,coa:plan.coa,checkedAt:Date.now()};
}
export type PrepareReplyRequest={requestId:string;mode:'ai'|'staff';body?:string;instruction?:string;expectedRevision:number|null;coaSha256?:string|null;send?:boolean;purpose?:'checkout_recovery'|'reply'};
export async function prepareRequestReply(env:Env,input:PrepareReplyRequest,actor:Actor):Promise<ReplySummary>{
 const requestId=id(input.requestId);if(!['owner','manager','support'].includes(actor.role)&&!(actor.role==='system'&&actor.email==='Website request automation'))fail('Reply drafting is not permitted.',403);
 if(actor.role!=='system'&&!coaEmail(actor.email))fail('Invalid staff identity.',403);
 if(!['ai','staff'].includes(input.mode))fail('Choose AI or staff drafting.',400);
 if(input.mode==='ai'&&await aiDraftingPaused(env))fail('AI drafting is paused by the owner. Write this reply yourself.',409);const body=text(input.body??'',12000,input.mode==='staff'),userInstruction=text(input.instruction??'',2000);
 // Sending is the owner's decision. Staff save drafts; only an owner's click approves the send.
 const send=input.send===true;if(send&&(actor.role!=='owner'||input.mode!=='staff'))fail('Only the owner can send a reply.',403);
 validateCoaChoice(input.coaSha256);
 const request=await inquiryFor(env,requestId);if(!request)fail('Request not found.',404);if(request!.status==='deleted')fail('This request was deleted. Restore it before replying.');if(request!.status==='spam'&&!send)fail('Move this request out of spam before preparing a reply.');const incoming=source(request!);if(!incoming.email)fail('The original request needs a valid recipient.',400);
 const old=await env.DB.prepare('SELECT * FROM request_reply_drafts WHERE request_id=?').bind(requestId).first<Row>();
 if(old?.reason==='local_sent_without_provider_receipt')fail('This email is marked sent in Jarvis. Verify its sent status before preparing or sending another reply.');
 if(old?.status==='sending'||old?.send_locked_at)fail('A send is awaiting confirmation. Review its outcome before replacing this reply.');
 if((old&&input.expectedRevision!==old.revision)||(!old&&input.expectedRevision!==null))fail('This reply changed. Refresh before preparing another revision.');
 if(input.purpose!==undefined&&!['checkout_recovery','reply'].includes(input.purpose))fail('Invalid reply purpose.',400);
 const purpose=input.purpose??(old&&recoveryPurpose(old)?'checkout_recovery':'reply');
 if(purpose==='checkout_recovery'){const check=await orderFollowUp(env.DB as any,String(parse(request!.data).orderId||''));if(!check.eligible)fail(check.reason);}
 const instruction=purpose==='checkout_recovery'?'purpose:checkout_recovery'+(userInstruction?'\n'+userInstruction:''):userInstruction;
 // Sending reopens a closed request so the send safeguards (which refuse closed requests) still apply.
 // Working on an archived or spam request (a send) takes it out of the archive, so the send safeguards apply.
 if((request!.status==='resolved'||(send&&request!.status==='spam')))await dbFor(env,actor).prepare("UPDATE requests SET status='in_progress' WHERE id=?").bind(requestId).run();
 const choice=input.coaSha256===undefined?(old?.coa_choice??null):input.coaSha256;
 const next=(old?.revision||0)+1,jobId=old?.id||crypto.randomUUID(),now=Date.now(),plan=await coaFor(env,request!,jobId,choice);
 if(send&&choice&&plan.coa.state!=='matched')fail(plan.coa.reason);
 if(input.mode==='staff'&&plan.coa.state!=='matched')noAttachmentClaim(body);
 if(plan.coa.state==='matched'&&body.trim())matchedAttachmentCopy(body);
 // Retain the prior wording for the private edit record; it is not reused for other customers.
 const aiDraft=input.mode==='ai'?null:old?.mode==='ai'&&old.body?old.body:old?.ai_draft??null;
 const proposed=body||(plan.report?coaMessage(plan.report).text:''),subject=incoming.origin==='order'||/^re:/i.test(incoming.subject)?incoming.subject:'Re: '+incoming.subject;
 const approvedAt=send?now:null,approvedBy=send?actor.email:null;
 const db=dbFor(env,actor);let result;
 if(old)result=await db.prepare("UPDATE request_reply_drafts SET revision=?,status='queued',mode=?,sender=?,recipient=?,subject=?,proposed_body=?,instruction=?,body='',prepared_by=?,request_hash=?,coa_json=?,ready_id=NULL,model=NULL,reason=NULL,attempts=0,lease_token=NULL,lease_until=NULL,send_locked_at=NULL,send_body_hash=NULL,provider_message_id=NULL,provider_thread_id=NULL,sent_at=NULL,approved_at=?,approved_by=?,ai_draft=?,coa_choice=?,updated=? WHERE id=? AND revision=? AND status!='sending' AND send_locked_at IS NULL").bind(next,input.mode,REPLY_SENDER,incoming.email,subject,proposed,instruction,actor.email,await coaHash(request!.data),JSON.stringify(plan.coa),approvedAt,approvedBy,aiDraft,choice,now,jobId,old.revision).run();
 else result=await db.prepare("INSERT OR IGNORE INTO request_reply_drafts(id,request_id,revision,status,mode,sender,recipient,subject,proposed_body,instruction,body,prepared_by,request_hash,coa_json,attempts,approved_at,approved_by,ai_draft,coa_choice,created,updated) VALUES(?,?,1,'queued',?,?,?,?,?,?,'',?,?,?,0,?,?,?,?,?,?)").bind(jobId,requestId,input.mode,REPLY_SENDER,incoming.email,subject,proposed,instruction,actor.email,await coaHash(request!.data),JSON.stringify(plan.coa),approvedAt,approvedBy,aiDraft,choice,now,now).run();
 if(!result.meta.changes)fail('This reply changed. Refresh before preparing another revision.');const saved=await rowFor(env,jobId);return summary(saved!,await historyFor(env,request!));
}
const matchReady=(row:Row|null,p:Record<string,any>)=>{if(!row||row.revision!==revision(p.revision)||row.ready_id!==reference(p.readyId))fail('This Ready to Send draft is no longer current.');return row!;};
async function currentRequest(env:Env,row:Row){const request=await inquiryFor(env,row.request_id);const review=await env.DB.prepare("SELECT updated FROM request_issues WHERE request_id=? AND issue='owner_review'").bind(row.request_id).first<{updated:number}>();if(review&&row.approved_at&&review.updated>row.approved_at)fail('This case was marked for owner review after approval. Review the reason and approve the current reply again.');if(recoveryPurpose(row)&&request){const check=await orderFollowUp(env.DB as any,String(parse(request.data).orderId||''));if(!check.eligible)fail(check.reason);}
 if(!request||['spam','resolved','deleted'].includes(request.status||''))fail('The request is unavailable or closed. Reopen it and prepare a new reply.');if(await coaHash(request!.data)!==row.request_hash||source(request!).email!==row.recipient)fail('The original request or recipient changed. Prepare a new reply.');return request!;}
async function currentCoa(env:Env,row:Row):Promise<CoaPlan&{requiresNewReview?:boolean}>{
 const request=await currentRequest(env,row),plan=await coaFor(env,request!,row.id,row.coa_choice??null),saved=storedCoa(row);const shas=(c:ReplyCoa)=>(c.extras||[]).map(e=>e.sha256).join(',');
 if(saved.state==='matched'&&(plan.coa.state!=='matched'||saved.sha256!==plan.coa.sha256||shas(saved)!==shas(plan.coa)))return {coa:{...saved,state:'needs_review',reason:'The originally prepared report changed. Review the attachment and prepare a new reply.'},requiresNewReview:true};
 // A new match (including a separator-only match after an update) cannot enlarge an older draft's attachments or approval.
 if(saved.state!=='matched'&&plan.coa.state==='matched')return {coa:{...saved,state:'needs_review',reason:'A matching report is now available. Review the attachment and prepare a new reply before sending.'},requiresNewReview:true};
 return plan;
}
const plainReply=(html:string)=>readableMessage(html.replace(/<blockquote[\s\S]*<\/blockquote>/gi,'')).replace(/\n{3,}/g,'\n\n').trim();
const squash=(value:string)=>value.replace(/\s+/g,' ').trim().toLowerCase();
// A private record of the AI's wording next to what the owner actually sent. Never shown publicly.
async function learnFromSend(env:Env,row:Row,sentHtml:string){
 const ai=row.mode==='ai'?row.body:row.ai_draft;if(!ai)return;const final=plainReply(sentHtml).slice(0,12000);if(!final)return;
 const request=await inquiryFor(env,row.request_id);const message=request?source(request).message.slice(0,2000):'';
 await env.DB.prepare('INSERT OR IGNORE INTO request_reply_learning(id,request_id,customer_message,instruction,ai_draft,final_body,changed,created) VALUES(?,?,?,?,?,?,?,?)').bind(row.id+':'+row.revision,row.request_id,message,row.instruction.slice(0,2000),ai.slice(0,12000),final,squash(ai)===squash(final)?0:1,Date.now()).run();
}
export type ReplyStyle={rules:string[];examples:{customer:string;draft:string;sent:string}[]};
export async function replyStyle(env:Env,issue:string|null=null):Promise<ReplyStyle>{
 // General rules plus the rules (SOP) for this request's issue type.
 const rules=(await env.DB.prepare('SELECT rule FROM request_reply_style WHERE active=1 AND (issue IS NULL OR issue=?) ORDER BY issue IS NOT NULL,created LIMIT 40').bind(issue||'').all<{rule:string}>()).results.map(r=>r.rule);
 // Sent messages remain in the private record. They are not reusable instructions or examples.
 const examples:ReplyStyle['examples']=[];
 return {rules,examples};
}
// Fixed release cutoff, not a rolling expiry: newer staff edits survive this one-time cleanup.
export const LEGACY_REPLY_CUTOFF = Date.parse('2026-10-28T22:00:00Z');
const LEGACY_REPLY_WHERE = "updated<=? AND status IN ('queued','preparing','ready','needs_review') AND send_locked_at IS NULL";
export async function retireStaleReplyDrafts(env:Env,actor:Actor){
 if(actor.role!=='owner')fail('Only the owner can remove old unsent drafts.',403);
 const before=(await env.DB.prepare('SELECT id,revision,updated FROM request_reply_drafts WHERE '+LEGACY_REPLY_WHERE).bind(LEGACY_REPLY_CUTOFF).all<{id:string;revision:number;updated:number}>()).results;
 let retired=0;
 for(const row of before){
  const result=await dbFor(env,actor).prepare("UPDATE request_reply_drafts SET revision=revision+1,status='cancelled',reason='retired_reply_policy_v2',ready_id=NULL,lease_token=NULL,lease_until=NULL,approved_at=NULL,approved_by=NULL,updated=? WHERE id=? AND revision=? AND updated=? AND "+LEGACY_REPLY_WHERE).bind(Date.now(),row.id,row.revision,row.updated,LEGACY_REPLY_CUTOFF).run();
  // One primary-key CAS retires at most one draft; D1 changes can include its audit trigger.
  if(result.meta.changes>0)retired++;
 }
 const remaining=await env.DB.prepare("SELECT SUM(CASE WHEN approved_at IS NOT NULL AND status NOT IN ('sent','cancelled') THEN 1 ELSE 0 END) approved,SUM(CASE WHEN status='sending' OR send_locked_at IS NOT NULL THEN 1 ELSE 0 END) locked FROM request_reply_drafts").first<{approved:number;locked:number}>();
 return {retired,changedSinceReview:before.length-retired,remainingApproved:remaining?.approved||0,pendingOutcomes:remaining?.locked||0};
}
export type ReplyDeskOptions={coas:{sha256:string;productName:string;strength:string;form:string;lot:string;reportId:string;current:boolean}[];codes:{code:string;percentOff:number}[];rules:{id:string;rule:string;issue:string|null}[];learning:{recent:number;unchanged:number};legacyDrafts?:number;bridgeSeen:number|null};
export async function replyDeskOptions(env:Env):Promise<ReplyDeskOptions>{
 const context=await loadCoaBatchContext(env.DB);
 const coas=context.originals.map(r=>({sha256:r.sha256,productName:r.productName,strength:r.strength,form:r.form,lot:r.lot,reportId:r.reportId,current:context.associations.some(a=>a.productId===r.productId&&a.coaAvailable&&a.lot===r.lot)})).sort((a,b)=>a.productName.localeCompare(b.productName)||Number(b.current)-Number(a.current)||a.lot.localeCompare(b.lot));
 const rules=(await env.DB.prepare('SELECT id,rule,issue FROM request_reply_style WHERE active=1 ORDER BY created LIMIT 200').all<{id:string;rule:string;issue:string|null}>()).results;
 const recent=(await env.DB.prepare('SELECT changed FROM request_reply_learning ORDER BY created DESC LIMIT 20').all<{changed:number}>()).results;
 const seen=await env.DB.prepare('SELECT seen FROM request_reply_bridge_seen WHERE id=1').first<{seen:number}>();
 const legacy=await env.DB.prepare('SELECT COUNT(*) n FROM request_reply_drafts WHERE '+LEGACY_REPLY_WHERE).bind(LEGACY_REPLY_CUTOFF).first<{n:number}>();
 return {coas,codes:activePromotions(),rules,legacyDrafts:legacy?.n||0,learning:{recent:recent.length,unchanged:recent.filter(r=>!r.changed).length},bridgeSeen:seen?.seen||null};
}
export async function saveReplyRule(env:Env,input:{rule?:string;removeId?:string;issue?:string|null},actor:Actor){
 if(!['owner','manager','support'].includes(actor.role))fail('Not permitted.',403);const db=dbFor(env,actor);
 if(input.removeId){await db.prepare('UPDATE request_reply_style SET active=0 WHERE id=?').bind(id(input.removeId)).run();return;}
 const rule=text(input.rule??'',500,true).trim();const issue=input.issue&&isIssue(input.issue)?input.issue:null;await db.prepare('INSERT INTO request_reply_style(id,rule,created_by,created,active,issue) VALUES(?,?,?,?,1,?)').bind(crypto.randomUUID(),rule,actor.email,Date.now(),issue).run();
}
export async function handleReplyBridge(env:Env,payload:unknown):Promise<Record<string,any>>{
 const p=object(payload),db=dbFor(env),now=Date.now();
 if(p.action==='claim'){
  await db.prepare("UPDATE request_reply_drafts SET status='needs_review',reason='Preparation retry limit reached. Review this draft.',lease_token=NULL,lease_until=NULL,updated=? WHERE status='preparing' AND lease_until<=? AND attempts>=5").bind(now,now).run();
  await env.DB.prepare('UPDATE request_reply_bridge_seen SET seen=? WHERE id=1 AND seen<?').bind(now,now-30000).run();
  // Owner-approved sends jump the queue; then oldest drafts first.
  const token=crypto.randomUUID();const row=await db.prepare("UPDATE request_reply_drafts SET status='preparing',lease_token=?,lease_until=?,attempts=attempts+1,updated=? WHERE id=(SELECT id FROM request_reply_drafts WHERE (status='queued' OR (status='preparing' AND lease_until<=?)) AND attempts<5 ORDER BY approved_at IS NULL,updated,id LIMIT 1) AND (status='queued' OR (status='preparing' AND lease_until<=?)) RETURNING *").bind(token,now+LEASE,now,now,now).first<Row>();
  if(!row)return {job:null};const request=await inquiryFor(env,row.request_id);
  // A request closed in the meantime (archived, spam, deleted) never blocks the queue.
  if(!request||['spam','resolved','deleted'].includes(request.status||'')){await db.prepare("UPDATE request_reply_drafts SET status='cancelled',reason='request_closed',lease_token=NULL,lease_until=NULL,updated=? WHERE id=? AND revision=? AND lease_token=?").bind(Date.now(),row.id,row.revision,token).run();return {job:null};}
  // AI drafts are checked against current facts at the moment of writing (owner, Oct 30 2026). Owner-approved sends are not.
  let gate:GateResult|null=null;
  if(row.mode==='ai'&&!row.approved_at){
   const d=parse(request.data);
   gate=await aiDraftGate(env.DB as any,request as any,now,async()=>{
    // Order conversations: never about a cancelled or refunded order; an unpaid one only while a checkout follow-up is still right.
    const orderId=typeof d.orderId==='string'?d.orderId:'';const o=await env.DB.prepare('SELECT status FROM orders WHERE id=?').bind(orderId).first<{status:string}>();
    if(!o)return {eligible:false,reason:'This order is no longer available.'};
    if(['cancelled','refunded','released','failed'].includes(o.status))return {eligible:false,reason:`Order ${orderId.slice(0,8).toUpperCase()} is ${o.status}.`};
    if(['creating','awaiting_payment','pending','review'].includes(o.status)){const f=await orderFollowUp(env.DB as any,orderId,now);return {eligible:f.eligible,reason:f.reason};}
    return {eligible:true,reason:''};
   });
   const paused=await aiDraftingPaused(env);
   if(paused||gate.stop){
    await db.prepare("UPDATE request_reply_drafts SET status='needs_review',reason=?,lease_token=NULL,lease_until=NULL,updated=? WHERE id=? AND revision=? AND status='preparing' AND lease_token=?").bind(paused?'AI drafting is paused by the owner. Write this reply yourself.':gate.stop,Date.now(),row.id,row.revision,token).run();
    if(!paused&&looksLikeSolicitation(String(d.subject||''),String(d.message||'')))await db.prepare("UPDATE requests SET status='spam' WHERE id=? AND status IN ('new','in_progress')").bind(row.request_id).run();
    return {job:null};
   }
  }
  const plan=await currentCoa(env,row);
  if(plan.requiresNewReview){await db.prepare("UPDATE request_reply_drafts SET status='needs_review',reason=?,approved_at=NULL,approved_by=NULL,lease_token=NULL,lease_until=NULL,updated=? WHERE id=? AND revision=? AND status='preparing' AND lease_token=?").bind(plan.coa.reason,Date.now(),row.id,row.revision,token).run();return {job:null};}
  const written=await db.prepare("UPDATE request_reply_drafts SET coa_json=?,updated=? WHERE id=? AND revision=? AND status='preparing' AND lease_token=?").bind(JSON.stringify(plan.coa),Date.now(),row.id,row.revision,token).run();if(!written.meta.changes)fail('Draft changed during preparation.');
  return {job:{id:row.id,requestId:row.request_id,revision:row.revision,leaseToken:token,mode:row.mode,sender:row.sender,recipient:row.recipient,subject:row.subject,instruction:draftInstruction(row),proposedBody:row.proposed_body,request:source(request!),history:(await historyFor(env,request!)).map(({id,direction,body,created})=>({id,direction,body,created})),coa:plan.coa,...('attachment' in plan&&plan.attachment?{attachment:plan.attachment}:{}),...(plan.extras?.length?{extraAttachments:plan.extras}:{}),preparedBy:row.prepared_by,...(gate?{latestIncomingAt:gate.latestIncomingAt,linkedEmails:gate.linkedEmails,linkedOrders:gate.linkedOrders}:{}),...(row.mode==='ai'?{customerHistory:(await customerHistoryFor(env,request!)).map(({id,direction,body,created})=>({id,direction,body,created})),customer:await customerContext(env.DB as any,source(request!).email,source(request!).subject+'\n'+source(request!).message).catch(()=>undefined)}:{}),...(row.approved_at?{approved:{by:row.approved_by||'',at:row.approved_at}}:{}),...(row.mode==='ai'?await (async()=>{const c=await env.DB.prepare('SELECT issue,resolutions,note FROM request_issues WHERE request_id=?').bind(row.request_id).first<{issue:string;resolutions:string;note:string}>().catch(()=>null);let res:string[]=[];try{res=c?JSON.parse(c.resolutions):[];}catch{res=[];}
   return {style:await replyStyle(env,c?.issue||null),codes:activePromotions(),...(c?{caseInfo:`Issue: ${issueLabel(c.issue)}.${res.length?' Recorded resolution: '+res.map(resolutionLabel).join(', ')+'.':''}${c.note?' Staff note: '+c.note.slice(0,500):''}`}:{})};})():{})}};
 }
 if(p.action==='retired_drafts')return {drafts:(await env.DB.prepare("SELECT id,revision FROM request_reply_drafts WHERE status='cancelled' AND reason='retired_reply_policy_v2' ORDER BY updated DESC LIMIT 200").all<{id:string;revision:number}>()).results};
 if(p.action==='open_requests')return {requests:await openRequestsForBridge(env)};
 // Jarvis drops a Ready to Send copy once its website draft is no longer ready or its request closed.
 if(p.action==='draft_states'){
  const ids=Array.isArray(p.ids)?p.ids.filter((v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v)).slice(0,100):[];
  if(!ids.length)return {drafts:[]};
  const rows=(await env.DB.prepare(`SELECT d.id,d.revision,d.status,d.ready_id,r.status request_status FROM request_reply_drafts d LEFT JOIN requests r ON r.id=d.request_id WHERE d.id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all<{id:string;revision:number;status:string;ready_id:string|null;request_status:string|null}>()).results;
  return {drafts:rows.map(r=>({id:r.id,revision:r.revision,readyId:r.ready_id,live:r.status==='ready'&&!['spam','resolved','deleted',null].includes(r.request_status as any)}))};
 }
 if(p.action==='external_replies')return recordMailboxReplies(env,p.replies);
 const jobId=id(p.id),rev=revision(p.revision),row=await rowFor(env,jobId);
 if(p.action==='sent'){const provider=reference(p.providerMessageId),readyId=reference(p.readyId),thread=p.providerThreadId===undefined?null:reference(p.providerThreadId),body=text(p.body,60000,true),sentAt=stamp(p.sentAt),oldAck=await env.DB.prepare('SELECT * FROM request_reply_messages WHERE reply_job_id=? AND reply_revision=? AND ready_id=?').bind(jobId,rev,readyId).first<any>();if(oldAck){if(oldAck.provider_message_id!==provider||oldAck.provider_thread_id!==thread||oldAck.body!==body||oldAck.created!==sentAt)fail('This provider acknowledgement conflicts with the saved send.');return {ok:true};}}
 if(p.action==='messages'){
  const readyId=reference(p.readyId),thread=reference(p.providerThreadId);
  const sent=await env.DB.prepare("SELECT request_id,sender,recipient,created FROM request_reply_messages WHERE reply_job_id=? AND reply_revision=? AND ready_id=? AND provider_thread_id=? AND direction='outgoing'").bind(jobId,rev,readyId,thread).first<{request_id:string;sender:string;recipient:string;created:number}>();
  if(!sent)fail('Import follow-ups only for the exact confirmed sent conversation.');if(!Array.isArray(p.messages)||p.messages.length>20)fail('Import at most 20 messages.',400);
  const statements:D1PreparedStatement[]=[],incomingIds:string[]=[],outgoingIds:string[]=[];for(const raw of p.messages){const m=object(raw),provider=reference(m.id),direction=m.direction;if(!['incoming','outgoing'].includes(direction))fail('Invalid message direction.',400);const body=text(m.body,60000,true),created=stamp(m.created);if(created<sent!.created)fail('Follow-up predates the confirmed sent conversation.');const messageId=await coaHash(sent!.sender+':'+provider);const existing=await env.DB.prepare('SELECT request_id,direction,body,created,provider_thread_id FROM request_reply_messages WHERE id=?').bind(messageId).first<any>();if(existing){if(existing.request_id!==sent!.request_id||existing.direction!==direction||existing.body!==body||existing.created!==created||existing.provider_thread_id!==thread)fail('Message identifier already belongs to different content.');continue;}
   statements.push(db.prepare('INSERT INTO request_reply_messages(id,request_id,direction,body,created,provider_message_id,provider_thread_id,sender,recipient,attachment_hash) VALUES(?,?,?,?,?,?,?,?,?,NULL)').bind(messageId,sent!.request_id,direction,body,created,provider,thread,direction==='incoming'?sent!.recipient:sent!.sender,direction==='incoming'?sent!.sender:sent!.recipient));
   if(direction==='incoming')incomingIds.push(messageId);else outgoingIds.push(messageId);
  }const incomingChanges=followupStateStatements(db,sent!.request_id,incomingIds,now),outgoingChanges=answeredFollowupStateStatements(db,sent!.request_id,outgoingIds,now),stateChanges=[...incomingChanges,...outgoingChanges],results=statements.length?await db.batch([...statements,...stateChanges]):[];const draftInvalidated=Boolean((incomingChanges.length&&results[statements.length+1]?.meta?.changes)||(outgoingChanges.length&&results[statements.length+incomingChanges.length]?.meta?.changes));return {ok:true,imported:statements.length,incomingImported:incomingIds.length,outgoingImported:outgoingIds.length,draftInvalidated};
 }
 if(p.action==='send_status_review'){
  const readyId=reference(p.readyId);if(p.reason!=='local_sent_without_provider_receipt')fail('Invalid sent-status reason.',400);
  if(!row)fail('Reply revision changed.');
  // Policy retirement discards an unsent draft's Ready link. It must not discard
  // a trusted companion's older Sent flag or permit that uncertain email again.
  const retired=Boolean(row!.revision>rev&&row!.status==='cancelled'&&row!.ready_id===null&&['retired_reply_policy_v2','local_sent_without_provider_receipt'].includes(row!.reason||''));
  if(!retired&&(row!.revision!==rev||row!.ready_id!==readyId))fail('Draft identity changed.');
  if(row!.send_locked_at||row!.provider_message_id||row!.sent_at||(!retired&&!['ready','needs_review'].includes(row!.status)))fail('A provider outcome already exists or is in progress.');
  if(row!.reason==='local_sent_without_provider_receipt')return {ok:true};
  const changed=await db.prepare("UPDATE request_reply_drafts SET status=?,approved_at=NULL,approved_by=NULL,reason='local_sent_without_provider_receipt',updated=? WHERE id=? AND revision=? AND status=? AND ready_id IS ? AND reason IS ? AND send_locked_at IS NULL AND provider_message_id IS NULL AND sent_at IS NULL").bind(retired?'cancelled':'needs_review',now,jobId,row!.revision,row!.status,row!.ready_id,row!.reason).run();if(!changed.meta.changes)fail('Draft changed.');return {ok:true};
 }
 if(!row||row.revision!==rev)fail('Reply revision changed.');
 if(p.action==='send_blocked'){
  // Jarvis refused an owner-approved send before any provider call. Clear the approval so the desk asks again.
  const readyId=reference(p.readyId);await db.prepare("UPDATE request_reply_drafts SET approved_at=NULL,approved_by=NULL,reason='send_blocked',updated=? WHERE id=? AND revision=? AND ready_id=? AND status='ready' AND send_locked_at IS NULL").bind(now,jobId,rev,readyId).run();return {ok:true};
 }
 if(p.action==='complete'||p.action==='fail'){
  if(p.action==='complete'&&row!.status==='ready'&&row!.ready_id===p.readyId&&row!.body===p.body&&row!.model===p.model)return {ok:true};
  if(row!.status!=='preparing'||row!.lease_token!==id(p.leaseToken)||!row!.lease_until||row!.lease_until<Date.now())fail('The preparation lease expired or changed.');
  if(p.action==='fail'){const code=typeof p.reason==='string'&&/^[a-z0-9_]{1,80}$/.test(p.reason)?p.reason:'bridge_preparation_failed';const r=await db.prepare("UPDATE request_reply_drafts SET status='needs_review',reason=?,lease_token=NULL,lease_until=NULL,updated=? WHERE id=? AND revision=? AND status='preparing' AND lease_token=? AND lease_until>=?").bind(code,now,jobId,rev,p.leaseToken,now).run();if(!r.meta.changes)fail('Draft changed.');return {ok:true};}
  const body=text(p.body,12000,true),model=text(p.model,120,true),readyId=reference(p.readyId);if(row!.mode==='staff'&&(body!==row!.proposed_body||model!=='staff'))fail('The staff reply must remain unchanged during preparation.');if(storedCoa(row!).state!=='matched')noAttachmentClaim(body);else matchedAttachmentCopy(body);
  const r=await db.prepare("UPDATE request_reply_drafts SET status='ready',body=?,model=?,ready_id=?,reason=NULL,lease_token=NULL,lease_until=NULL,updated=? WHERE id=? AND revision=? AND status='preparing' AND lease_token=? AND lease_until>=?").bind(body,model,readyId,now,jobId,rev,p.leaseToken,now).run();if(!r.meta.changes)fail('Draft changed.');return {ok:true};
 }
 const current=matchReady(row,p);
 if(p.action==='validate'){
  const body=text(p.body,60000,true);if(current.status!=='ready'||current.send_locked_at)fail('This send is already in progress or requires outcome review. Do not retry the email.');
  if(p.sender!==REPLY_SENDER||p.sender!==current.sender||coaEmail(p.recipient)!==current.recipient||p.recipient!==current.recipient)fail('The sender or recipient changed.');
  if(p.attachmentSha256!==null&&(typeof p.attachmentSha256!=='string'||!HASH.test(p.attachmentSha256)))fail('Invalid original attachment.');
  const guardRevision=await eligibilityRevision(env),validatedRequest=await currentRequest(env,current),plan=await currentCoa(env,current),expected=storedCoa(current);const extraShas=(c:ReplyCoa)=>(c.extras||[]).map(e=>e.sha256||'');const sentExtras=Array.isArray(p.extraSha256s)?p.extraSha256s:[];if(sentExtras.some((v:unknown)=>typeof v!=='string'||!HASH.test(v as string)))fail('Invalid original attachment.');
  if(plan.requiresNewReview)fail(plan.coa.reason);
  if(expected.state==='matched'&&(plan.coa.state!=='matched'||p.attachmentSha256!==expected.sha256||plan.coa.sha256!==expected.sha256||sentExtras.join(',')!==extraShas(expected).join(',')||extraShas(plan.coa).join(',')!==extraShas(expected).join(',')))fail('The original report changed or cannot be verified. Prepare a new draft.');
  if(expected.state!=='matched'){if(p.attachmentSha256!==null||sentExtras.length)fail('No original attachment is approved for this reply.');noAttachmentClaim(body);}else matchedAttachmentCopy(body);
  const r=await db.prepare("UPDATE request_reply_drafts SET status='sending',send_locked_at=?,send_body_hash=?,reason='Owner send authorized; awaiting provider outcome. Do not resend.',updated=? WHERE id=? AND revision=? AND ready_id=? AND status='ready' AND send_locked_at IS NULL AND EXISTS(SELECT 1 FROM request_reply_coa_guard WHERE id=1 AND revision=?) AND EXISTS(SELECT 1 FROM requests WHERE requests.id=request_reply_drafts.request_id AND requests.data=? AND requests.status NOT IN ('spam','resolved','deleted')) AND NOT EXISTS(SELECT 1 FROM request_issues review WHERE review.request_id=request_reply_drafts.request_id AND review.issue='owner_review' AND request_reply_drafts.approved_at IS NOT NULL AND review.updated>request_reply_drafts.approved_at) AND NOT EXISTS(SELECT 1 FROM request_reply_drafts other WHERE other.id!=? AND other.status='sending' AND other.recipient=request_reply_drafts.recipient AND json_extract(other.coa_json,'$.sha256')=json_extract(request_reply_drafts.coa_json,'$.sha256') AND json_extract(request_reply_drafts.coa_json,'$.state')='matched')").bind(now,await coaHash(body),now,jobId,rev,p.readyId,guardRevision,validatedRequest.data,jobId).run();if(!r.meta.changes)fail('Another send or revision now needs review. Do not resend.');return {ok:true,coa:plan.coa};
 }
 if(p.action==='sent'){
  const provider=reference(p.providerMessageId),thread=p.providerThreadId===undefined?null:reference(p.providerThreadId),body=text(p.body,60000,true),sentAt=stamp(p.sentAt);
  if(current.status==='sent'){if(current.provider_message_id!==provider||current.provider_thread_id!==thread||current.send_body_hash!==await coaHash(body)||current.sent_at!==sentAt)fail('This provider acknowledgement conflicts with the saved send.');return {ok:true};}
  if(current.status!=='sending'||!current.send_locked_at)fail('This reply has no owner-authorized send to acknowledge.');
  if(await coaHash(body)!==current.send_body_hash)fail('The acknowledged body differs from the owner-validated message.');
  const messageId=await coaHash(REPLY_SENDER+':'+provider),hash=storedCoa(current).state==='matched'?storedCoa(current).sha256||null:null;
  const previous=await env.DB.prepare('SELECT request_id,direction,body FROM request_reply_messages WHERE id=?').bind(messageId).first<any>();if(previous&&(previous.request_id!==current.request_id||previous.direction!=='outgoing'||previous.body!==body))fail('The provider identifier belongs to another message.');
  // A sent reply archives the request; a customer follow-up brings it back to To reply.
  // Resolve only this case. A different request from the same address is not answered by this email.
  // A customer message arriving after send authorization still needs a response, even if the provider ACK is later.
  await db.batch([db.prepare("UPDATE requests SET status='resolved' WHERE id=? AND status NOT IN ('spam','deleted','resolved') AND NOT EXISTS(SELECT 1 FROM request_reply_messages incoming WHERE incoming.request_id=requests.id AND incoming.direction='incoming' AND incoming.created>=?)").bind(current.request_id,current.send_locked_at),db.prepare("UPDATE request_reply_drafts SET status='sent',provider_message_id=?,provider_thread_id=?,sent_at=?,reason='The mail provider accepted this message. Inbox delivery is not confirmed.',send_locked_at=NULL,updated=? WHERE id=? AND revision=? AND ready_id=? AND status='sending'").bind(provider,thread,sentAt,now,jobId,rev,p.readyId),db.prepare("INSERT INTO request_reply_messages(id,request_id,direction,body,created,provider_message_id,provider_thread_id,sender,recipient,attachment_hash,reply_job_id,reply_revision,ready_id) SELECT ?,?,'outgoing',?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM request_reply_drafts WHERE id=? AND revision=? AND status='sent' AND provider_message_id=?) AND NOT EXISTS(SELECT 1 FROM request_reply_messages WHERE id=?)").bind(messageId,current.request_id,body,sentAt,provider,thread,REPLY_SENDER,current.recipient,hash,jobId,rev,p.readyId,jobId,rev,provider,messageId)]);
  const final=await rowFor(env,jobId);if(final?.status!=='sent'||final.provider_message_id!==provider)fail('Provider acknowledgement needs review.');
  await learnFromSend(env,current,body).catch(()=>undefined);return {ok:true};
 }
 return fail('Unknown reply bridge action.',400);
}

/** Owner pause (Oct 30 2026): AI drafts were wrong too often. While settings.reply_ai_v1.paused is true no AI draft is
 * prepared, automatically or from the desk; staff-written replies and sending are unaffected. A failed read counts as paused. */
export async function aiDraftingPaused(env:Env){
 try{const row=await env.DB.prepare("SELECT value FROM settings WHERE key='reply_ai_v1'").first<{value:string}>();return Boolean(row&&JSON.parse(row.value)?.paused===true);}
 catch{return true;}
}

/** New website message: the AI drafts a reply for customers only. Supplier sales pitches get no automatic draft. */
export async function autoDraftNewRequest(env:Env,requestId:string){
 const request=await inquiryFor(env,id(requestId));if(!request)return null;const d=source(request);
 // Supplier pitches go to Spam and are never answered (owner, Oct 30 2026).
 if(looksLikePitchText(d.subject,d.message)||looksLikeSolicitation(d.subject,d.message)){await dbFor(env,{email:'Website request automation',role:'system'}).prepare("UPDATE requests SET status='spam' WHERE id=? AND status='new'").bind(request.id).run();return null;}
 if(await aiDraftingPaused(env))return null;
 return prepareRequestReply(env,{requestId,mode:'ai',expectedRevision:null},{email:'Website request automation',role:'system'});
}
