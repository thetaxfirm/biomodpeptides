import { cookies } from 'next/headers';
import { requireCustomer } from '@/lib/auth';
import { presentationData } from '@/lib/private-presentation';
import { orderView } from '@/lib/catalog-visibility';
import { all, one, parse, database } from '@/lib/runtime';
import { readGuest } from '@/lib/guest-checkout';
import type { StoreGetContext } from '@/lib/store-api/context';
import { j } from '@/lib/store-api/shared';

export async function accountRead(context: StoreGetContext) {
    const { action, u } = context;
    if (action === 'account') {
        if (!u) {
            const guest = await readGuest(database(), (await cookies()).get('bm_session')?.value);
            if (guest) return j({ guest: true, profile: null, addresses: [], requests: [], rewards: [], orders: (await all<{ data: string }>('SELECT id,status,total,data,created FROM orders WHERE owner=? ORDER BY created DESC LIMIT 100', guest.id)).map(o => ({ ...o, data: orderView(parse(o.data, {})) })) });
        }
        const user = await requireCustomer();
        return j({ profile: await one('SELECT name,phone,company,research_accepted FROM profiles WHERE id=?', user.id), addresses: (await all<{
                id: string;
                data: string;
            }>('SELECT id,data FROM addresses WHERE owner=? ORDER BY created DESC', user.id)).map(a => ({ id: a.id, ...parse(a.data, {}) })), orders: (await all<{
                data: string;
            }>('SELECT id,status,total,data,created FROM orders WHERE owner=? ORDER BY created DESC LIMIT 100', user.id)).map(o => ({ ...o, data: orderView(parse(o.data, {})) })), requests: (await all<{
                data: string;
            }>('SELECT id,kind,data,status,created FROM requests WHERE owner=? AND kind IN (\'contact\',\'stock\',\'affiliate\') ORDER BY created DESC LIMIT 100', user.id)).map(r => ({ ...r, data: presentationData(parse(r.data, {})) })), rewardBalance: (await one<{balance:number}>('SELECT COALESCE(SUM(points),0) balance FROM rewards WHERE owner=?', user.id))?.balance ?? 0, rewards: presentationData(await all('SELECT points,reason,created FROM rewards WHERE owner=? ORDER BY created DESC LIMIT 100', user.id)) });
    }
}

