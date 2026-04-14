import { type NextRequest, NextResponse } from 'next/server';
import { tokensByAddress } from '@/lib/token-store';

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    event?: string;
    userAddress?: string;
    notificationDetails?: { url: string; token: string };
  };

  console.log(`[webhook] event=${body.event}, userAddress=${body.userAddress}`);

  if (body.event === 'miniapp_added' && body.notificationDetails && body.userAddress) {
    tokensByAddress.set(body.userAddress, body.notificationDetails);
    console.log(`[webhook] stored token for ${body.userAddress}`);
  } else if (
    (body.event === 'miniapp_removed' || body.event === 'notifications_disabled') &&
    body.userAddress
  ) {
    tokensByAddress.delete(body.userAddress);
    console.log(`[webhook] removed token for ${body.userAddress}`);
  }

  return NextResponse.json({ success: true });
}
