// Desk-side tool for website update requests (owner request, Nov 24 2026).
// Reads requests staff sent from Admin > Website updates and writes the outcome back.
// Uses the existing authorized Cloudflare login; prints no credentials and no customer data
// (these tables hold none). Rules for working a request: docs/site-updates-lane-v1.md.
//
//   node scripts/site-updates.mjs list                 requests waiting to be worked
//   node scripts/site-updates.mjs show <number>        one request with its messages and file list
//   node scripts/site-updates.mjs fetch <number> <dir> download its files into <dir> (hash-checked)
//   node scripts/site-updates.mjs claim <number>       Received -> In progress (refuses if not waiting)
//   node scripts/site-updates.mjs release <number>     In progress -> Received (work was not started)
//   node scripts/site-updates.mjs finish <number> <done|question|needs_owner> <note-file> [result-json]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { target } from './change-history-import-v1.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const endpoint = `/accounts/${target.account}/d1/database/${target.database}/query`;
function headers() {
  let credentials;
  try { credentials = JSON.parse(execFileSync(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 })); }
  catch { throw new Error('Cloudflare login unavailable; output withheld to protect credentials.'); }
  if (credentials.token) return { Authorization: `Bearer ${credentials.token}` };
  if (credentials.type === 'api_key' && credentials.key && credentials.email) return { 'X-Auth-Key': credentials.key, 'X-Auth-Email': credentials.email };
  throw new Error('Cloudflare login unavailable.');
}
let cached;
export async function query(sql, params = [], send = fetch) {
  cached ||= headers();
  const response = await send('https://api.cloudflare.com/client/v4' + endpoint, { method: 'POST', headers: { ...cached, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(60_000), redirect: 'error' });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success !== true || data.result?.some(r => r?.success === false)) throw new Error(`Cloudflare returned HTTP ${response.status}; provider details withheld.`);
  return { rows: data.result[0]?.results || [], changes: data.result[0]?.meta?.changes || 0 };
}
const safeName = name => String(name).replace(/[^A-Za-z0-9 ._()\-]/g, '_').replace(/^\.+/, '').slice(-180) || 'file';
/** Pure: the statements a finish writes. A note and a status move, guarded by the status it expects. */
export function finishStatements({ id, status, note, result = '', now = Date.now(), noteId }) {
  if (!['done', 'question', 'needs_owner'].includes(status)) throw new Error('Finish as done, question or needs_owner.');
  const body = String(note || '').trim();
  if (!body) throw new Error('A finish needs a note saying what was done, asked or held.');
  if (body.length > 4000) throw new Error('Keep the note under 4,000 characters.');
  if (String(result).length > 4000) throw new Error('Keep the result under 4,000 characters.');
  return [
    { sql: "UPDATE site_updates SET status=?,result=?,updated=? WHERE id=? AND status IN ('working','new')", params: [status, String(result), now, id] },
    { sql: "INSERT INTO site_update_notes(id,update_id,author,author_type,body,created) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM site_updates WHERE id=? AND status=? AND updated=?)", params: [noteId, id, 'website-desk', 'claude', body, now, id, status, now] },
  ];
}
async function byNumber(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Give the request number, for example 12.');
  const { rows } = await query('SELECT seq,id,requester,kind,product_id,product_name,lot,message,status,owner_ok,owner_ok_by,result,created,updated FROM site_updates WHERE seq=?', [number]);
  if (!rows[0]) throw new Error('Request #' + number + ' not found.');
  return rows[0];
}
async function details(update) {
  const notes = (await query('SELECT author,author_type,body,created FROM site_update_notes WHERE update_id=? ORDER BY created', [update.id])).rows;
  const files = (await query('SELECT id,filename,content_type,size,sha256,chunks FROM site_update_files WHERE update_id=? ORDER BY created', [update.id])).rows;
  // Still active staff with the grant? A removed person's waiting requests are not worked.
  const access = (await query("SELECT (SELECT COUNT(*) FROM site_update_access a JOIN staff s ON s.email=a.email AND s.active=1 WHERE a.email=? AND a.active=1) AS granted", [update.requester])).rows[0];
  return { number: update.seq, id: update.id, requester: update.requester, requesterHasGrant: Boolean(access?.granted), kind: update.kind, productId: update.product_id, productName: update.product_name, lot: update.lot, status: update.status,
    ownerApproved: Boolean(update.owner_ok), ownerApprovedBy: update.owner_ok_by, message: update.message, created: new Date(update.created).toISOString(), updated: new Date(update.updated).toISOString(), notes: notes.map(n => ({ from: n.author_type, author: n.author, at: new Date(n.created).toISOString(), body: n.body })), files: files.map(f => ({ id: f.id, filename: f.filename, type: f.content_type, size: f.size, sha256: f.sha256, chunks: f.chunks })) };
}
async function main([command, ...args]) {
  if (command === 'list') {
    const { rows } = await query("SELECT seq,kind,product_name,lot,requester,status,owner_ok,updated FROM site_updates WHERE status IN ('new','working') ORDER BY seq");
    console.log(JSON.stringify({ waiting: rows.filter(r => r.status === 'new').map(r => ({ number: r.seq, kind: r.kind, product: r.product_name, lot: r.lot, requester: r.requester, ownerApproved: Boolean(r.owner_ok), updated: new Date(r.updated).toISOString() })), inProgress: rows.filter(r => r.status === 'working').map(r => ({ number: r.seq, since: new Date(r.updated).toISOString() })) }, null, 1));
    return;
  }
  const update = await byNumber(args[0]);
  if (command === 'show') { console.log(JSON.stringify(await details(update), null, 1)); return; }
  if (command === 'fetch') {
    const out = path.resolve(args[1] || '');
    if (!args[1]) throw new Error('Give a folder to download into.');
    mkdirSync(out, { recursive: true });
    const info = await details(update), saved = [];
    for (const file of info.files) {
      const parts = [];
      for (let seq = 0; seq < file.chunks; seq++) {
        const { rows } = await query('SELECT hex(data) AS h FROM site_update_file_chunks WHERE file_id=? AND seq=?', [file.id, seq]);
        if (!rows[0]?.h) throw new Error('A stored piece of ' + file.filename + ' is missing.');
        parts.push(Buffer.from(rows[0].h, 'hex'));
      }
      const bytes = Buffer.concat(parts);
      if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(file.filename + ' did not match its recorded size and hash.');
      let name = safeName(file.filename);
      if (existsSync(path.join(out, name))) name = file.id.slice(0, 8) + '-' + name;
      writeFileSync(path.join(out, name), bytes, { flag: 'wx' });
      saved.push({ file: path.join(out, name), size: bytes.length, sha256: file.sha256 });
    }
    writeFileSync(path.join(out, 'request.json'), JSON.stringify(info, null, 1));
    console.log(JSON.stringify({ number: info.number, folder: out, saved }, null, 1));
    return;
  }
  if (command === 'claim' || command === 'release') {
    const [from, to] = command === 'claim' ? ['new', 'working'] : ['working', 'new'];
    const { changes } = await query('UPDATE site_updates SET status=?,updated=? WHERE id=? AND status=?', [to, Date.now(), update.id, from]);
    if (!changes) throw new Error('Request #' + update.seq + ' is ' + update.status + ', not ' + from + '. Nothing changed.');
    console.log('Request #' + update.seq + ' is now ' + to + '.');
    return;
  }
  if (command === 'finish') {
    const [, status, noteFile, result = ''] = args;
    if (!noteFile) throw new Error('Give the file holding the note for the requester.');
    if (result) JSON.parse(result);
    const [move, note] = finishStatements({ id: update.id, status, note: readFileSync(noteFile, 'utf8'), result, noteId: crypto.randomUUID() });
    const moved = await query(move.sql, move.params);
    if (!moved.changes) throw new Error('Request #' + update.seq + ' is ' + update.status + '; it must be waiting or in progress. Nothing changed.');
    const noted = await query(note.sql, note.params);
    if (!noted.changes) throw new Error('The status moved but the note did not save. Check request #' + update.seq + ' before doing anything else.');
    console.log('Request #' + update.seq + ' finished as ' + status + '. The requester sees the note in Admin > Website updates.');
    return;
  }
  throw new Error('Commands: list, show, fetch, claim, release, finish.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
