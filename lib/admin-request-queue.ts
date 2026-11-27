// Full-history request queues. Only the selected page and explicit focus record leave the server.
export const requestQueues=['todo','waiting','followup','done','pitch','spam','deleted','all'] as const;
export type RequestQueue=typeof requestQueues[number];
export type RequestWork={assignee:string|null;nextAction:string;dueAt:number|null;resolution:string;triage:'unreviewed'|'customer'|'vendor';version:number;updated:number|null;updatedBy:string|null};
export type QueuedRequest={id:string;kind:string;status:string;created:number;data:Record<string,unknown>;queueStage:Exclude<RequestQueue,'all'>;work:RequestWork};
export type RequestQueueResult={requests:QueuedRequest[];counts:Record<RequestQueue,number>;total:number;offset:number;limit:number;hasMore:boolean;pageIds:string[]};
// Outgoing evidence is specific to this request, never inferred from another conversation by email.
const cte=`WITH evidence AS (
 SELECT r.*,d.status draft_status,d.reason draft_reason,d.approved_at,i.issue,
 w.assignee,w.next_action,w.due_at,w.resolution,w.triage,w.version,w.updated work_updated,w.updated_by,
 MAX(CASE WHEN COALESCE(json_extract(r.data,'$.origin'),'')='order' THEN 0 ELSE r.created END,COALESCE((SELECT MAX(m.created) FROM request_reply_messages m WHERE m.request_id=r.id AND m.direction='incoming' AND NOT (COALESCE(json_extract(r.data,'$.origin'),'')='order' AND m.id LIKE 'original:%')),0)) last_in,
 MAX(COALESCE((SELECT MAX(m.created) FROM request_reply_messages m WHERE m.request_id=r.id AND m.direction='outgoing'),0),COALESCE((SELECT MAX(e.sent_at) FROM request_external_replies e WHERE e.request_id=r.id AND (e.source='manual' OR e.recorded_by='Jarvis exact conversation check')),0)) last_out,
 COALESCE((SELECT MAX(e.sent_at) FROM request_external_replies e WHERE e.request_id=r.id AND (e.source='manual' OR e.recorded_by='Jarvis exact conversation check')),0) outside_at,
 EXISTS(SELECT 1 FROM request_reply_messages m WHERE m.request_id=r.id AND m.direction='incoming' AND m.id NOT LIKE 'original:%') has_incoming
 FROM requests r LEFT JOIN request_reply_drafts d ON d.request_id=r.id LEFT JOIN request_issues i ON i.request_id=r.id LEFT JOIN request_work w ON w.request_id=r.id
 WHERE r.kind IN ('contact','affiliate','stock')
),classified AS (SELECT *,CASE
 WHEN status='deleted' THEN 'deleted' WHEN status='spam' THEN 'spam'
 WHEN draft_reason='local_sent_without_provider_receipt' THEN 'waiting'
 WHEN draft_status='sending' OR (approved_at>0 AND draft_status NOT IN ('sent','needs_review')) THEN 'todo'
 WHEN issue='owner_review' AND status!='resolved' THEN 'todo'
 WHEN triage='vendor' OR (COALESCE(triage,'unreviewed')='unreviewed' AND issue='vendor') THEN 'pitch'
 WHEN last_out>0 AND last_in<last_out AND (status!='in_progress' OR outside_at>last_in) THEN CASE WHEN status='resolved' THEN 'done' ELSE 'waiting' END
 WHEN status='resolved' AND NOT(last_out>0 AND last_in>=last_out) THEN 'done'
 WHEN COALESCE(json_extract(data,'$.origin'),'')='order' AND has_incoming=0 THEN 'followup'
 ELSE 'todo' END queue_stage FROM evidence)`;
const decode=(r:Record<string,any>):QueuedRequest=>{let data:Record<string,unknown>={};try{const parsed=JSON.parse(r.data);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))data=parsed;}catch{/* retained record remains visible */}return {id:r.id,kind:r.kind,status:r.status,created:r.created,data,queueStage:r.queue_stage,work:{assignee:r.assignee||null,nextAction:r.next_action||'',dueAt:r.due_at??null,resolution:r.resolution||'',triage:r.triage||'unreviewed',version:r.version||0,updated:r.work_updated??null,updatedBy:r.updated_by||null}};};
export async function requestQueue(db:D1Database,input:Record<string,unknown>):Promise<RequestQueueResult>{
 const queue=requestQueues.includes(input.queue as RequestQueue)?input.queue as RequestQueue:'todo';
 const query=typeof input.query==='string'?input.query.trim().slice(0,120):'';
 const offset=Math.max(0,Math.min(10000000,Number.isSafeInteger(input.offset)?Number(input.offset):0)),limit=50;
 const clauses:string[]=[],values:(string|number)[]=[];
 if(queue==='all')clauses.push("queue_stage!='deleted'");else if(queue==='done')clauses.push("queue_stage IN ('done','waiting')");else clauses.push('queue_stage=?'),values.push(queue);
 if(query){clauses.push("(id LIKE ? ESCAPE '\\' OR data LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM request_reply_messages m WHERE m.request_id=classified.id AND m.body LIKE ? ESCAPE '\\') OR EXISTS(SELECT 1 FROM request_external_replies e WHERE e.request_id=classified.id AND e.body LIKE ? ESCAPE '\\'))");const term='%'+query.replace(/[\\%_]/g,'\\$&')+'%';values.push(term,term,term,term);}
 if(typeof input.assignee==='string'&&input.assignee){if(input.assignee==='unassigned')clauses.push('assignee IS NULL');else clauses.push('assignee=?'),values.push(input.assignee.slice(0,254).toLowerCase());}
 if(input.overdue===true)clauses.push("due_at IS NOT NULL AND due_at<? AND status NOT IN ('resolved','spam','deleted')"),values.push(Date.now());
 const where=' WHERE '+clauses.join(' AND '),order=queue==='todo'?'last_in ASC,created ASC,id ASC':'created DESC,id DESC';
 const [rawCounts,count,rows]=await Promise.all([
  db.prepare(cte+' SELECT queue_stage,COUNT(*) n FROM classified GROUP BY queue_stage').all<{queue_stage:RequestQueue;n:number}>(),
  db.prepare(cte+' SELECT COUNT(*) n FROM classified'+where).bind(...values).first<{n:number}>(),
  db.prepare(cte+' SELECT * FROM classified'+where+' ORDER BY '+order+' LIMIT ? OFFSET ?').bind(...values,limit,offset).all<Record<string,any>>(),
 ]);
 const counts=Object.fromEntries(requestQueues.map(k=>[k,0])) as Record<RequestQueue,number>;
 for(const r of rawCounts.results){counts[r.queue_stage]=r.n;if(r.queue_stage!=='deleted')counts.all+=r.n;}counts.done+=counts.waiting;
 const requests=rows.results.map(decode),pageIds=requests.map(r=>r.id);
 const focus=typeof input.focusId==='string'&&/^[a-f0-9-]{36}$/.test(input.focusId)?input.focusId:null;
 if(focus&&!pageIds.includes(focus)){const row=await db.prepare(cte+' SELECT * FROM classified WHERE id=?').bind(focus).first<Record<string,any>>();if(row)requests.push(decode(row));}
 return {requests,counts,total:count?.n||0,offset,limit,hasMore:offset+limit<(count?.n||0),pageIds};
}
