import { env } from 'cloudflare:workers';
export type BindingEnv = Record<string, string | undefined> & {
    DB: D1Database;
};
export const runtime = () => env as unknown as BindingEnv;
export const database = () => { const db = runtime().DB; if (!db)
    throw new Error('Store storage is temporarily unavailable.'); return db; };
export async function one<T = Record<string, unknown>>(sql: string, ...values: (string | number | null)[]) { return database().prepare(sql).bind(...values).first<T>(); }
export async function all<T = Record<string, unknown>>(sql: string, ...values: (string | number | null)[]) { return (await database().prepare(sql).bind(...values).all<T>()).results; }
export async function run(sql: string, ...values: (string | number | null)[]) { return database().prepare(sql).bind(...values).run(); }
export const timestamp = () => Date.now();
export const uid = () => crypto.randomUUID();
export function parse<T>(value: string | null | undefined, fallback: T): T { try {
    return value ? JSON.parse(value) : fallback;
}
catch {
    return fallback;
} }
export async function setting<T>(key: string, fallback: T): Promise<T> { const v = await one<{
    value: string;
}>('SELECT value FROM settings WHERE key=?', key); return parse(v?.value, fallback); }
