import { NextResponse } from 'next/server';
import { z } from 'zod';

export const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export const str = (v: unknown, max = 2000) => z.string().trim().min(1).max(max).parse(v);
