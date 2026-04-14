import { type NextRequest, NextResponse } from 'next/server';
import { tokensByAddress } from '@/lib/token-store';

export async function GET(req: NextRequest) {
  const userAddress = req.nextUrl.searchParams.get('userAddress');
  if (!userAddress) {
    return NextResponse.json({ error: 'Missing userAddress query param' }, { status: 400 });
  }
  const enabled = tokensByAddress.has(userAddress);
  return NextResponse.json({ enabled });
}
