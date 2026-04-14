import { type NextRequest, NextResponse } from 'next/server';
import { tokensByAddress } from '@/lib/token-store';

async function sendNotification(
  url: string,
  payload: { notificationId: string; title: string; body: string; targetUrl: string; tokens: string[] },
) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.text();
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { userAddress?: string };

  if (!body.userAddress) {
    return NextResponse.json({ error: 'Missing userAddress' }, { status: 400 });
  }

  const details = tokensByAddress.get(body.userAddress);
  if (!details) {
    return NextResponse.json({ error: 'No notification registered for this address' }, { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:5174';

  try {
    await sendNotification(details.url, {
      notificationId: `mustard-test-${Date.now()}`,
      title: 'Mustard',
      body: 'This is a test notification',
      targetUrl: appUrl,
      tokens: [details.token],
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to send notification';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
