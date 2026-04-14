import { sdk } from "@farcaster/miniapp-sdk";
import { useCallback, useEffect, useState } from "react";

interface NotificationSectionProps {
  appName: string;
  accentColor: string;
  backendUrl: string;
  userAddress: string;
}

export function NotificationSection({ appName, accentColor, backendUrl, userAddress }: NotificationSectionProps) {
  const [status, setStatus] = useState<'idle' | 'enabling' | 'enabled' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const prefix = appName.toLowerCase();

  // Check if notifications are enabled for this user on mount
  useEffect(() => {
    if (!userAddress) return;
    fetch(`${backendUrl}/api/notification-status?userAddress=${userAddress}`)
      .then((res) => res.json())
      .then((data: { enabled?: boolean }) => {
        if (data.enabled) {
          setStatus('enabled');
        }
      })
      .catch((e) => {
        console.error(`[${prefix}] Failed to check notification status:`, e);
      });
  }, [backendUrl, userAddress, prefix]);

  const handleEnable = useCallback(async () => {
    setStatus('enabling');
    setError(null);
    try {
      await sdk.actions.addMiniApp();
      // Token is delivered to backend via webhook from the host.
      // We optimistically set enabled since the webhook fires before this resolves.
      setStatus('enabled');
    } catch (e) {
      console.error(`[${prefix}] Error in handleEnable:`, e);
      setError(e instanceof Error ? e.message : 'Failed to enable notifications');
      setStatus('error');
    }
  }, [prefix]);

  const handleSend = useCallback(async () => {
    if (!userAddress) return;
    setStatus('sending');
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/api/test-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Unable to read response' })) as { error?: string };
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }
      setStatus('sent');
      setTimeout(() => setStatus('enabled'), 2000);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to send notification';
      console.error(`[${prefix}] Failed to send test notification:`, errorMessage);
      setError(`${errorMessage}. Check console for details.`);
      setStatus('error');
    }
  }, [backendUrl, userAddress, prefix]);

  const handleDisable = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

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
