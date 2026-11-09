import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { database } from '@/lib/runtime';
import { contactList, sourceLabels } from '@/lib/contacts';
import { csv } from '@/lib/affiliate-onboarding';
import { contactsForAdmin } from '@/lib/crm-capture';
import { siteLabels } from '@/lib/shared-crm';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store, private' };
/** The contact list for staff who read reports. CSV for import into a mailing or texting tool. */
export async function GET(req: NextRequest) {
 try { await requireStaff('reports:read'); }
 catch { return NextResponse.json({ error: 'Administrator sign-in required.' }, { status: 403, headers }); }
 try {
  const { contacts, shared } = await contactsForAdmin(await contactList(database()));
  if (req.nextUrl.searchParams.get('format') === 'csv') {
   const day = new Date().toISOString().slice(0, 10);
   return new NextResponse(csv([['Email', 'Name', 'Stores', 'Phone', 'Other phones', 'Sources', 'First seen', 'Last seen', 'Orders', 'Paid orders', 'Paid total (USD)'], ...contacts.map(c => [c.email, c.name, c.stores.map(s => siteLabels[s.site]).join(' + '), c.phones[0] || '', c.phones.slice(1).join('; '), c.sources.map(s => sourceLabels[s]).join('; '), new Date(c.firstSeen).toISOString().slice(0, 10), new Date(c.lastSeen).toISOString().slice(0, 10), c.orders, c.paidOrders, (c.paidCents / 100).toFixed(2)])]),
    { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="Biomod contacts ${day} v1.csv"` } });
  }
  return NextResponse.json({ contacts, shared, total: contacts.length, withPhone: contacts.filter(c => c.phones.length).length }, { headers });
 } catch { return NextResponse.json({ error: 'Contacts could not be loaded.' }, { status: 500, headers }); }
}
