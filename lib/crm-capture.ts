/** This store's link to the shared CRM (lib/shared-crm.ts). The only store-specific line is CRM_SITE. */
import { runtime } from '@/lib/runtime';
import { publishContacts, publishOne, sharedContactList, type CrmSite, type SharedContact } from './shared-crm';
import type { Contact, ContactSource } from './contacts';

export const CRM_SITE: CrmSite = 'trybiomod';
export const sharedCrm = () => (runtime() as unknown as { CRM?: D1Database }).CRM;

const cleanEmail = (v: unknown) => { const s = String(v ?? '').trim().toLowerCase(); return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s) ? s : ''; };
const cleanPhone = (v: unknown) => { const s = String(v ?? '').trim(); const d = s.replace(/\D/g, ''); return d.length >= 7 && d.length <= 15 ? s.slice(0, 30) : ''; };

/** Called right after the store records a contact. Never throws. */
export async function shareContact(input: { email: unknown; owner?: string | null; name?: unknown; phone?: unknown; source: ContactSource }, now = Date.now()) {
  const email = cleanEmail(input.email); if (!email) return;
  const phone = cleanPhone(input.phone);
  await publishOne(sharedCrm(), CRM_SITE, { email, name: String(input.name ?? '').trim().slice(0, 100), phones: phone ? [phone] : [], sources: [input.source], firstSeen: now, lastSeen: now, orders: 0, paidOrders: 0, paidCents: 0, owner: input.owner || null });
}

/** The Contacts tab list: this store's live list published, then everyone from both stores. */
export async function contactsForAdmin(local: Contact[]): Promise<{ contacts: SharedContact[]; shared: boolean }> {
  const crm = sharedCrm();
  const own = (): SharedContact[] => local.map(c => ({ ...c, stores: [{ site: CRM_SITE, sources: c.sources, orders: c.orders, paidOrders: c.paidOrders, paidCents: c.paidCents, firstSeen: c.firstSeen, lastSeen: c.lastSeen }] }));
  if (!crm) return { contacts: own(), shared: false };
  try {
    await publishContacts(crm, CRM_SITE, local);
    return { contacts: await sharedContactList(crm, CRM_SITE, local), shared: true };
  } catch { return { contacts: own(), shared: false }; }
}
