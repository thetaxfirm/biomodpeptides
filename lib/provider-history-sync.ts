import { target, commitEvent, checkEvent, deploymentEvent, versionEvent, auditEvent } from './change-history-provider-events.mjs';
import { providerJson, ProviderHistoryError } from './provider-history-http';

export const PROVIDER_HISTORY_CRON = '7,22,37,52 * * * *';
const MINUTE = 60000, HOUR = 60 * MINUTE, PAGE = 100;
const shaPattern = /^[a-f0-9]{40}$/;
const cfBase = `https://api.cloudflare.com/client/v4/accounts/${target.account}`;
const workerBase = `${cfBase}/workers/scripts/${target.worker}`;
const ghBase = `https://api.github.com/repos/${target.repository}`;
type Environment = { DB: D1Database; HISTORY_GITHUB_READ_TOKEN?: string; HISTORY_CLOUDFLARE_READ_TOKEN?: string };
type Source = 'github_commits_scheduled' | 'github_checks_scheduled' | 'cloudflare_scheduled' | 'cloudflare_versions_scheduled' | 'cloudflare_audit_scheduled';
type Checkpoint = { page?: number; anchor?: string; since?: number; before?: number; cursor?: string; seen?: number; kept?: number; commits?: string[]; index?: number; checkSeen?: number; lastCompleteAt?: number; previousPage?: string };
type Lease = { source: Source; id: string; checkpoint: Checkpoint; invalidCheckpoint?: boolean };
type Event = { id: string; [key: string]: unknown };
class LostLease extends Error {}

function checkpoint(raw: string): Checkpoint {
  let value: any; try { value = JSON.parse(raw); } catch { throw new ProviderHistoryError('Saved pagination checkpoint is invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderHistoryError('Saved pagination checkpoint is invalid');
  const out: Checkpoint = {};
  for (const key of ['page','since','before','seen','kept','index','checkSeen','lastCompleteAt'] as const) if (value[key] !== undefined) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0 || (key === 'page' && (value[key] < 1 || value[key] > 1000000))) throw new ProviderHistoryError('Saved pagination checkpoint is invalid');
    out[key] = value[key];
  }
  for (const key of ['anchor','previousPage'] as const) if (value[key] !== undefined) { if (typeof value[key] !== 'string' || !/^[a-f0-9-]{32,40}$/.test(value[key])) throw new ProviderHistoryError('Saved pagination checkpoint is invalid'); out[key] = value[key]; }
  if (value.cursor !== undefined) { if (typeof value.cursor !== 'string' || value.cursor.length > 4096 || /[\u0000-\u001f]/.test(value.cursor)) throw new ProviderHistoryError('Saved pagination checkpoint is invalid'); out.cursor = value.cursor; }
  if (value.commits !== undefined) { if (!Array.isArray(value.commits) || value.commits.length > 20 || value.commits.some((sha: unknown) => typeof sha !== 'string' || !shaPattern.test(sha))) throw new ProviderHistoryError('Saved pagination checkpoint is invalid'); out.commits = value.commits; }
  return out;
}

async function claim(db: D1Database, source: Source, now: number): Promise<Lease | null> {
  const id = crypto.randomUUID();
  const result = await db.prepare(`INSERT INTO provider_history_poll(source,checkpoint,lease_id,lease_until,next_attempt_at,updated) VALUES(?,'{}',?,?,0,?)
    ON CONFLICT(source) DO UPDATE SET lease_id=excluded.lease_id,lease_until=excluded.lease_until,updated=excluded.updated
    WHERE provider_history_poll.lease_until<=? AND provider_history_poll.next_attempt_at<=?`).bind(source,id,now+4*MINUTE,now,now,now).run();
  if (!result.meta.changes) return null;
  const row = await db.prepare('SELECT checkpoint FROM provider_history_poll WHERE source=? AND lease_id=?').bind(source,id).first<{checkpoint:string}>();
  if (!row) return null;
  try { return { source, id, checkpoint: checkpoint(row.checkpoint) }; }
  catch { return { source, id, checkpoint: {}, invalidCheckpoint: true }; }
}

