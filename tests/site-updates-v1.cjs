// Website update requests (owner request, Nov 24 2026). Real lib/site-updates.ts and lib/staff.ts,
// every migration applied to an in-memory SQLite database, and the route, UI and desk-tool sources.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, f);
const lib = require('../lib/site-updates.ts'), staff = require('../lib/staff.ts');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const sqlite = new DatabaseSync(':memory:');
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(n => n.endsWith('.sql')).sort()) sqlite.exec(read('drizzle/' + name));
const statement = (sql, args = []) => ({ bind: (...a) => statement(sql, a), first: async () => sqlite.prepare(sql).get(...args) || null, all: async () => ({ results: sqlite.prepare(sql).all(...args) }), run: async () => ({ meta: sqlite.prepare(sql).run(...args) }) });
const db = { prepare: sql => statement(sql), batch: async list => { sqlite.exec('BEGIN'); try { const r = []; for (const s of list) r.push(await s.run()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
const rejects = (promise, pattern, status) => assert.rejects(promise, e => { assert(e instanceof lib.SiteUpdateError, 'typed refusal: ' + e.message); assert.match(e.message, pattern); if (status) assert.equal(e.status, status); return true; });

const owner = { email: 'Owner@Example.invalid', role: 'owner' }, editor = { email: 'editor@example.invalid', role: 'support' }, other = { email: 'other@example.invalid', role: 'support' };
const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 10, 1, 2, 3]);
const png = new Uint8Array(lib.CHUNK_BYTES * 2 + 5000); png.set([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]); for (let i = 8; i < png.length; i++) png[i] = (i * 31) % 251;
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

(async () => {
  // The permission belongs to no role; it is granted per person.
  for (const role of staff.staffRoles) assert(!staff.can(role, 'site:request'), role + ' does not carry it by role');
  assert.equal(staff.tabPermission.updates, 'site:request');
  assert(!staff.staffRoles.some(role => staff.canSeeTab(role, 'updates')), 'the tab shows only from the server-issued permission');

  // Access: owners always; staff only with an active grant and an active staff row.
  sqlite.prepare("INSERT INTO staff VALUES('editor@example.invalid','','support',1,1,1,'owner@example.invalid')").run();
  sqlite.prepare("INSERT INTO staff VALUES('other@example.invalid','','support',1,1,1,'owner@example.invalid')").run();
  assert.equal(await lib.hasSiteUpdateAccess(db, owner), true);
  assert.equal(await lib.hasSiteUpdateAccess(db, editor), false);
  await rejects(lib.setSiteUpdateAccess(db, owner.email, 'stranger@example.invalid', true), /Add this person/);
  assert.match((await lib.setSiteUpdateAccess(db, owner.email, ' Editor@Example.invalid ', true, 50)).message, /can now send website updates/);
  assert.equal(await lib.hasSiteUpdateAccess(db, editor), true);
  assert.equal(await lib.hasSiteUpdateAccess(db, other), false);
  assert.deepEqual(await lib.siteUpdateAccessList(db), ['editor@example.invalid']);
  assert.deepEqual({ ...sqlite.prepare("SELECT actor,email,role,active FROM staff_audit WHERE email='editor@example.invalid'").get() }, { actor: 'owner@example.invalid', email: 'editor@example.invalid', role: 'website updates: on', active: 1 });
  sqlite.prepare("UPDATE staff SET active=0 WHERE email='editor@example.invalid'").run();
  assert.equal(await lib.hasSiteUpdateAccess(db, editor), false, 'removing staff access ends it even while the grant row stays');
  sqlite.prepare("UPDATE staff SET active=1 WHERE email='editor@example.invalid'").run();
  await lib.setSiteUpdateAccess(db, owner.email, editor.email, false, 60);
  assert.equal(await lib.hasSiteUpdateAccess(db, editor), false);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM site_update_access').get().n, 1, 'switched off, not deleted');
  await lib.setSiteUpdateAccess(db, owner.email, editor.email, true, 70);
  assert.equal(await lib.hasSiteUpdateAccess({ prepare() { throw new Error('down'); } }, editor), false, 'a lookup failure denies');

  // File checks: type by extension AND first bytes, size, safe stored name.
  assert.deepEqual(lib.checkFile('../../etc/Report (final).PDF', pdf), { filename: 'Report (final).PDF', contentType: 'application/pdf' });
  assert.equal(lib.checkFile('C:\\photos\\vial<1>.png', png).filename, 'vial_1_.png');
  assert.throws(() => lib.checkFile('page.html', pdf), /Attach a PDF or a picture/);
  assert.throws(() => lib.checkFile('art.svg', pdf), /Attach a PDF or a picture/, 'scriptable formats are refused');
  assert.throws(() => lib.checkFile('report.pdf', png), /does not open as a PDF/);
  assert.throws(() => lib.checkFile('empty.pdf', new Uint8Array(0)), /empty/);
  assert.throws(() => lib.checkFile('big.pdf', new Uint8Array(lib.MAX_FILE_BYTES + 1)), /larger than 16 MB/);

  // Creating: validation, then a draft the desk cannot see.
  await rejects(lib.createDraft(db, editor, { kind: 'price', message: 'Change the price' }), /Choose what you want changed/);
  await rejects(lib.createDraft(db, editor, { kind: 'wording', message: 'hi' }), /Describe the change/);
  await rejects(lib.createDraft(db, editor, { kind: 'coa', product: { id: 1, name: 'A 10mg' }, lot: '', message: 'New report attached' }), /lot number printed on the vial/);
  await rejects(lib.createDraft(db, editor, { kind: 'picture', message: 'Use this picture' }), /Choose the product/);
  await lib.createDraft(db, editor, { kind: 'coa', product: { id: 755, name: 'Example 10mg' }, lot: '301-10-0001', message: 'New report for this lot.\u0000' }, 100, id(1));
  assert.deepEqual(await lib.listUpdates(db, editor), [], 'drafts stay hidden');
  await rejects(lib.submitDraft(db, editor, id(1)), /Attach the lab report PDF/);

  // Files: stored in pieces, record written last, read back byte-for-byte.
  await rejects(lib.attachFile(db, other, id(1), 'report.pdf', pdf), /Request not found/, 404);
  const small = await lib.attachFile(db, editor, id(1), 'report.pdf', pdf, 110, id(11));
  const large = await lib.attachFile(db, editor, id(1), 'vial.png', png, 120, id(12));
  assert.equal(sqlite.prepare('SELECT chunks FROM site_update_files WHERE id=?').get(id(12)).chunks, 3);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM site_update_file_chunks WHERE file_id=?').get(id(12)).n, 3);
  assert.deepEqual(Buffer.from((await lib.readFile(db, editor, large.file.id)).bytes), Buffer.from(png));
  assert.deepEqual(Buffer.from((await lib.readFile(db, owner, small.file.id)).bytes), Buffer.from(pdf), 'an owner can read any file');
  await rejects(lib.readFile(db, other, small.file.id), /File not found/, 404);
  sqlite.prepare('UPDATE site_update_file_chunks SET data=? WHERE file_id=? AND seq=1').run(new Uint8Array(lib.CHUNK_BYTES), id(12));
  await rejects(lib.readFile(db, editor, large.file.id), /could not be read/, 500);
  for (let n = 0; n < lib.MAX_FILES - 2; n++) await lib.attachFile(db, editor, id(1), 'extra' + n + '.pdf', pdf, 130 + n, id(20 + n));
  await rejects(lib.attachFile(db, editor, id(1), 'one-too-many.pdf', pdf), /holds up to/);

  // Sending, then visibility: requester sees their own, the owner sees all, nobody else sees any.
  assert.match((await lib.submitDraft(db, editor, id(1), 200)).message, /Request #1 sent/);
  assert.match((await lib.submitDraft(db, editor, id(1), 201)).message, /already sent/);
  await rejects(lib.attachFile(db, editor, id(1), 'late.pdf', pdf), /Files can be added while/, 409);
  const [mine] = await lib.listUpdates(db, editor);
  assert.deepEqual([mine.number, mine.status, mine.kind, mine.lot, mine.productName, mine.message, mine.files.length], [1, 'new', 'coa', '301-10-0001', 'Example 10mg', 'New report for this lot.', lib.MAX_FILES]);
  assert.deepEqual(await lib.listUpdates(db, other), []);
  assert.equal((await lib.listUpdates(db, owner)).length, 1);
  await rejects(lib.addNote(db, other, id(1), 'let me in'), /Request not found/, 404);
  await rejects(lib.cancelUpdate(db, other, id(1)), /Request not found/, 404);

  // The desk tool's writes: claim, ask a question, the requester answers, finish as done.
  const desk = await import('../scripts/site-updates.mjs');
  const exec = s => sqlite.prepare(s.sql).run(...s.params);
  assert.throws(() => desk.finishStatements({ id: id(1), status: 'cancelled', note: 'x', noteId: id(90) }), /done, question or needs_owner/);
  assert.throws(() => desk.finishStatements({ id: id(1), status: 'done', note: '  ', noteId: id(90) }), /needs a note/);
  sqlite.prepare("UPDATE site_updates SET status='working',updated=210 WHERE id=? AND status='new'").run(id(1));
  await rejects(lib.cancelUpdate(db, editor, id(1)), /being worked on right now/, 409);
  for (const s of desk.finishStatements({ id: id(1), status: 'question', note: 'Which lot is on the label?', now: 220, noteId: id(91) })) assert.equal(exec(s).changes, 1);
  let [asked] = await lib.listUpdates(db, editor);
  assert.deepEqual([asked.status, asked.notes.at(-1).author, asked.notes.at(-1).authorType, asked.notes.at(-1).body], ['question', 'Website desk', 'claude', 'Which lot is on the label?']);
  assert.match((await lib.attachFile(db, editor, id(2), 'x.pdf', pdf).catch(e => e)).message, /Request not found/);
  assert.match((await lib.addNote(db, editor, id(1), 'Lot 301-10-0001.', 230)).message, /back in line/);
  assert.equal((await lib.listUpdates(db, editor))[0].status, 'new', 'an answer puts the request back in line');
  sqlite.prepare("UPDATE site_updates SET status='working' WHERE id=?").run(id(1));
  for (const s of desk.finishStatements({ id: id(1), status: 'done', note: 'Published on the product page.', result: '{"commit":"abc1234"}', now: 240, noteId: id(92) })) assert.equal(exec(s).changes, 1);
  const stale = desk.finishStatements({ id: id(1), status: 'done', note: 'Again.', now: 250, noteId: id(93) });
  assert.equal(exec(stale[0]).changes, 0, 'a finished request is not finished twice'); assert.equal(exec(stale[1]).changes, 0, 'and no stray note is written');
  await rejects(lib.cancelUpdate(db, editor, id(1)), /already closed/, 409);
  assert.match((await lib.addNote(db, editor, id(1), 'That is the wrong picture.', 260)).message, /back in line/);
  assert.equal((await lib.listUpdates(db, editor))[0].status, 'new', 'a message on a finished request reopens it');

  // Outside the lane: only an owner decides.
  await lib.createDraft(db, editor, { kind: 'other', message: 'Please lower the price by ten dollars.' }, 300, id(2));
  await lib.submitDraft(db, editor, id(2), 301);
  for (const s of desk.finishStatements({ id: id(2), status: 'needs_owner', note: 'Prices need the owner.', now: 310, noteId: id(94) })) exec(s);
  await rejects(lib.decideUpdate(db, editor, id(2), true, ''), /Only an owner/, 403);
  assert.match((await lib.decideUpdate(db, owner, id(2), true, '', 320)).message, /Approved/);
  const approved = (await lib.listUpdates(db, owner)).find(u => u.id === id(2));
  assert.deepEqual([approved.status, approved.ownerOk, approved.notes.at(-1).authorType, approved.notes.at(-1).body], ['new', true, 'owner', 'Approved by the owner.']);
  await rejects(lib.decideUpdate(db, owner, id(2), true, ''), /not waiting for an owner/, 409);
  await lib.createDraft(db, editor, { kind: 'wording', message: 'Fix the typo on the shipping page.' }, 400, id(3));
  await lib.submitDraft(db, editor, id(3), 401);
  assert.match((await lib.cancelUpdate(db, editor, id(3), 410)).message, /Nothing was changed/);
  await rejects(lib.addNote(db, editor, id(3), 'still there?'), /closed/, 409);

  // Open-request cap.
  for (let n = 0; n < lib.MAX_OPEN; n++) await lib.createDraft(db, other, { kind: 'wording', message: 'Request number ' + n }, 500 + n, id(100 + n)).catch(() => undefined);
  await rejects(lib.createDraft(db, other, { kind: 'wording', message: 'One more request' }), /requests open/, 429);

  // Database guards.
  assert.throws(() => sqlite.prepare("INSERT INTO site_updates(id,requester,kind,message,status,created,updated) VALUES(?,?,?,?,?,1,1)").run(id(900), 'x@example.invalid', 'price', 'hello', 'new'), /CHECK constraint/);
  assert.throws(() => sqlite.prepare("INSERT INTO site_update_access VALUES('Mixed@Example.invalid',1,1,'x')").run(), /CHECK constraint/);

  // Routes: owner-or-granted only, same-origin writes, no permission detail leaked, files download-only.
  const route = read('app/api/site-updates/route.ts'), fileRoute = read('app/api/site-updates/file/route.ts'), auth = read('lib/site-updates-auth.ts'), store = read('app/api/store/[action]/route.ts');
  for (const source of [route, fileRoute]) {
    assert.match(source, /requireSiteRequester\(\)/); assert.match(source, /req\.headers\.get\('origin'\) !== req\.nextUrl\.origin/);
    assert.match(source, /Administrator sign-in required\./); assert.doesNotMatch(source, /requireStaff\(/);
  }
  assert.match(auth, /if \(!await hasSiteUpdateAccess\(runtime\(\)\.DB, \{ email: u\.email, role \}\)\) throw/);
  assert.match(fileRoute, /'Content-Type': 'application\/octet-stream'/); assert.match(fileRoute, /attachment; filename=/); assert.match(fileRoute, /nosniff/);
  assert.match(store, /'admin-staff-site-updates': 'team:manage'/);
  assert.match(store, /permissions: \[\.\.\.permissionsFor\(role\), \.\.\.\(siteRequests \? \['site:request'\] : \[\]\)\]/);
  assert.match(store, /role: z\.enum\(assignableRoles\)/, 'every assignable role, including Catalog, can be saved from the Team tab');
  // Admin wiring and the rules document.
  const admin = read('components/store/admin.tsx'), team = read('components/store/team-admin.tsx');
  assert.match(admin, /\['updates', 'Website updates'\]/); assert.match(admin, /<TabsContent value="updates">\{activeTab === 'updates' && <SiteUpdates/);
  assert.match(team, /Website updates for ' \+ member\.email/);
  const lane = read('docs/site-updates-lane-v1.md');
  for (const phrase of ['Prices, pack prices, sales', 'never followed', 'lot\n   printed on the vial label', 'requesterHasGrant', 'website-change-rule-v1.md']) assert(lane.includes(phrase), 'lane rule: ' + phrase);
  assert.doesNotMatch(lane + read('lib/site-updates.ts') + read('scripts/site-updates.mjs'), /@(?!example\.invalid)[a-z0-9-]+\.(?:com|net|org)\b/i, 'no real addresses in the public repository');
  console.log('site updates: access, files, lifecycle, desk writes, owner decisions and wiring passed');
})().catch(error => { console.error(error); process.exit(1); });
