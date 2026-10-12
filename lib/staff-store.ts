// Staff directory for the admin Team tab. Only owners reach these functions (team:manage).
import { assignableRoles, normalizeStaffEmail, validStaffEmail, type AssignableRole } from './staff';

type StaffEnvironment = Record<string, string | undefined> & { DB: D1Database };
export type StaffMember = { email: string; name: string; role: AssignableRole; active: number; created: number; updated: number; updated_by: string };
export type StaffChange = { email: string; name?: string; role: AssignableRole; active: boolean };

const owners = (env: StaffEnvironment) => (env.STORE_ADMIN_EMAILS || '').split(',').map(normalizeStaffEmail).filter(Boolean);

export async function staffDirectory(env: StaffEnvironment) {
  try {
    const staff = (await env.DB.prepare('SELECT email,name,role,active,created,updated,updated_by FROM staff ORDER BY active DESC,email').all<StaffMember>()).results;
    const audit = (await env.DB.prepare('SELECT actor,email,role,active,created FROM staff_audit ORDER BY created DESC LIMIT 50').all()).results;
    return { ready: true, owners: owners(env), staff, audit };
  }
  catch {
    // Before the staff migration is applied the Team tab says so instead of failing the dashboard.
    return { ready: false, owners: owners(env), staff: [], audit: [] };
  }
}

export async function saveStaffMember(env: StaffEnvironment, actorEmail: string, change: StaffChange, now = Date.now()) {
  const email = normalizeStaffEmail(change.email);
  if (!validStaffEmail(email)) throw new Error('Enter one valid email address.');
  if (!assignableRoles.includes(change.role)) throw new Error('Choose Manager, Fulfillment or Support.');
  if (owners(env).includes(email)) throw new Error('This address is already an owner. Owners are changed in Cloudflare (STORE_ADMIN_EMAILS).');
  const name = (change.name || '').trim().slice(0, 100);
  const actor = normalizeStaffEmail(actorEmail);
  const active = change.active ? 1 : 0;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO staff(email,name,role,active,created,updated,updated_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,role=excluded.role,active=excluded.active,updated=excluded.updated,updated_by=excluded.updated_by')
      .bind(email, name, change.role, active, now, now, actor),
    env.DB.prepare('INSERT INTO staff_audit(id,actor,email,role,active,created) VALUES(?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), actor, email, change.role, active, now),
  ]);
  return { message: active ? email + ' can now sign in as ' + change.role + '.' : email + ' no longer has store access.' };
}
