import { NextResponse } from 'next/server';
import { tokensByAddress } from '@/lib/token-store';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    addresses: tokensByAddress.size,
    note: 'in-memory store — resets on cold start',
  });
}