/** Event inserts, cursor movement and coverage commit together. A superseded lease writes nothing. */
async function save(db: D1Database, lease: Lease, events: Event[], next: Checkpoint, now: number, state: 'active' | 'partial' | 'unavailable', description: string, delay: number, keepCheckpoint = false) {
  const columns = ['id','occurred_at','recorded_at','source','actor','actor_type','action','entity_type','entity_id','summary','status','changes','evidence_url','evidence_ref'];
  const guard = 'EXISTS(SELECT 1 FROM provider_history_poll WHERE source=? AND lease_id=?)';
  const statements = [db.prepare(`INSERT OR IGNORE INTO change_events(${columns.join(',')}) SELECT ${columns.map(key=>`json_extract(e.value,'$.${key}')`).join(',')} FROM json_each(?) e
    WHERE NOT EXISTS(SELECT 1 FROM change_events WHERE id=json_extract(e.value,'$.id')) AND ${guard}`).bind(JSON.stringify(events),lease.source,lease.id),
    db.prepare(`INSERT INTO change_history_sync(source,synced_at,state,description) SELECT ?,?,?,? WHERE ${guard}
      ON CONFLICT(source) DO UPDATE SET synced_at=excluded.synced_at,state=excluded.state,description=excluded.description`).bind(lease.source,now,state,description,lease.source,lease.id),
    db.prepare('UPDATE provider_history_poll SET checkpoint=CASE WHEN ? THEN checkpoint ELSE ? END,lease_until=0,next_attempt_at=?,updated=? WHERE source=? AND lease_id=?').bind(keepCheckpoint?1:0,JSON.stringify(next),now+delay,now,lease.source,lease.id)];
  const result = await db.batch(statements);
  if (!result[2].meta.changes) throw new LostLease();
  lease.checkpoint = next;
}

function array(value: unknown, max = PAGE): any[] {
  if (!Array.isArray(value) || value.length > max || value.some(row=>!row || typeof row !== 'object' || Array.isArray(row))) throw new ProviderHistoryError('Provider page format invalid');
  return value;
}
const iso = (value: number) => new Date(value).toISOString();
const complete = (now: number): Checkpoint => ({lastCompleteAt:now});

async function commits(env: Environment, lease: Lease, now: number, request: typeof fetch) {
  const old = lease.checkpoint, page = old.page || 1;
  if (old.anchor && !shaPattern.test(old.anchor)) throw new ProviderHistoryError('Saved source anchor is invalid');
  const { data } = await providerJson(request, `${ghBase}/commits?${new URLSearchParams({sha:old.anchor || 'main',per_page:String(PAGE),page:String(page)})}`, env.HISTORY_GITHUB_READ_TOKEN);
  const rows = array(data), events = rows.map(row=>{
    const item = commitEvent(row, [], now); if (!item) throw new ProviderHistoryError('Source metadata validation failed');
    // The CLI can later add exact changed paths under its richer immutable identity.
    return {...item,id:'github:scheduled-commit:'+row.sha,action:'source_commit_scheduled'};
  });
  if (rows.length && old.previousPage === rows[0].sha) throw new ProviderHistoryError('Source pagination did not advance');
  const seen = (old.seen || 0) + rows.length, done = rows.length < PAGE;
  const next = done ? complete(now) : {...old,page:page+1,anchor:old.anchor || rows[0].sha,previousPage:rows[0].sha,seen};
  await save(env.DB,lease,events,next,now,done?'active':'partial',`${seen} main revisions scanned${done?'; anchored history pages exhausted':'; historical pagination continues next poll'}. Git names are self-reported; changed paths remain available through source links and richer CLI imports. A source revision does not prove deployment.`,done?HOUR:15*MINUTE);
}

