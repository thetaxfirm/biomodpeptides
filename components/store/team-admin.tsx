'use client';
import { FormEvent } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Field, Blank } from './primitives';
import { assignableRoles, roleDetails, type AssignableRole } from '@/lib/staff';

type Member = { email: string; name: string; role: AssignableRole; active: number; updated: number; updated_by: string };
type Audit = { actor: string; email: string; role: string; active: number; created: number };
type Team = { ready: boolean; owners: string[]; staff: Member[]; audit: Audit[] } | null;
type Props = {
  team: Team; busy: boolean; formKey: number;
  onDraft: () => void;
  onAdd: (e: FormEvent<HTMLFormElement>) => void;
  onChange: (member: Member, patch: { role?: AssignableRole; active?: boolean }) => void;
};

// Owner-only. Owners themselves are listed but managed in Cloudflare (STORE_ADMIN_EMAILS).
export function TeamAdmin({ team, busy, formKey, onDraft, onAdd, onChange }: Props) {
  if (!team) return <Blank title="Only owners can manage staff."/>;
  if (!team.ready) return <Blank title="Staff access is not switched on yet.">The staff table has not been added to the store database. Apply the 0019_staff_access migration, then refresh.</Blank>;
  return <>
    <h2>Team</h2>
    <p>Each person signs in at trybiomod.com/admin with their own email. After you add someone, they choose a password with &ldquo;Set or reset your admin password&rdquo;. Changes apply on their next click; removing someone ends their access immediately.</p>
    <form key={formKey} className="store-form" onChangeCapture={onDraft} onSubmit={onAdd}>
      <h3>Add a person</h3>
      <div className="form-row">
        <Field label="Email address" name="email" type="email"/>
        <Field label="Name" name="name" required={false}/>
        <Field label="Role" name="role"><select name="role" required defaultValue="support">{assignableRoles.map(role => <option key={role} value={role}>{roleDetails[role].label}</option>)}</select></Field>
      </div>
      <button className="button button-dark" disabled={busy}>Give access</button>
    </form>
    <h3>What each role can do</h3>
    <Table><TableHeader><TableRow><TableHead>Role</TableHead><TableHead>Access</TableHead></TableRow></TableHeader><TableBody>
      {(['owner', ...assignableRoles] as const).map(role => <TableRow key={role}><TableCell>{roleDetails[role].label}</TableCell><TableCell>{roleDetails[role].description}</TableCell></TableRow>)}
    </TableBody></Table>
    <h3>People with access</h3>
    <Table><TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>
      {team.owners.map(email => <TableRow key={'owner:' + email}><TableCell>{email}</TableCell><TableCell>Owner</TableCell><TableCell>Active</TableCell><TableCell>Set in Cloudflare</TableCell></TableRow>)}
      {team.staff.map(member => <TableRow key={member.email}>
        <TableCell>{member.email}{member.name ? ' · ' + member.name : ''}</TableCell>
        <TableCell><select aria-label={'Role for ' + member.email} value={member.role} disabled={busy || !member.active} onChange={e => onChange(member, { role: e.target.value as AssignableRole })}>{assignableRoles.map(role => <option key={role} value={role}>{roleDetails[role].label}</option>)}</select></TableCell>
        <TableCell>{member.active ? 'Active' : 'Removed'}</TableCell>
        <TableCell><button type="button" className="text-button" disabled={busy} onClick={() => onChange(member, { active: !member.active })}>{member.active ? 'Remove access' : 'Restore access'}</button></TableCell>
      </TableRow>)}
    </TableBody></Table>
    {team.audit.length > 0 && <details className="account-record"><summary style={{ cursor: 'pointer', padding: '12px 0', fontWeight: 600 }}>Access history</summary>
      {team.audit.map((entry, i) => <p key={i}>{new Date(entry.created).toLocaleString()} · {entry.actor} {entry.active ? 'set ' + entry.email + ' to ' + (roleDetails[entry.role as AssignableRole]?.label || entry.role) : 'removed ' + entry.email}</p>)}
    </details>}
  </>;
}
