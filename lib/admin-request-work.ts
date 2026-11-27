import { withAuditDb } from './change-history';
import type { RequestWork } from './admin-request-queue';
export class RequestWorkError extends Error { constructor(message:string,public status=400){super(message);} }
export async function saveRequestWork(db:D1Database,actor:{email:string},input:Record<string,unknown>,assignees:readonly string[],now=Date.now()):Promise<RequestWork>{
 const id=typeof input.id==='string'?input.id:'';
 if(!/^[a-f0-9-]{36}$/.test(id))throw new RequestWorkError('Choose an existing request.');
 const version=input.expectedVersion;if(!Number.isSafeInteger(version)||Number(version)<0)throw new RequestWorkError('Refresh the request before saving.');
 const assignee=typeof input.assignee==='string'&&input.assignee.trim()?input.assignee.trim().toLowerCase():null;
 if(assignee&&!assignees.some(email=>email.trim().toLowerCase()===assignee))throw new RequestWorkError('Choose an active team member.');
 const nextAction=typeof input.nextAction==='string'?input.nextAction.trim():'',resolution=typeof input.resolution==='string'?input.resolution.trim():'';
 if(nextAction.length>300||resolution.length>1000)throw new RequestWorkError('Keep the next action under 300 characters and resolution under 1000.');
 const triage=input.triage;if(!['unreviewed','customer','vendor'].includes(String(triage)))throw new RequestWorkError('Choose customer, vendor or unreviewed.');
 const dueAt=input.dueAt==null?null:Number(input.dueAt);if(dueAt!==null&&(!Number.isSafeInteger(dueAt)||dueAt<0||dueAt>8640000000000000))throw new RequestWorkError('Choose a valid due date.');
 if(!await db.prepare("SELECT id FROM requests WHERE id=? AND kind IN ('contact','stock','affiliate')").bind(id).first())throw new RequestWorkError('Request not found.',404);
 const audit=withAuditDb(db,{source:'admin',actor:actor.email,actorType:'staff',action:'request.work'});
 const result=await audit.prepare(`INSERT INTO request_work(request_id,assignee,next_action,due_at,resolution,triage,version,updated,updated_by)
 SELECT ?,?,?,?,?,?,1,?,? WHERE ?=0 AND NOT EXISTS(SELECT 1 FROM request_work WHERE request_id=?)
 ON CONFLICT(request_id) DO NOTHING`).bind(id,assignee,nextAction,dueAt,resolution,triage,now,actor.email,version,id).run();
 let changed=Boolean(result.meta.changes);
 if(!changed&&Number(version)>0){const r=await audit.prepare('UPDATE request_work SET assignee=?,next_action=?,due_at=?,resolution=?,triage=?,version=version+1,updated=?,updated_by=? WHERE request_id=? AND version=?').bind(assignee,nextAction,dueAt,resolution,triage,now,actor.email,id,version).run();changed=Boolean(r.meta.changes);}
 if(!changed)throw new RequestWorkError('Another teammate changed this request. Refresh and review before saving.',409);
 return {assignee,nextAction,dueAt,resolution,triage:triage as RequestWork['triage'],version:Number(version)+1,updated:now,updatedBy:actor.email};
}
