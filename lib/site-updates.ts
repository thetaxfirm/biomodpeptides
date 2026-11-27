// Website update requests (owner request, Nov 24 2026). Dependency-free so the same rules run in
// the routes and in isolated tests. The server is the authority: the admin screen only mirrors it.
//
// A requester describes a change to pictures, lab reports or wording and attaches files. The work
// itself is done from the owner's desk under docs/site-updates-lane-v1.md and the outcome is
// written back as a note. Nothing in this module changes the storefront.
export const updateKinds = ['picture', 'coa', 'wording', 'other'] as const;
export type UpdateKind = typeof updateKinds[number];
export const updateStatuses = ['draft', 'new', 'working', 'question', 'needs_owner', 'done', 'cancelled'] as const;
export type UpdateStatus = typeof updateStatuses[number];
export const kindLabels: Record<UpdateKind, string> = { picture: 'Product picture', coa: 'Lab report (COA)', wording: 'Wording or small visual fix', other: 'Something else' };
export const statusLabels: Record<UpdateStatus, string> = { draft: 'Uploading', new: 'Received', working: 'In progress', question: 'Question for you', needs_owner: 'Waiting for the owner', done: 'Live', cancelled: 'Cancelled' };

export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const CHUNK_BYTES = 700 * 1024;
export const MAX_FILES = 6;
export const MAX_OPEN = 20;
export const MAX_MESSAGE = 4000;

export type Actor = { email: string; role: string };
export type UpdateFile = { id: string; filename: string; contentType: string; size: number; created: number };
export type UpdateNote = { author: string; authorType: 'staff' | 'owner' | 'claude'; body: string; created: number };
export type SiteUpdate = {
  id: string; number: number; requester: string; kind: UpdateKind; productId: number | null; productName: string; lot: string;
  message: string; status: UpdateStatus; ownerOk: boolean; created: number; updated: number; files: UpdateFile[]; notes: UpdateNote[];
  delivery?: ReturnType<typeof websiteProgress>;
};
/** Legacy completion notes are retained, but do not manufacture publication or verification evidence. */
export function websiteProgress(status: UpdateStatus, result: unknown) {
  let value: Record<string, unknown> = {};
  try { const parsed=typeof result==='string'?JSON.parse(result):result; if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)) value=parsed; } catch { /* legacy plain text */ }
  const timestamp=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?v:typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
  let url:string|null=null;
  try { const u=new URL(String(value.url||'')); if(u.protocol==='https:'&&u.hostname==='trybiomod.com'&&!u.username&&!u.password&&!u.search&&!u.hash) url=u.href; } catch { /* no trusted published URL */ }
  const commit=typeof value.commit==='string'&&/^[a-f0-9]{40}$/i.test(value.commit)?value.commit:null;
  const publishedAt=timestamp(value.publishedAt),verifiedAt=timestamp(value.verifiedAt);
  const published=Boolean(url&&commit&&publishedAt),verified=published&&verifiedAt!==null&&verifiedAt>=publishedAt!;
  const stage=status==='done'?(verified?'Verified live':published?'Published · verification pending':'Completed · verification not recorded'):status==='new'?'Queued':statusLabels[status];
  return {stage,owner:status==='needs_owner'?'Website owner':'Website desk',url,commit,publishedAt:published?publishedAt:null,verifiedAt:verified?verifiedAt:null};
}
export class SiteUpdateError extends Error { constructor(message: string, readonly status = 400) { super(message); this.name = 'SiteUpdateError'; } }
const fail = (message: string, status = 400): never => { throw new SiteUpdateError(message, status); };

const email = (value: string) => value.trim().toLowerCase();
const isOwner = (actor: Actor) => actor.role === 'owner';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const validId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '';

