export async function sendNotification(
  url: string,
  payload: {
    notificationId: string;
    title: string;
    body: string;
    targetUrl: string;
    tokens: string[];
  },
) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.text();
}
