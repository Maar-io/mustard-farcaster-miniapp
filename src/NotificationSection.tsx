import { sdk } from "@farcaster/miniapp-sdk";
import { useCallback, useEffect, useState } from "react";

type EventEntry = { event: string; detail: string; timestamp: string };

interface NotificationSectionProps {
  appName: string;
  accentColor: string;
  backendUrl: string;
  userAddress: string;
}

export function NotificationSection({ appName, accentColor, backendUrl, userAddress }: NotificationSectionProps) {
  const [status, setStatus] = useState<'idle' | 'enabling' | 'enabled' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<EventEntry[]>([]);
  const prefix = appName.toLowerCase();
  const logPrefix = `[MUSTARD][${prefix}]`;

  const tokenPreview = (token: string) => token.slice(0, 8);

  const logEvent = useCallback((event: string, detail: string = '') => {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    setEventLog((prev) => [{ event, detail, timestamp }, ...prev.slice(0, 9)]);
  }, []);

  const registerNotificationDetails = useCallback(
    async (notificationDetails: { url: string; token: string }) => {
      console.log(`${logPrefix} registerNotificationDetails -> POST /webhook`, {
        userAddress,
        backendUrl,
        sendUrl: notificationDetails.url,
        tokenPreview: tokenPreview(notificationDetails.token),
      });
      const res = await fetch(`${backendUrl}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'miniapp_added',
          userAddress,
          notificationDetails,
        }),
      });

      console.log(`${logPrefix} registerNotificationDetails <- response`, {
        status: res.status,
        ok: res.ok,
        userAddress,
      });

      if (!res.ok) {
        throw new Error(`Webhook registration failed: HTTP ${res.status}`);
      }
    },
    [backendUrl, logPrefix, userAddress],
  );

  const checkNotificationStatus = useCallback(async () => {
    if (!userAddress) return false;

    console.log(`${logPrefix} checkNotificationStatus -> request`, {
      userAddress,
      backendUrl,
    });
    const res = await fetch(`${backendUrl}/api/notification-status?userAddress=${userAddress}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = (await res.json()) as { enabled?: boolean };
    console.log(`${logPrefix} checkNotificationStatus <- response`, {
      userAddress,
      enabled: Boolean(data.enabled),
    });
    return Boolean(data.enabled);
  }, [backendUrl, logPrefix, userAddress]);

  // Check if notifications are enabled for this user on mount
  useEffect(() => {
    if (!userAddress) return;
    checkNotificationStatus()
      .then((enabled) => {
        if (enabled) {
          setStatus('enabled');
        }
      })
      .catch((e) => {
        console.error(`${logPrefix} Failed to check notification status:`, e);
      });
  }, [checkNotificationStatus, logPrefix, userAddress]);

  useEffect(() => {
    const onAdded = (event: { notificationDetails?: { url: string; token: string } }) => {
      logEvent(
        'miniAppAdded',
        event.notificationDetails
          ? `token=${tokenPreview(event.notificationDetails.token)}... url=${event.notificationDetails.url}`
          : 'no notification details',
      );
      setStatus('enabled');
    };

    const onAddRejected = (event: { reason?: string }) => {
      logEvent('miniAppAddRejected', event.reason ? String(event.reason) : 'rejected');
    };

    const onRemoved = () => {
      logEvent('miniAppRemoved');
      setStatus('idle');
    };

    const onNotificationsEnabled = (event: { notificationDetails: { token: string } }) => {
      logEvent('notificationsEnabled', `token=${tokenPreview(event.notificationDetails.token)}...`);
      setStatus('enabled');
    };

    const onNotificationsDisabled = () => {
      logEvent('notificationsDisabled');
      setStatus('idle');
    };

    sdk.on('miniAppAdded', onAdded);
    sdk.on('miniAppAddRejected', onAddRejected);
    sdk.on('miniAppRemoved', onRemoved);
    sdk.on('notificationsEnabled', onNotificationsEnabled);
    sdk.on('notificationsDisabled', onNotificationsDisabled);

    return () => {
      sdk.removeListener('miniAppAdded', onAdded);
      sdk.removeListener('miniAppAddRejected', onAddRejected);
      sdk.removeListener('miniAppRemoved', onRemoved);
      sdk.removeListener('notificationsEnabled', onNotificationsEnabled);
      sdk.removeListener('notificationsDisabled', onNotificationsDisabled);
    };
  }, [logEvent]);

  const handleEnable = useCallback(async () => {
    setStatus('enabling');
    setError(null);
    try {
      console.log(`${logPrefix} handleEnable start`, { userAddress, backendUrl });
      const result = await sdk.actions.addMiniApp();
      console.log(`${logPrefix} handleEnable addMiniApp result`, {
        userAddress,
        hasNotificationDetails: Boolean(result.notificationDetails),
        sendUrl: result.notificationDetails?.url,
        tokenPreview: result.notificationDetails?.token ? tokenPreview(result.notificationDetails.token) : undefined,
      });

      if (result.notificationDetails) {
        await registerNotificationDetails(result.notificationDetails);
      } else {
        console.log(`${logPrefix} handleEnable addMiniApp returned no notificationDetails`, {
          userAddress,
        });
      }

      let enabled = false;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        console.log(`${logPrefix} handleEnable poll attempt`, {
          attempt: attempt + 1,
          userAddress,
        });
        enabled = await checkNotificationStatus();
        if (enabled) break;
        await new Promise((resolve) => window.setTimeout(resolve, 300));
      }

      if (!enabled) {
        console.log(`${logPrefix} handleEnable timed out waiting for registration`, {
          userAddress,
        });
        throw new Error('Notification registration did not complete yet');
      }

      console.log(`${logPrefix} handleEnable success`, { userAddress });
      setStatus('enabled');
    } catch (e) {
      console.error(`${logPrefix} Error in handleEnable:`, e);
      setError(e instanceof Error ? e.message : 'Failed to enable notifications');
      setStatus('error');
    }
  }, [backendUrl, checkNotificationStatus, logPrefix, registerNotificationDetails, userAddress]);

  const handleSend = useCallback(async () => {
    if (!userAddress) return;
    setStatus('sending');
    setError(null);
    try {
      console.log(`${logPrefix} handleSend -> request`, { userAddress, backendUrl });
      const res = await fetch(`${backendUrl}/api/test-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress }),
      });
      console.log(`${logPrefix} handleSend <- response`, {
        status: res.status,
        ok: res.ok,
        userAddress,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Unable to read response' })) as { error?: string };
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }
      setStatus('sent');
      setTimeout(() => setStatus('enabled'), 2000);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to send notification';
      console.error(`${logPrefix} Failed to send test notification:`, errorMessage);
      setError(`${errorMessage}. Check console for details.`);
      setStatus('error');
    }
  }, [backendUrl, logPrefix, userAddress]);

  return (
    <div>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Host Events</div>
        <div
          style={{
            backgroundColor: '#f3f4f6',
            borderRadius: '8px',
            padding: '12px',
            fontSize: '12px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          }}
        >
          {eventLog.length > 0 ? (
            <div style={{ display: 'grid', gap: '8px' }}>
              {eventLog.map((entry, index) => (
                <div key={`${entry.timestamp}-${entry.event}-${index}`}>
                  <div style={{ color: '#6b7280' }}>{entry.timestamp}</div>
                  <div>{entry.event}</div>
                  {entry.detail ? <div style={{ color: '#4b5563', wordBreak: 'break-word' }}>{entry.detail}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#6b7280' }}>No host events received yet.</div>
          )}
        </div>
      </div>
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