async function checks(env: Environment, lease: Lease, now: number, request: typeof fetch) {
  let current = lease.checkpoint, hashes = current.commits;
  if (!hashes) {
    const { data } = await providerJson(request, `${ghBase}/commits?sha=main&per_page=20`, env.HISTORY_GITHUB_READ_TOKEN);
    hashes = array(data,20).map(row=>{if(typeof row.sha!=='string'||!shaPattern.test(row.sha))throw new ProviderHistoryError('Check source identity is invalid');return row.sha;});
    current = {...current,commits:hashes,index:0,page:1,seen:0,kept:0,checkSeen:0};
  }
  let index=current.index||0,page=current.page||1,seen=current.seen||0,kept=current.kept||0,checkSeen=current.checkSeen||0;
  if(index>hashes.length)throw new ProviderHistoryError('Saved check pagination is invalid');
  const events: Event[]=[];
  // Five check pages per invocation keeps public API use below its nominal unauthenticated
  // quota; the durable checkpoint resumes a large check list instead of silently truncating it.
  for(let read=0;read<5 && index<hashes.length;read++){
    const hash=hashes[index],{data}=await providerJson(request,`${ghBase}/commits/${hash}/check-runs?per_page=${PAGE}&page=${page}`,env.HISTORY_GITHUB_READ_TOKEN);
    const rows=array(data?.check_runs);
    if(!Number.isSafeInteger(data?.total_count)||data.total_count<rows.length)throw new ProviderHistoryError('Check page total is invalid');
    for(const row of rows){const item=checkEvent(row,hash,now);if(item){events.push(item);kept++;}}
    seen+=rows.length;checkSeen+=rows.length;
    if(!rows.length&&checkSeen<data.total_count)throw new ProviderHistoryError('Check pagination ended before the reported total');
    if(checkSeen>=data.total_count){index++;page=1;checkSeen=0;}else page++;
  }
  const done=index===hashes.length,next=done?complete(now):{...current,index,page,seen,kept,checkSeen};
  await save(env.DB,lease,events,next,now,done?'active':'partial',`Check pages read for ${index} of ${hashes.length} recent main revisions; ${seen} provider checks examined and ${kept} supported check observations retained${done?'.':'; pagination continues.'} Only GitHub Actions and this Worker’s Cloudflare build checks are included. Older check history is not fully covered; results are not proof of deployment or customer workflow success.`,15*MINUTE);
}

async function cloudflarePages(env: Environment, lease: Lease, now: number, request: typeof fetch, versions: boolean) {
  const old=lease.checkpoint,page=old.page||1,before=old.before||now;
  const query=new URLSearchParams({per_page:String(PAGE),page:String(page),...(!versions?{until:iso(before)}:{})});
  const {data}=await providerJson(request,`${workerBase}/${versions?'versions':'deployments'}?${query}`,env.HISTORY_CLOUDFLARE_READ_TOKEN);
  const rows=array(versions?data?.result?.items:data?.result?.deployments);
  if(rows.length && old.previousPage===rows[0].id)throw new ProviderHistoryError('Provider pagination did not advance');
  const events=rows.map(row=>{const item=versions?versionEvent(row,now):deploymentEvent(row,now);if(!item)throw new ProviderHistoryError('Worker metadata validation failed');return item;});
  const total=data?.result_info?.total_count;
  if(total!==undefined && (!Number.isSafeInteger(total)||total<0))throw new ProviderHistoryError('Provider page total is invalid');
  const seen=(old.seen||0)+rows.length,done=total!==undefined?seen>=total:rows.length<PAGE;
  if(!rows.length&&total!==undefined&&seen<total)throw new ProviderHistoryError('Worker pagination ended before the reported total');
  await save(env.DB,lease,events,done?complete(now):{...old,page:page+1,before,seen,previousPage:rows[0].id},now,done?'active':'partial',`${seen} retained Worker ${versions?'versions':'deployments'} scanned; ${done?'available provider pages traversed':'pagination continues next poll'}. ${versions?'Version lists may change during pagination; later scans revisit them. Upload does not establish deployment.':'Deployment records preserve the provider’s exact traffic allocation.'} Older events outside provider retention cannot be reconstructed; a provider account is not proof of the individual using it.`,done?HOUR:15*MINUTE);
}

