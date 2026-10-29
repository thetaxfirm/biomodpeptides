/** The site's contact list: every email and phone a visitor has given us, merged by email.
 * Accounts are captured at sign-up and sign-in (their email lives with the auth provider);
 * orders, contact forms, stock alerts, COA requests and affiliates are read where they are stored.
 * Anonymous browsing is never tied to a person.
 */
export type ContactSource = 'account' | 'order' | 'contact_form' | 'stock_alert' | 'coa_request' | 'affiliate';
export type Contact = { email: string; name: string; phones: string[]; sources: ContactSource[]; firstSeen: number; lastSeen: number; orders: number; paidOrders: number; paidCents: number; owner: string | null };
const cleanEmail = (v: unknown) => { const s = String(v ?? '').trim().toLowerCase(); return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s) ? s : ''; };
const cleanPhone = (v: unknown) => { const s = String(v ?? '').trim(); const digits = s.replace(/\D/g, ''); return digits.length >= 7 && digits.length <= 15 ? s.slice(0, 30) : ''; };
/** Best-effort: a failure here must never block a sign-in or a form. */
export async function recordContact(db: D1Database | undefined, input: { email: unknown; owner?: string | null; name?: unknown; phone?: unknown; source: ContactSource }, now = Date.now()) {
 const email = cleanEmail(input.email); if (!db || !email) return;
 try {
  await db.prepare(`INSERT INTO crm_contacts(email,owner,name,phone,sources,first_seen,last_seen) VALUES(?,?,?,?,json_array(?),?,?)
   ON CONFLICT(email) DO UPDATE SET owner=COALESCE(excluded.owner,crm_contacts.owner),name=CASE WHEN excluded.name<>'' THEN excluded.name ELSE crm_contacts.name END,
   phone=CASE WHEN excluded.phone<>'' THEN excluded.phone ELSE crm_contacts.phone END,
   sources=CASE WHEN EXISTS(SELECT 1 FROM json_each(crm_contacts.sources) WHERE value=?) THEN crm_contacts.sources ELSE json_insert(crm_contacts.sources,'$[#]',?) END,last_seen=excluded.last_seen`)
   .bind(email, input.owner || null, String(input.name ?? '').trim().slice(0, 100), cleanPhone(input.phone), input.source, now, now, input.source, input.source).run();
 } catch { /* contact capture is secondary */ }
}
export async function contactList(db: D1Database, limit = 5000): Promise<Contact[]> {
 const map = new Map<string, Contact>(), byOwner = new Map<string, string>();
 const add = (emailRaw: unknown, source: ContactSource, at: number, extra: { name?: unknown; phone?: unknown; owner?: string | null } = {}) => {
  const email = cleanEmail(emailRaw); if (!email) return null;
  let c = map.get(email);
  if (!c) { c = { email, name: '', phones: [], sources: [], firstSeen: at, lastSeen: at, orders: 0, paidOrders: 0, paidCents: 0, owner: null }; map.set(email, c); }
  const name = String(extra.name ?? '').trim().slice(0, 100), phone = cleanPhone(extra.phone);
  if (name && (!c.name || at >= c.lastSeen)) c.name = name;
  if (phone && !c.phones.some(p => p.replace(/\D/g, '') === phone.replace(/\D/g, ''))) c.phones.push(phone);
  if (!c.sources.includes(source)) c.sources.push(source);
  if (extra.owner) { c.owner = extra.owner; byOwner.set(extra.owner, email); }
  c.firstSeen = Math.min(c.firstSeen, at); c.lastSeen = Math.max(c.lastSeen, at);
  return c;
 };
 const q = async <T,>(sql: string) => { try { return (await db.prepare(sql).all<T>()).results; } catch { return [] as T[]; } };
 for (const r of await q<{ email: string; owner: string | null; name: string; phone: string; sources: string; first_seen: number; last_seen: number }>(`SELECT email,owner,name,phone,sources,first_seen,last_seen FROM crm_contacts ORDER BY last_seen DESC LIMIT ${limit}`)) {
  const c = add(r.email, 'account', r.first_seen, { name: r.name, phone: r.phone, owner: r.owner });
  if (c) { c.lastSeen = Math.max(c.lastSeen, r.last_seen); try { for (const s of JSON.parse(r.sources) as ContactSource[]) if (!c.sources.includes(s)) c.sources.push(s); } catch { /* keep what parsed */ } }
 }
 for (const r of await q<{ owner: string; email: string; name: string; phone: string; status: string; total: number; created: number }>(`SELECT owner,json_extract(data,'$.email') email,json_extract(data,'$.address.name') name,json_extract(data,'$.address.phone') phone,status,total,created FROM orders WHERE COALESCE(json_extract(data,'$.internalTest'),0)=0 ORDER BY created DESC LIMIT ${limit}`)) {
  const c = add(r.email, 'order', r.created, { name: r.name, phone: r.phone, owner: r.owner });
  if (c) { c.orders++; if (['paid', 'labeling', 'shipped', 'delivered'].includes(r.status)) { c.paidOrders++; c.paidCents += r.total; } }
 }
 const kinds: Record<string, ContactSource> = { contact: 'contact_form', stock: 'stock_alert', coa_link: 'coa_request', coa: 'coa_request', affiliate: 'affiliate' };
 for (const r of await q<{ kind: string; owner: string | null; email: string; name: string; phone: string; created: number }>(`SELECT kind,owner,json_extract(data,'$.email') email,json_extract(data,'$.name') name,json_extract(data,'$.phone') phone,created FROM requests WHERE kind IN ('contact','stock','coa_link','coa','affiliate') ORDER BY created DESC LIMIT ${limit}`))
  add(r.email, kinds[r.kind], r.created, { name: r.name, phone: r.phone, owner: r.owner });
 for (const r of await q<{ owner: string; email: string; name: string; created: number }>(`SELECT owner,email,name,created FROM affiliate_members LIMIT ${limit}`)) add(r.email, 'affiliate', r.created, { name: r.name, owner: r.owner });
 for (const r of await q<{ owner: string; phone: string; created: number }>(`SELECT owner,phone,created FROM affiliate_tax_profiles LIMIT ${limit}`)) { const e = byOwner.get(r.owner); if (e) add(e, 'affiliate', r.created, { phone: r.phone }); }
 for (const r of await q<{ id: string; name: string; phone: string; created: number }>(`SELECT id,name,phone,created FROM profiles WHERE phone<>'' OR name<>'' LIMIT ${limit}`)) { const e = byOwner.get(r.id); if (e) add(e, 'account', r.created, { name: r.name, phone: r.phone }); }
 return [...map.values()].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit);
}
export const sourceLabels: Record<ContactSource, string> = { account: 'Account', order: 'Order', contact_form: 'Contact form', stock_alert: 'Stock alert', coa_request: 'COA request', affiliate: 'Affiliate' };
