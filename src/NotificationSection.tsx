import { sdk } from "@farcaster/miniapp-sdk";
import { useCallback, useEffect, useRef, useState } from "react";

interface NotificationSectionProps {
  appName: string;
  storageKey: string;
  accentColor: string;
}

export function NotificationSection({ appName, storageKey, accentColor }: NotificationSectionProps) {
  const [status, setStatus] = useState<'idle' | 'enabling' | 'enabled' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const notifDetailsRef = useRef<{ url: string; token: string } | null>(null);
  const prefix = appName.toLowerCase();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const details = JSON.parse(saved) as { url: string; token: string };
        notifDetailsRef.current = details;
        setStatus('enabled');
      }
    } catch (e) {
      console.error('Failed to load notification details:', e);
    }
  }, [storageKey]);

  const handleEnable = useCallback(async () => {
    setStatus('enabling');
    setError(null);
    try {
      const result = await sdk.actions.addMiniApp();
      const details = (result as { notificationDetails?: { url: string; token: string } })?.notificationDetails;
      if (details) {
        notifDetailsRef.current = details;
        localStorage.setItem(storageKey, JSON.stringify(details));
        setStatus('enabled');
      } else {
        setError('No notification details returned');
        setStatus('error');
      }
    } catch (e) {
      console.error(`[${prefix}] Error in handleEnable:`, e);
      setError(e instanceof Error ? e.message : 'Failed to enable notifications');
      setStatus('error');
    }
  }, [storageKey, prefix]);

  const handleSend = useCallback(async () => {
    const details = notifDetailsRef.current;
    if (!details) return;
    setStatus('sending');
    setError(null);
    try {
      console.log(`[${prefix}] Sending notification:`, {
        url: details.url,
        token: details.token,
        currentOrigin: window.location.origin,
      });
      const res = await fetch(details.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notificationId: `${prefix}-${Date.now()}`,
          title: appName,
          body: 'This is a test notification',
          targetUrl: window.location.href,
          tokens: [details.token],
        }),
      });
      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unable to read response');
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      setStatus('sent');
      setTimeout(() => setStatus('enabled'), 2000);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to send notification';
      console.error(`[${prefix}] Failed to send test notification:`, {
        error: errorMessage,
        url: details.url,
        token: details.token,
        currentOrigin: window.location.origin,
      });
      setError(`${errorMessage}. Check console for details.`);
      setStatus('error');
    }
  }, [appName, prefix]);

  const handleDisable = useCallback(() => {
    notifDetailsRef.current = null;
    localStorage.removeItem(storageKey);
    setStatus('idle');
    setError(null);
  }, [storageKey]);

  return (
    <div>
      {status === 'idle' || status === 'error' ? (
        <button
          type="button"
          onClick={handleEnable}
          style={{
            padding: '8px 16px',
            backgroundColor: accentColor,
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Enable Notifications
        </button>
      ) : status === 'enabling' ? (
        <button type="button" disabled style={{ padding: '8px 16px', fontSize: '14px' }}>
          Enabling...
        </button>
      ) : (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleSend}
            disabled={status === 'sending'}
            style={{
              padding: '8px 16px',
              backgroundColor: status === 'sent' ? '#16a34a' : accentColor,
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            {status === 'sending' ? 'Sending...' : status === 'sent' ? 'Sent!' : 'Test Notification'}
          </button>
          <button
            type="button"
            onClick={handleDisable}
            style={{
              padding: '8px 16px',
              backgroundColor: '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Disable
          </button>
        </div>
      )}
      {error && (
        <div style={{ color: 'red', fontSize: '12px', marginTop: '8px' }}>
          {error}
        </div>
      )}
    </div>
  );
}