// Accepted uploads. The first bytes must agree with the claimed type, so a renamed file is refused.
const fileTypes: { extensions: string[]; type: string; magic: (b: Uint8Array) => boolean }[] = [
  { extensions: ['pdf'], type: 'application/pdf', magic: b => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  { extensions: ['png'], type: 'image/png', magic: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { extensions: ['jpg', 'jpeg'], type: 'image/jpeg', magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { extensions: ['webp'], type: 'image/webp', magic: b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  { extensions: ['gif'], type: 'image/gif', magic: b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  // iPhone photos. ISO media files carry "ftyp" at byte 4.
  { extensions: ['heic', 'heif'], type: 'image/heic', magic: b => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
];
export const acceptedExtensions = fileTypes.flatMap(t => t.extensions);
export const acceptAttribute = acceptedExtensions.map(e => '.' + e).join(',');
/** A safe display name and the checked type, or a refusal. The stored name never carries a path. */
export function checkFile(name: unknown, bytes: Uint8Array): { filename: string; contentType: string } {
  if (bytes.byteLength < 1) fail('That file is empty.');
  if (bytes.byteLength > MAX_FILE_BYTES) fail('That file is larger than 16 MB. Send a smaller copy.');
  const base = text(name, 400).split(/[\\/]/).pop() || '';
  const filename = base.replace(/[^A-Za-z0-9 ._()\-]/g, '_').replace(/\s+/g, ' ').replace(/^\.+/, '').slice(-180);
  const extension = /\.([A-Za-z0-9]{2,5})$/.exec(filename)?.[1].toLowerCase() || '';
  const type = fileTypes.find(t => t.extensions.includes(extension));
  if (!filename || !type) fail('Attach a PDF or a picture (PNG, JPG, WEBP, GIF or HEIC).');
  if (!type!.magic(bytes)) fail('That file does not open as a ' + extension.toUpperCase() + '. Export it again and re-attach.');
  return { filename, contentType: type!.type };
}

/** Owners always may. Anyone else needs an active grant and an active staff row. Failures deny. */
export async function hasSiteUpdateAccess(db: D1Database, actor: Actor): Promise<boolean> {
  if (isOwner(actor)) return true;
  try {
    const row = await db.prepare('SELECT 1 AS ok FROM site_update_access a JOIN staff s ON s.email=a.email AND s.active=1 WHERE a.email=? AND a.active=1').bind(email(actor.email)).first<{ ok: number }>();
    return Boolean(row?.ok);
  } catch { return false; }
}
/** Owner-only (the route requires team:manage). The person must already be active staff. */
export async function setSiteUpdateAccess(db: D1Database, actorEmail: string, target: string, active: boolean, now = Date.now()) {
  const address = email(target), actor = email(actorEmail);
  const member = await db.prepare('SELECT role FROM staff WHERE email=? AND active=1').bind(address).first<{ role: string }>();
  if (!member) fail('Add this person in People with access first. Owners can always send website updates.');
  await db.batch([
    db.prepare('INSERT INTO site_update_access(email,active,updated,updated_by) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET active=excluded.active,updated=excluded.updated,updated_by=excluded.updated_by').bind(address, active ? 1 : 0, now, actor),
    db.prepare('INSERT INTO staff_audit(id,actor,email,role,active,created) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), actor, address, active ? 'website updates: on' : 'website updates: off', 1, now),
  ]);
  return { message: active ? address + ' can now send website updates.' : address + ' can no longer send website updates.' };
}
export async function siteUpdateAccessList(db: D1Database): Promise<string[]> {
  try { return (await db.prepare('SELECT email FROM site_update_access WHERE active=1 ORDER BY email').all<{ email: string }>()).results.map(r => r.email); }
  catch { return []; }
}

type Row = { seq: number; id: string; requester: string; kind: UpdateKind; product_id: number | null; product_name: string; lot: string; message: string; status: UpdateStatus; owner_ok: number; created: number; updated: number; result?: string };
async function row(db: D1Database, id: unknown): Promise<Row> {
  if (!validId(id)) fail('Request not found.', 404);
  const found = await db.prepare('SELECT seq,id,requester,kind,product_id,product_name,lot,message,status,owner_ok,created,updated FROM site_updates WHERE id=?').bind(id as string).first<Row>();
  return found || fail('Request not found.', 404);
}
/** A requester reaches only their own requests; an owner reaches all. Others get "not found". */
async function reachable(db: D1Database, actor: Actor, id: unknown): Promise<Row> {
  const found = await row(db, id);
  if (!isOwner(actor) && found.requester !== email(actor.email)) fail('Request not found.', 404);
  return found;
}

export type NewUpdate = { kind: unknown; product?: { id: number; name: string } | null; lot?: unknown; message: unknown };
/** Step 1 of 3. The request stays a draft, invisible to the desk, until its files are in and it is sent. */
export async function createDraft(db: D1Database, actor: Actor, input: NewUpdate, now = Date.now(), id = crypto.randomUUID()) {
  const kind = updateKinds.find(k => k === input.kind) || fail('Choose what you want changed.');
  const message = text(input.message, MAX_MESSAGE + 1);
  if (message.length < 5) fail('Describe the change in a sentence or two.');
  if (message.length > MAX_MESSAGE) fail('Keep the description under 4,000 characters.');
  const lot = text(input.lot, 41);
  if (lot.length > 40) fail('That lot number is too long.');
  if (kind === 'coa' && !lot) fail('Enter the lot number printed on the vial label for this report.');
  if ((kind === 'coa' || kind === 'picture') && !input.product) fail('Choose the product this is for.');
  const requester = email(actor.email);
  const open = await db.prepare("SELECT COUNT(*) AS n FROM site_updates WHERE requester=? AND status IN ('draft','new','working','question','needs_owner')").bind(requester).first<{ n: number }>();
  if ((open?.n || 0) >= MAX_OPEN) fail('You have ' + MAX_OPEN + ' requests open. Wait for some to finish, or cancel ones you no longer need.', 429);
  await db.prepare("INSERT INTO site_updates(id,requester,kind,product_id,product_name,lot,message,status,created,updated) VALUES(?,?,?,?,?,?,?,'draft',?,?)")
    .bind(id, requester, kind, input.product?.id ?? null, text(input.product?.name, 200), lot, message, now, now).run();
  return { id };
}
/** Step 2 of 3, once per file. Allowed while a draft, and while answering a question. */
export async function attachFile(db: D1Database, actor: Actor, updateId: unknown, name: unknown, bytes: Uint8Array, now = Date.now(), id = crypto.randomUUID()) {
  const update = await reachable(db, actor, updateId);
  if (!['draft', 'question'].includes(update.status)) fail('Files can be added while you are writing a request or answering a question. Send a new request for anything else.', 409);
  const checked = checkFile(name, bytes);
  const count = await db.prepare('SELECT COUNT(*) AS n FROM site_update_files WHERE update_id=?').bind(update.id).first<{ n: number }>();
  if ((count?.n || 0) >= MAX_FILES) fail('A request holds up to ' + MAX_FILES + ' files. Send the rest in a second request.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource));
  const sha256 = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  const chunks = Math.ceil(bytes.byteLength / CHUNK_BYTES);
  // Pieces first, the file record last: a record exists only for a completely stored file.
  for (let seq = 0; seq < chunks; seq++) {
    const piece = bytes.slice(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES);
    await db.prepare('INSERT INTO site_update_file_chunks(file_id,seq,data) VALUES(?,?,?)').bind(id, seq, piece).run();
  }
  await db.prepare('INSERT INTO site_update_files(id,update_id,filename,content_type,size,sha256,chunks,uploaded_by,created) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(id, update.id, checked.filename, checked.contentType, bytes.byteLength, sha256, chunks, email(actor.email), now).run();
  return { file: { id, filename: checked.filename, contentType: checked.contentType, size: bytes.byteLength, created: now } satisfies UpdateFile };
}
/** Step 3 of 3. A lab report or picture request with no file would only come back as a question. */
export async function submitDraft(db: D1Database, actor: Actor, updateId: unknown, now = Date.now()) {
  const update = await reachable(db, actor, updateId);
  if (update.status !== 'draft') return { message: 'Request #' + update.seq + ' was already sent.' };
  const count = await db.prepare('SELECT COUNT(*) AS n FROM site_update_files WHERE update_id=?').bind(update.id).first<{ n: number }>();
  if ((update.kind === 'coa' || update.kind === 'picture') && !(count?.n)) fail(update.kind === 'coa' ? 'Attach the lab report PDF.' : 'Attach the picture.');
  await db.prepare("UPDATE site_updates SET status='new',updated=? WHERE id=? AND status='draft'").bind(now, update.id).run();
  return { message: 'Request #' + update.seq + ' sent. You will see it move to In progress, then Live.' };
}
/** A follow-up from the requester or an owner. Answering a question puts the request back in line. */
export async function addNote(db: D1Database, actor: Actor, updateId: unknown, body: unknown, now = Date.now()) {
  const update = await reachable(db, actor, updateId);
  if (['draft', 'cancelled'].includes(update.status)) fail('This request is closed. Send a new one.', 409);
  const note = text(body, MAX_MESSAGE + 1);
  if (!note) fail('Write your message first.');
  if (note.length > MAX_MESSAGE) fail('Keep the message under 4,000 characters.');
  // A finished request reopens: "that picture is the wrong one" is a new instruction on the same thread.
  const reopen = update.status === 'question' || update.status === 'done';
  await db.batch([
    db.prepare('INSERT INTO site_update_notes(id,update_id,author,author_type,body,created) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), update.id, email(actor.email), isOwner(actor) ? 'owner' : 'staff', note, now),
    db.prepare("UPDATE site_updates SET status=CASE WHEN ?=1 THEN 'new' ELSE status END,updated=? WHERE id=?").bind(reopen ? 1 : 0, now, update.id),
  ]);
  return { message: reopen ? 'Sent. Request #' + update.seq + ' is back in line.' : 'Added to request #' + update.seq + '.' };
}
/** The requester or an owner can cancel anything that is not finished or already being worked. */
export async function cancelUpdate(db: D1Database, actor: Actor, updateId: unknown, now = Date.now()) {
  const update = await reachable(db, actor, updateId);
  if (!['draft', 'new', 'question', 'needs_owner'].includes(update.status)) fail(update.status === 'working' ? 'This one is being worked on right now. Add a message instead and it will be read.' : 'This request is already closed.', 409);
  const saved = await db.prepare("UPDATE site_updates SET status='cancelled',updated=? WHERE id=? AND status IN ('draft','new','question','needs_owner')").bind(now, update.id).run();
  if (!saved.meta.changes) fail('This request just changed. Refresh and look again.', 409);
  return { message: 'Request #' + update.seq + ' cancelled. Nothing was changed on the site.' };
}
/**
 * Owner decision on a request that reached past the requester's lane (prices, stock, claims,
 * policies). Approving sends it back to be done with the owner's say-so recorded; declining closes it.
 */
export async function decideUpdate(db: D1Database, actor: Actor, updateId: unknown, approve: boolean, body: unknown, now = Date.now()) {
  if (!isOwner(actor)) fail('Only an owner can decide this.', 403);
  const update = await row(db, updateId);
  if (update.status !== 'needs_owner') fail('This request is not waiting for an owner.', 409);
  const note = text(body, MAX_MESSAGE) || (approve ? 'Approved by the owner.' : 'Declined by the owner.');
  const saved = await db.prepare("UPDATE site_updates SET status=?,owner_ok=?,owner_ok_by=?,updated=? WHERE id=? AND status='needs_owner'").bind(approve ? 'new' : 'cancelled', approve ? 1 : 0, approve ? email(actor.email) : '', now, update.id).run();
  if (!saved.meta.changes) fail('This request just changed. Refresh and look again.', 409);
  await db.prepare('INSERT INTO site_update_notes(id,update_id,author,author_type,body,created) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), update.id, email(actor.email), 'owner', note, now).run();
  return { message: approve ? 'Approved. Request #' + update.seq + ' is back in line.' : 'Declined. Request #' + update.seq + ' is closed and nothing was changed.' };
}

/** Owners see every request; a requester sees their own. Drafts abandoned mid-upload stay hidden. */
export async function listUpdates(db: D1Database, actor: Actor, limit = 100): Promise<SiteUpdate[]> {
  const mine = !isOwner(actor);
  const rows = (await db.prepare('SELECT seq,id,requester,kind,product_id,product_name,lot,message,status,owner_ok,created,updated,result FROM site_updates WHERE status<>\'draft\'' + (mine ? ' AND requester=?' : '') + ' ORDER BY seq DESC LIMIT ?')
    .bind(...(mine ? [email(actor.email), limit] : [limit])).all<Row>()).results;
  if (!rows.length) return [];
  const marks = rows.map(() => '?').join(','), ids = rows.map(r => r.id);
  const files = (await db.prepare('SELECT id,update_id,filename,content_type,size,created FROM site_update_files WHERE update_id IN (' + marks + ') ORDER BY created').bind(...ids).all<{ id: string; update_id: string; filename: string; content_type: string; size: number; created: number }>()).results;
  const notes = (await db.prepare('SELECT update_id,author,author_type,body,created FROM site_update_notes WHERE update_id IN (' + marks + ') ORDER BY created').bind(...ids).all<{ update_id: string; author: string; author_type: UpdateNote['authorType']; body: string; created: number }>()).results;
  return rows.map(r => ({
    id: r.id, number: r.seq, requester: r.requester, kind: r.kind, productId: r.product_id, productName: r.product_name, lot: r.lot, message: r.message, status: r.status, ownerOk: Boolean(r.owner_ok), created: r.created, updated: r.updated, delivery: websiteProgress(r.status,r.result),
    files: files.filter(f => f.update_id === r.id).map(f => ({ id: f.id, filename: f.filename, contentType: f.content_type, size: f.size, created: f.created })),
    notes: notes.filter(n => n.update_id === r.id).map(n => ({ author: n.author_type === 'claude' ? 'Website desk' : n.author, authorType: n.author_type, body: n.body, created: n.created })),
  }));
}
const bytesOf = (value: unknown): Uint8Array => value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : Array.isArray(value) ? Uint8Array.from(value as number[]) : new Uint8Array(0);
/** The stored file, re-checked against its recorded size and hash before it is handed back. */
export async function readFile(db: D1Database, actor: Actor, fileId: unknown) {
  if (!validId(fileId)) fail('File not found.', 404);
  const file = await db.prepare('SELECT id,update_id,filename,content_type,size,sha256,chunks FROM site_update_files WHERE id=?').bind(fileId as string).first<{ id: string; update_id: string; filename: string; content_type: string; size: number; sha256: string; chunks: number }>();
  if (!file) fail('File not found.', 404);
  await reachable(db, actor, file!.update_id).catch(() => fail('File not found.', 404));
  const bytes = new Uint8Array(file!.size);
  let offset = 0;
  for (let seq = 0; seq < file!.chunks; seq++) {
    const piece = await db.prepare('SELECT data FROM site_update_file_chunks WHERE file_id=? AND seq=?').bind(file!.id, seq).first<{ data: unknown }>();
    const data = bytesOf(piece?.data);
    if (!data.byteLength || offset + data.byteLength > bytes.byteLength) fail('This file could not be read. Attach it again.', 500);
    bytes.set(data, offset); offset += data.byteLength;
  }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (offset !== file!.size || digest !== file!.sha256) fail('This file could not be read. Attach it again.', 500);
  return { filename: file!.filename, contentType: file!.content_type, bytes };
}
