import type { NextRequest } from 'next/server';
import type { session, customer, requireStaff } from '@/lib/auth';
import type { runtime } from '@/lib/runtime';
import type { auditRun, AuditActor } from '@/lib/change-history';

export type StoreGetContext = { req: NextRequest; action: string; u: Awaited<ReturnType<typeof customer>> };
export type StorePostContext = { req: NextRequest; action: string; b: Record<string, any>; secure: boolean; s: Awaited<ReturnType<typeof session>> };
export type AdminPostContext = StorePostContext & { actor: Awaited<ReturnType<typeof requireStaff>>; auditActor: AuditActor; auditEnv: () => ReturnType<typeof runtime>; run: (sql: string, ...values: (string | number | null)[]) => ReturnType<typeof auditRun> };