async function audit(env: Environment, lease: Lease, now: number, request: typeof fetch) {
  const old=lease.checkpoint,before=old.before||now,since=old.since??Math.max(now-30*86400000,(old.lastCompleteAt||0)-HOUR);
  const query=new URLSearchParams({since:iso(since),before:iso(before),limit:String(PAGE),direction:'asc',...(old.cursor?{cursor:old.cursor}:{})});
  const {data}=await providerJson(request,`${cfBase}/logs/audit?${query}`,env.HISTORY_CLOUDFLARE_READ_TOKEN);
  const rows=array(data?.result),events=rows.map(row=>auditEvent(row,now)).filter((item):item is Event=>Boolean(item));
  const cursor=data?.result_info?.cursor;
  if(cursor!==undefined && cursor!==null && (typeof cursor!=='string'||cursor.length>4096||/[\u0000-\u001f]/.test(cursor)))throw new ProviderHistoryError('Audit cursor is invalid');
  if(cursor && cursor===old.cursor)throw new ProviderHistoryError('Audit pagination did not advance');
  const done=!cursor,seen=(old.seen||0)+rows.length,kept=(old.kept||0)+events.length;
  await save(env.DB,lease,events,done?complete(before):{...old,since,before,cursor,seen,kept},now,done?'active':'partial',`${kept} TryBiomod-scoped platform events retained from ${seen} audit entries between ${iso(since)} and ${iso(before)}; ${done?'available pages exhausted':'pagination continues'}. Only exact Worker/database resources or trybiomod.com zone mutations are recorded. Raw bodies, SQL, configuration values and IP addresses are excluded. Provider retention and earlier unrecorded periods remain limits.`,done?HOUR:15*MINUTE);
}

/** A separate read-only cron keeps provider pagination out of shipping and correspondence runs. */
export async function syncProviderHistory(env: Environment, now=Date.now(), request:typeof fetch=fetch) {
  const feeds: [Source,(lease:Lease)=>Promise<void>][]=[
    ['github_commits_scheduled',lease=>commits(env,lease,now,request)],['github_checks_scheduled',lease=>checks(env,lease,now,request)],
    ['cloudflare_scheduled',lease=>cloudflarePages(env,lease,now,request,false)],['cloudflare_versions_scheduled',lease=>cloudflarePages(env,lease,now,request,true)],['cloudflare_audit_scheduled',lease=>audit(env,lease,now,request)],
  ];
  const results=await Promise.allSettled(feeds.map(async([source,read])=>{
    const lease=await claim(env.DB,source,now);if(!lease)return;
    try{
      if(lease.invalidCheckpoint)throw new ProviderHistoryError('Saved pagination checkpoint is invalid');
      if(source.startsWith('cloudflare')&&!env.HISTORY_CLOUDFLARE_READ_TOKEN){await save(env.DB,lease,[],lease.checkpoint,now,'unavailable','Scheduled provider reader is not configured. Add the dedicated HISTORY_CLOUDFLARE_READ_TOKEN with read-only access to the verified account. Existing imported history remains available; no access or credentials were changed.',HOUR);return;}
      await read(lease);
    }catch(error){
      if(error instanceof LostLease)return;
      const detail=error instanceof ProviderHistoryError?error.message:'Provider history persistence failed';
      await save(env.DB,lease,[],lease.checkpoint,now,'unavailable',`${detail}. Existing evidence and pagination checkpoint remain intact; a later scheduled poll retries.`,error instanceof ProviderHistoryError?error.retryAfterMs:15*MINUTE,true);
    }
  }));
  if(results.some(result=>result.status==='rejected'))throw new Error('Provider history health could not be recorded.');
}
