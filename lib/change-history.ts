// Store-only change history. Auth is enforced by the route before querying this module.
// Never log request bodies, credentials, customer addresses/messages or provider references.
export type AuditActor = { source: 'admin' | 'system'; actor: string; actorType: 'staff' | 'system' | 'unknown'; action?: string; summary?: string };
type Scalar = string | number | boolean | null;
export type ChangeInput = { id?: string; occurredAt?: number; source: string; actor: string; actorType: string; action: string; entityType: string; entityId: string; summary: string; status: 'succeeded' | 'failed' | 'observed' | 'attempted'; changes?: {field:string;before:Scalar;after:Scalar}[]; evidenceUrl?: string; evidenceRef?: string };
const limitText = (value: string, length: number) => String(value).slice(0, length);
export async function auditBatch(db: D1Database, actor: AuditActor, statements: D1PreparedStatement[]) {
    // D1 batch is transactional: context cannot leak to another request. Failed changes
    // and failed history writes roll back together. Never span a provider call with context.
    const result = await db.batch([
        db.prepare('INSERT INTO change_context(id,actor,actor_type,source,action,summary) VALUES(1,?,?,?,?,?)').bind(limitText(actor.actor,254),actor.actorType,actor.source,actor.action || null,actor.summary || null),
        ...statements,
        db.prepare('DELETE FROM change_context WHERE id=1'),
    ]);
    return result.slice(1,-1);
}
export async function auditRun(db: D1Database, actor: AuditActor, sql: string, ...values: (string | number | null)[]) {
    return (await auditBatch(db,actor,[db.prepare(sql).bind(...values)]))[0];
}
/** Wrap only this operation's DB, never a global/runtime singleton or a long-lived context. */
export function withAuditDb(db: D1Database, actor: AuditActor): D1Database {
    const originals = new WeakMap<object,D1PreparedStatement>();
    const wrap = (statement: D1PreparedStatement, mutation: boolean): D1PreparedStatement => {
        const wrapped = new Proxy(statement,{get(target,key) {
            if(key==='bind') return (...values:unknown[])=>wrap(target.bind(...values), mutation);
            if(key==='run') return async()=> (await auditBatch(db,actor,[target]))[0];
            // UPDATE/INSERT ... RETURNING still mutates when consumed with first/all/raw.
            if(mutation && ['first','all','raw'].includes(String(key))) return async(option?:string|{columnNames?:boolean})=>{
                const result= (await auditBatch(db,actor,[target]))[0];
                const rows=result.results as Record<string,unknown>[];
                if(key==='all')return result;
                if(key==='first') {const row=rows[0];if(!row)return null;if(typeof option==='string'){if(!Object.hasOwn(row,option))throw Error('Requested result column is unavailable.');return row[option];}return row;}
                const columns=Object.keys(rows[0]||{}),values=rows.map(row=>columns.map(column=>row[column]));
                return typeof option==='object'&&option.columnNames?[columns,...values]:values;
            };
            const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
        }});
        originals.set(wrapped,statement);return wrapped;
    };
    return new Proxy(db,{get(target,key) {
        if(key==='prepare') return (sql:string)=>wrap(target.prepare(sql),!/^\s*(?:(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(?:SELECT|PRAGMA|EXPLAIN)\b/i.test(sql));
        if(key==='batch') return (statements:D1PreparedStatement[])=>auditBatch(target,actor,statements.map(s=>originals.get(s)||s));
        const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});
}
const safeEvidence = (value?:string) => {try {const u=new URL(value||'');u.search='';u.hash='';return u.protocol==='https:'&&!u.username&&!u.password&&((u.hostname==='github.com'&&u.pathname.startsWith('/thetaxfirm/biomodpeptides/'))||u.hostname==='dash.cloudflare.com')?u.href:undefined;}catch{return undefined;}};
export async function recordChange(db:D1Database,event:ChangeInput) {
    const now=Date.now(),occurred=event.occurredAt??now,id=event.id||crypto.randomUUID();
    if(!Number.isSafeInteger(occurred)||occurred<0)throw Error('Invalid change timestamp.');
    return db.prepare('INSERT OR IGNORE INTO change_events(id,occurred_at,recorded_at,source,actor,actor_type,action,entity_type,entity_id,summary,status,changes,evidence_url,evidence_ref) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM change_events WHERE id=?)').bind(
        id,occurred,now,limitText(event.source,40),limitText(event.actor,254),limitText(event.actorType,40),limitText(event.action,100),limitText(event.entityType,60),limitText(event.entityId,254),limitText(event.summary,1000),event.status,JSON.stringify(event.changes||[]),safeEvidence(event.evidenceUrl)||null,event.evidenceRef?limitText(event.evidenceRef,200):null,id,
    ).run();
}
type Row={id:string;occurred_at:number;recorded_at:number;source:string;actor:string;actor_type:string;action:string;entity_type:string;entity_id:string;summary:string;status:string;changes:string;evidence_url:string|null;evidence_ref:string|null};
const parseChanges=(value:string)=>{try{const v=JSON.parse(value);return Array.isArray(v)?v.filter(c=>c&&typeof c.field==='string'&&['string','number','boolean','object'].includes(typeof c.before)&&['string','number','boolean','object'].includes(typeof c.after)&&!(c.before&&typeof c.before==='object')&&!(c.after&&typeof c.after==='object')):[];}catch{return [];}};
function utcDay(raw:string|null,end=false){if(!raw)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))throw Error('Choose a valid UTC date.');const n=Date.parse(raw+'T00:00:00Z');if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==raw)throw Error('Choose a valid UTC date.');return n+(end?86400000:0);}
export async function changeHistory(db:D1Database,params:URLSearchParams,now=Date.now()) {
    const rawLimit=params.get('limit')||'50',limit=Number(rawLimit);if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Choose a page size from 1 to 100.');
    const source=params.get('source')||'',q=(params.get('q')||'').trim();if(q.length>120)throw Error('Search is limited to 120 characters.');if(source&&!['admin','system','github','cloudflare'].includes(source))throw Error('Choose a recorded source.');
    const from=utcDay(params.get('from')),to=utcDay(params.get('to'),true);if(from!=null&&to!=null&&from>=to)throw Error('The start date must be on or before the end date.');
    const clauses:string[]=[],values:(string|number)[]=[];
    if(source){clauses.push('source=?');values.push(source);}
    if(q){clauses.push("(actor LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR entity_id LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\')");const term='%'+q.replace(/[\\%_]/g,'\\$&')+'%';values.push(term,term,term,term);}
    if(from!=null){clauses.push('occurred_at>=?');values.push(from);}if(to!=null){clauses.push('occurred_at<?');values.push(to);}
    const before=params.get('before');if(before){const match=before.match(/^(\d{1,16}):([a-zA-Z0-9:_.-]{1,200})$/);if(!match||!Number.isSafeInteger(Number(match[1])))throw Error('Invalid history cursor.');clauses.push('(occurred_at<? OR (occurred_at=? AND id<?))');values.push(Number(match[1]),Number(match[1]),match[2]);}
    const rows=(await db.prepare('SELECT * FROM change_events'+(clauses.length?' WHERE '+clauses.join(' AND '):'')+' ORDER BY occurred_at DESC,id DESC LIMIT ?').bind(...values,limit+1).all<Row>()).results;
    const page=rows.slice(0,limit),last=page.at(-1);
    const sync=(await db.prepare('SELECT source,synced_at,state,description FROM change_history_sync').all<{source:string;synced_at:number;state:string;description:string}>()).results;
    const coverage=[['admin','Store administration','Database changes are recorded from activation onward. Earlier unlogged edits have no reliable actor or before value.'],['system','Automated store activity','Order/payment and inventory state, email job status and original-report registry changes are recorded. Routine visits and customer profile contents are excluded.'],['github','GitHub code and functions','Code history has not been imported yet.'],['cloudflare','Cloudflare deployments','Deployment history has not been imported yet.'],['cloudflare_versions','Cloudflare version uploads','Version history has not been imported yet.'],['cloudflare_audit','Cloudflare account settings','Account audit access has not been verified. Hosting configuration, secret rotations and DNS changes may be missing.'],['vercel','Vercel','TryBiomod is currently hosted on Cloudflare. No Vercel activity feed is connected.']].map(([key,label,fallback])=>{
        const row=sync.find(r=>r.source===key),stale=row&&['github','cloudflare','cloudflare_versions','cloudflare_audit'].includes(key)&&now-row.synced_at>7200000;
        const state=stale&&row.state==='active'?'partial':row?.state||(key==='system'?'partial':'unavailable');
        return {source:key,label,state,description:(row?.description||fallback)+(stale?' This source has not synced in over two hours.':''),...(row?{lastSyncedAt:row.synced_at}:{})};
    });
    return {events:page.map(r=>({id:r.id,occurredAt:r.occurred_at,recordedAt:r.recorded_at,source:r.source,actor:r.actor,actorType:r.actor_type,action:r.action,entityType:r.entity_type,entityId:r.entity_id,summary:r.summary,status:r.status,changes:parseChanges(r.changes),...(safeEvidence(r.evidence_url||'')?{evidenceUrl:safeEvidence(r.evidence_url||'')} : {}),...(r.evidence_ref?{evidenceRef:r.evidence_ref}:{})})),nextCursor:rows.length>limit&&last?last.occurred_at+':'+last.id:null,coverage,timeZone:'UTC'};
}
