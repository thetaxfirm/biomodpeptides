import { createHash, randomUUID } from 'node:crypto';
import type { CartLine } from './commerce';

export type CartConflict = { id: string; revision: string; current: CartLine[]; saved: CartLine[]; message: string };
type ImportRow = { sequence: number; id: string; owner: string; data: string; status: string; created: number };
type SavedRow = { cart: string };
type Snapshot = { sessionId: string; guestCart: CartLine[]; savedCart?: CartLine[]; choice?: string };
const KIND = 'cart_import';
const ACTIVE = "status IN ('cart_pending','cart_conflict')";
const WINDOW = 60 * 60 * 1000;
const message = 'Your shopping cart and your saved account cart are different. Choose which one to use before checkout.';
const revision = (data: string, saved: string) => createHash('sha256').update(data + '\n' + saved).digest('hex');

/** Database injection keeps cart transfers testable without touching production accounts. */
export function createCartImports({ db, normalize, validate, now = Date.now }: {
  db: D1Database; normalize: (value: unknown) => CartLine[];
  validate: (lines: CartLine[]) => Promise<unknown>; now?: () => number;
}) {
  const stmt = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).bind(...args);
  const readLines = (raw: string) => normalize(JSON.parse(raw));
  const snapshot = (row: ImportRow) => { const data = JSON.parse(row.data) as Snapshot; return { ...data, guestCart: normalize(data.guestCart) }; };
  const active = (owner: string, sessionId: string) => stmt(`SELECT rowid AS sequence,id,owner,data,status,created FROM requests WHERE owner=? AND kind=? AND json_extract(data,'$.sessionId')=? AND ${ACTIVE} ORDER BY rowid DESC LIMIT 1`, owner, KIND, sessionId).first<ImportRow>();
  const saved = async (owner: string) => {
    await stmt('INSERT OR IGNORE INTO customer_carts(id,cart,updated) VALUES(?,?,?)', owner, '[]', now()).run();
    return (await stmt('SELECT cart FROM customer_carts WHERE id=?', owner).first<SavedRow>())!;
  };
  async function atomic(condition: string, args: (string | number | null)[], writes: D1PreparedStatement[]) {
    const guard = randomUUID();
    await db.batch([
      stmt('INSERT INTO transaction_guards(id,valid) SELECT ?,CASE WHEN ' + condition + ' THEN 1 ELSE 0 END', guard, ...args),
      ...writes,
      stmt('DELETE FROM transaction_guards WHERE id=?', guard),
    ]);
  }
  async function ownerForSession(sessionId: string): Promise<string | null> {
    const row = await stmt("SELECT owner FROM requests WHERE kind=? AND json_extract(data,'$.sessionId')=? ORDER BY rowid DESC LIMIT 1", KIND, sessionId).first<{ owner: string }>();
    return row?.owner || null;
  }
  async function bindOwner(owner: string, sessionId: string) {
    const claimed = await ownerForSession(sessionId);
    if (claimed && claimed !== owner) throw new Error('Start a fresh shopping session before switching accounts.');
    if (claimed) return;
    const data = JSON.stringify({ sessionId, guestCart: [] });
    await stmt("INSERT INTO requests(id,owner,kind,data,status,created) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM requests WHERE kind=? AND json_extract(data,'$.sessionId')=?)", randomUUID(), owner, KIND, data, 'cart_resolved', now(), KIND, sessionId).run();
    if (await ownerForSession(sessionId) !== owner) throw new Error('Start a fresh shopping session before switching accounts.');
  }
  async function record(owner: string, sessionId: string) {
    const claimedOwner = await ownerForSession(sessionId);
    if (claimedOwner && claimedOwner !== owner) throw new Error('Start a fresh shopping session before switching accounts.');
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await active(owner, sessionId)) return;
      const session = await stmt('SELECT cart FROM sessions WHERE id=?', sessionId).first<SavedRow>();
      if (!session) throw new Error('Your shopping session expired. Refresh and sign in again.');
      const data = JSON.stringify({ sessionId, guestCart: readLines(session.cart) });
      try {
        await atomic(`EXISTS(SELECT 1 FROM sessions WHERE id=? AND cart=?) AND NOT EXISTS(SELECT 1 FROM requests WHERE owner=? AND kind=? AND json_extract(data,'$.sessionId')=? AND ${ACTIVE}) AND NOT EXISTS(SELECT 1 FROM requests WHERE kind=? AND json_extract(data,'$.sessionId')=? AND owner<>?)`, [sessionId, session.cart, owner, KIND, sessionId, KIND, sessionId, owner], [
          stmt('INSERT INTO requests(id,owner,kind,data,status,created) VALUES(?,?,?,?,?,?)', randomUUID(), owner, KIND, data, 'cart_pending', now()),
        ]);
        return;
      } catch (e) { if (attempt === 2) throw e; }
    }
  }
  async function finish(row: ImportRow, sessionId: string, before: SavedRow, selected: CartLine[], choice: string) {
    const session = await stmt('SELECT cart FROM sessions WHERE id=?', sessionId).first<SavedRow>();
    if (!session) throw new Error('Your shopping session expired. Refresh and sign in again.');
    const next = JSON.stringify(selected);
    const data = JSON.stringify({ ...snapshot(row), savedCart: readLines(before.cart), choice });
    await atomic(`EXISTS(SELECT 1 FROM requests WHERE id=? AND owner=? AND kind=? AND data=? AND ${ACTIVE}) AND EXISTS(SELECT 1 FROM customer_carts WHERE id=? AND cart=?) AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND cart=?)`, [row.id, row.owner, KIND, row.data, row.owner, before.cart, sessionId, session.cart], [
      stmt('UPDATE customer_carts SET cart=?,updated=? WHERE id=?', next, now(), row.owner),
      stmt('UPDATE sessions SET cart=?,updated=? WHERE id=?', next, now(), sessionId),
      stmt('UPDATE requests SET data=?,status=? WHERE id=?', data, 'cart_resolved', row.id),
    ]);
  }
  async function inspect(owner: string, sessionId: string): Promise<CartConflict | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await active(owner, sessionId);
      if (!row) return null;
      const before = await saved(owner), old = readLines(before.cart), current = snapshot(row).guestCart;
      let issue = message;
      // No selection is lost or doubled when the guest cart is empty or already saved.
      const same = JSON.stringify(current) === JSON.stringify(old);
      let automatic = !current.length || same;
      if (!automatic && !old.length && row.status === 'cart_pending' && now() - row.created <= WINDOW) {
        try { await validate(current); automatic = true; } catch (e) { issue = e instanceof Error ? e.message : 'Review current availability before choosing your cart.'; }
      }
      if (automatic) {
        try { await finish(row, sessionId, before, !current.length ? old : current, 'automatic'); return null; }
        catch (e) { if (attempt < 2) continue; throw e; }
      }
      await stmt("UPDATE requests SET status='cart_conflict' WHERE id=? AND status='cart_pending' AND data=?", row.id, row.data).run();
      return { id: row.id, revision: revision(row.data, before.cart), current, saved: old, message: issue };
    }
    throw new Error('Your cart changed. Refresh and review it again.');
  }
  async function choose(owner: string, sessionId: string, id: string, expected: string, choice: string) {
    if (!['current', 'saved', 'empty'].includes(choice)) throw new Error('Choose your shopping cart or saved cart.');
    const row = await stmt("SELECT rowid AS sequence,id,owner,data,status,created FROM requests WHERE id=? AND owner=? AND kind=? AND json_extract(data,'$.sessionId')=?", id, owner, KIND, sessionId).first<ImportRow>();
    if (!row) throw new Error('This cart choice is no longer available. Refresh your cart.');
    if (row.status === 'cart_resolved') return; // Repeated submissions never re-import or overwrite.
    if (!['cart_pending', 'cart_conflict'].includes(row.status)) throw new Error('Refresh your cart before choosing.');
    const before = await saved(owner);
    if (expected !== revision(row.data, before.cart)) throw new Error('A cart changed in another tab. Refresh and review both carts again.');
    const selected = choice === 'empty' ? [] : choice === 'current' ? snapshot(row).guestCart : readLines(before.cart);
    await validate(selected);
    try { await finish(row, sessionId, before, selected, choice); }
    catch {
      const after = await stmt('SELECT status FROM requests WHERE id=?', row.id).first<{ status: string }>();
      if (after?.status !== 'cart_resolved') throw new Error('A cart changed. Refresh and review both carts again.');
    }
  }
  async function assertResolved(owner: string, sessionId: string) {
    if (await inspect(owner, sessionId)) throw new Error('Choose which cart to use in Your Cart before continuing.');
  }
  // A guest POST can arrive after login. Keep it in the import instead of losing it.
  async function saveGuest(sessionId: string, lines: CartLine[]) {
    const next = JSON.stringify(normalize(lines));
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await stmt("SELECT rowid AS sequence,id,owner,data,status,created FROM requests WHERE kind=? AND json_extract(data,'$.sessionId')=? ORDER BY rowid DESC LIMIT 1", KIND, sessionId).first<ImportRow>();
      try {
        if (!latest) {
          await atomic("NOT EXISTS(SELECT 1 FROM requests WHERE kind=? AND json_extract(data,'$.sessionId')=?)", [KIND, sessionId], [stmt('UPDATE sessions SET cart=?,updated=? WHERE id=?', next, now(), sessionId)]);
        } else {
          const data = JSON.stringify({ sessionId, guestCart: normalize(lines) });
          const update = ['cart_pending', 'cart_conflict'].includes(latest.status)
            ? stmt('UPDATE requests SET data=? WHERE id=?', data, latest.id)
            : stmt('INSERT INTO requests(id,owner,kind,data,status,created) VALUES(?,?,?,?,?,?)', randomUUID(), latest.owner, KIND, data, 'cart_conflict', now());
          await atomic("EXISTS(SELECT 1 FROM requests WHERE id=? AND data=? AND status=?) AND NOT EXISTS(SELECT 1 FROM requests WHERE kind=? AND json_extract(data,'$.sessionId')=? AND rowid>?)", [latest.id, latest.data, latest.status, KIND, sessionId, latest.sequence], [stmt('UPDATE sessions SET cart=?,updated=? WHERE id=?', next, now(), sessionId), update]);
        }
        return;
      } catch (e) { if (attempt === 2) throw e; }
    }
  }
  return { record, inspect, choose, assertResolved, saveGuest, ownerForSession, bindOwner };
}
