import { requireCustomer } from '@/lib/auth';
import { run, uid, timestamp } from '@/lib/runtime';
import { addressSchema } from '@/lib/checkout';
import type { StorePostContext } from '@/lib/store-api/context';
import { j, str } from '@/lib/store-api/shared';

export async function accountWrite(context: StorePostContext) {
    const { action, b } = context;
    if (action === 'profile') {
        const u = await requireCustomer();
        await run('INSERT INTO profiles(id,name,phone,company,research_accepted,created) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,company=excluded.company,research_accepted=excluded.research_accepted', u.id, str(b.name, 100), str(b.phone, 30), str(b.company, 150), b.accepted ? 1 : 0, timestamp());
        return j({ message: 'Profile saved.' });
    }
    if (action === 'address') {
        const u = await requireCustomer();
        if (b.remove) {
            await run('DELETE FROM addresses WHERE id=? AND owner=?', str(b.id, 50), u.id);
            return j({ ok: true });
        }
        const data = addressSchema.parse(b);
        const id = typeof b.id === 'string' ? b.id : uid();
        if (b.id) {
            await run('UPDATE addresses SET data=? WHERE id=? AND owner=?', JSON.stringify(data), id, u.id);
        }
        else
            await run('INSERT INTO addresses(id,owner,data,created) VALUES(?,?,?,?)', id, u.id, JSON.stringify(data), timestamp());
        return j({ message: 'Address saved.' });
    }
}

