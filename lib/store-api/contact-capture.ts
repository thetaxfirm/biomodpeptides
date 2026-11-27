import { recordContact } from '@/lib/contacts';
import { shareContact } from '@/lib/crm-capture';
import { runtime } from '@/lib/runtime';

export async function captureContact(input: Parameters<typeof recordContact>[1]) { try { await recordContact(runtime().DB, input); } catch { /* ignore */ } await shareContact(input); }
