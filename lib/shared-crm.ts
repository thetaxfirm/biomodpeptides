/** One CRM for TryBiomod and Biomod Pro (owner direction, Nov 8 2026: "we want the CRM to be
 * attached for both to be one"). Each store keeps its own orders and contact sources; it publishes
 * its contact list, per store, into the shared D1 database bound as CRM, and reads everyone back.
 * Internal only: nothing here is shown to customers or used to send anything. If the CRM binding
 * is missing or fails, each store falls back to its own list exactly as before.
 * The same file runs in both stores; keep the copies identical.
 */
import type { Contact, ContactSource } from './contacts';

export type CrmSite = 'trybiomod' | 'biomodpro';
export const siteLabels: Record<CrmSite, string> = { trybiomod: 'TryBiomod', biomodpro: 'Biomod Pro' };
export type StoreActivity = { site: CrmSite; sources: ContactSource[]; orders: number; paidOrders: number; paidCents: number; firstSeen: number; lastSeen: number };
export type SharedContact = Contact & { stores: StoreActivity[] };

export const SHARED_CRM_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS crm_people(email TEXT PRIMARY KEY NOT NULL CHECK(email = lower(trim(email))), name TEXT NOT NULL DEFAULT '', phones TEXT NOT NULL DEFAULT '[]', first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, updated INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS crm_store_activity(email TEXT NOT NULL, site TEXT NOT NULL CHECK(site IN ('trybiomod','biomodpro')), sources TEXT NOT NULL DEFAULT '[]', orders INTEGER NOT NULL DEFAULT 0, paid_orders INTEGER NOT NULL DEFAULT 0, paid_cents INTEGER NOT NULL DEFAULT 0, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, fingerprint TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL, PRIMARY KEY(email, site))`,
  `CREATE INDEX IF NOT EXISTS crm_store_activity_site ON crm_store_activity(site)`,
  `CREATE TABLE IF NOT EXISTS crm_publish_log(site TEXT PRIMARY KEY NOT NULL CHECK(site IN ('trybiomod','biomodpro')), at INTEGER NOT NULL, published INTEGER NOT NULL, unchanged INTEGER NOT NULL)`,
];

const fingerprint = (c: Contact) => JSON.stringify([c.name, c.phones, [...c.sources].sort(), c.orders, c.paidOrders, c.paidCents, c.firstSeen, c.lastSeen]);

function personUpsert(db: D1Database, c: Contact, now: number) {
  return db.prepare(`INSERT INTO crm_people(email,name,phones,first_seen,last_seen,updated) VALUES(?,?,?,?,?,?)
   ON CONFLICT(email) DO UPDATE SET
    name=CASE WHEN excluded.name<>'' AND excluded.last_seen>=crm_people.last_seen THEN excluded.name WHEN crm_people.name='' THEN excluded.name ELSE crm_people.name END,
    phones=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(crm_people.phones) UNION SELECT value FROM json_each(excluded.phones))),
    first_seen=MIN(crm_people.first_seen,excluded.first_seen),last_seen=MAX(crm_people.last_seen,excluded.last_seen),updated=excluded.updated`)
    .bind(c.email, c.name, JSON.stringify(c.phones), c.firstSeen, c.lastSeen, now);
}
function activityUpsert(db: D1Database, site: CrmSite, c: Contact, now: number) {
  return db.prepare(`INSERT INTO crm_store_activity(email,site,sources,orders,paid_orders,paid_cents,first_seen,last_seen,fingerprint,updated) VALUES(?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(email,site) DO UPDATE SET sources=excluded.sources,orders=excluded.orders,paid_orders=excluded.paid_orders,paid_cents=excluded.paid_cents,first_seen=excluded.first_seen,last_seen=excluded.last_seen,fingerprint=excluded.fingerprint,updated=excluded.updated`)
    .bind(c.email, site, JSON.stringify(c.sources), c.orders, c.paidOrders, c.paidCents, c.firstSeen, c.lastSeen, fingerprint(c), now);
}

const prepared = new WeakSet<D1Database>();
export async function ensureSharedCrm(crm: D1Database) {
  if (prepared.has(crm)) return;
  await crm.batch(SHARED_CRM_SCHEMA.map(sql => crm.prepare(sql)));
  prepared.add(crm);
}

/** Writes this store's contacts into the shared CRM, skipping rows that have not changed. */
export async function publishContacts(crm: D1Database, site: CrmSite, contacts: Contact[], now = Date.now()) {
  await ensureSharedCrm(crm);
  const known = new Map((await crm.prepare('SELECT email,fingerprint FROM crm_store_activity WHERE site=?').bind(site).all<{ email: string; fingerprint: string }>()).results.map(r => [r.email, r.fingerprint]));
  const changed = contacts.filter(c => known.get(c.email) !== fingerprint(c));
  for (let i = 0; i < changed.length; i += 50) {
    const chunk = changed.slice(i, i + 50);
    await crm.batch(chunk.flatMap(c => [personUpsert(crm, c, now), activityUpsert(crm, site, c, now)]));
  }
  return { published: changed.length, unchanged: contacts.length - changed.length };
}

/** One contact as it is captured (sign-up, form, order). Best effort; never blocks the visitor. */
export async function publishOne(crm: D1Database | undefined, site: CrmSite, contact: Contact) {
  if (!crm) return;
  try {
    await ensureSharedCrm(crm);
    const existing = await crm.prepare('SELECT sources,orders,paid_orders,paid_cents,first_seen,last_seen FROM crm_store_activity WHERE email=? AND site=?').bind(contact.email, site)
      .first<{ sources: string; orders: number; paid_orders: number; paid_cents: number; first_seen: number; last_seen: number }>();
    const merged: Contact = existing ? { ...contact, sources: [...new Set([...(JSON.parse(existing.sources) as ContactSource[]), ...contact.sources])], orders: Math.max(existing.orders, contact.orders), paidOrders: Math.max(existing.paid_orders, contact.paidOrders), paidCents: Math.max(existing.paid_cents, contact.paidCents), firstSeen: Math.min(existing.first_seen, contact.firstSeen), lastSeen: Math.max(existing.last_seen, contact.lastSeen) } : contact;
    await crm.batch([personUpsert(crm, merged, Date.now()), activityUpsert(crm, site, merged, Date.now())]);
  } catch { /* the store's own contact record is already saved */ }
}

/** Everyone in the shared CRM, with this store's live list laid over its own (possibly older) rows. */
export async function sharedContactList(crm: D1Database, site: CrmSite, local: Contact[]): Promise<SharedContact[]> {
  const people = (await crm.prepare('SELECT email,name,phones,first_seen,last_seen FROM crm_people').all<{ email: string; name: string; phones: string; first_seen: number; last_seen: number }>()).results;
  const activity = (await crm.prepare('SELECT email,site,sources,orders,paid_orders,paid_cents,first_seen,last_seen FROM crm_store_activity').all<{ email: string; site: CrmSite; sources: string; orders: number; paid_orders: number; paid_cents: number; first_seen: number; last_seen: number }>()).results;
  const map = new Map<string, SharedContact>();
  const parse = <T,>(v: string, f: T): T => { try { return JSON.parse(v) as T; } catch { return f; } };
  for (const p of people) map.set(p.email, { email: p.email, name: p.name, phones: parse<string[]>(p.phones, []), sources: [], firstSeen: p.first_seen, lastSeen: p.last_seen, orders: 0, paidOrders: 0, paidCents: 0, owner: null, stores: [] });
  for (const a of activity) {
    if (a.site === site) continue; // this store's own rows come from the live list below
    const c = map.get(a.email); if (!c) continue;
    c.stores.push({ site: a.site, sources: parse<ContactSource[]>(a.sources, []), orders: a.orders, paidOrders: a.paid_orders, paidCents: a.paid_cents, firstSeen: a.first_seen, lastSeen: a.last_seen });
  }
  for (const l of local) {
    const c = map.get(l.email) || { ...l, stores: [] as StoreActivity[] };
    c.owner = l.owner; if (l.name && (!c.name || l.lastSeen >= c.lastSeen)) c.name = l.name;
    for (const ph of l.phones) if (!c.phones.some(x => x.replace(/\D/g, '') === ph.replace(/\D/g, ''))) c.phones.push(ph);
    c.stores = [...c.stores.filter(s => s.site !== site), { site, sources: l.sources, orders: l.orders, paidOrders: l.paidOrders, paidCents: l.paidCents, firstSeen: l.firstSeen, lastSeen: l.lastSeen }];
    c.firstSeen = Math.min(c.firstSeen, l.firstSeen); c.lastSeen = Math.max(c.lastSeen, l.lastSeen);
    map.set(l.email, c);
  }
  return [...map.values()].filter(c => c.stores.length).map(c => {
    const stores = [...c.stores].sort((a, b) => a.site.localeCompare(b.site));
    return { ...c, stores, sources: [...new Set(stores.flatMap(s => s.sources))], orders: stores.reduce((n, s) => n + s.orders, 0), paidOrders: stores.reduce((n, s) => n + s.paidOrders, 0), paidCents: stores.reduce((n, s) => n + s.paidCents, 0) };
  }).sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Scheduled copy of a store's whole list into the shared CRM, at most once an hour. Reads the store
 * database only; the run time is kept in the CRM so store change history stays quiet. Never throws. */
export async function publishOnSchedule(env: { DB: D1Database; CRM?: D1Database }, site: CrmSite, contactList: (db: D1Database) => Promise<Contact[]>, now = Date.now()) {
  if (!env.CRM) return;
  try {
    await ensureSharedCrm(env.CRM);
    const last = await env.CRM.prepare('SELECT at FROM crm_publish_log WHERE site=?').bind(site).first<{ at: number }>();
    if (last && now - last.at < 3600000) return;
    const result = await publishContacts(env.CRM, site, await contactList(env.DB), now);
    await env.CRM.prepare('INSERT INTO crm_publish_log(site,at,published,unchanged) VALUES(?,?,?,?) ON CONFLICT(site) DO UPDATE SET at=excluded.at,published=excluded.published,unchanged=excluded.unchanged').bind(site, now, result.published, result.unchanged).run();
  } catch { /* the next run retries */ }
}
