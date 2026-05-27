import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { NS_WEBHOOK_EVENTS, decodeUserAddress, parseWebhookPayload, verifyWebhookSignature } from './ns-webhook.js'

const app = new Hono()
app.use('*', cors())

// Use env vars for Docker support, fallback to localhost for local dev
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5174'
const PORT = Number(process.env.PORT || 3300)
const LOG_PREFIX = '[MUSTARD]'

// Notification details indexed by userAddress (received via webhook from host)
const tokensByAddress = new Map<string, { url: string; token: string }>()

// Scheduled notifications queue
const scheduledNotifications: Array<{
  id: string
  scheduledFor: number
  url: string
  notification: {
    notificationId: string
    title: string
    body: string
    targetUrl: string
    tokens: string[]
  }
}> = []

const testNotificationBodies = [
  'Chris just minted a banana',
  'Marc wanted to mute me',
  'J did not review this',
  'Alan wants to move to Bali',
  'Ayumi does not like my design',
  'Saša did not like new Remarkable',
  'Brett is going to the gym',
]

let nextTestNotificationBodyIndex = 0

const tokenPreview = (token: string) => token.slice(0, 8)

const normalizeUserAddress = (userAddress: string) => userAddress.toLowerCase()

const logTokenStore = (label: string) => {
  const entries = Array.from(tokensByAddress.entries()).map(([address, details]) => ({
    address,
    url: details.url,
    tokenPreview: tokenPreview(details.token),
  }))
  console.log(`${LOG_PREFIX} [store] ${label}: count=${entries.length}`, entries)
}

// Helper: send a notification to the stored notification URL
async function sendNotification(
  notifUrl: string,
  payload: { notificationId: string; title: string; body: string; targetUrl: string; tokens: string[] },
) {
  const startedAt = Date.now()
  const response = await fetch(notifUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const elapsedMs = Date.now() - startedAt
  const responseBody = await response.text()

  // NS returns a JSON envelope: { successfulTokens, invalidTokens, rateLimitedTokens }.
  // Parse defensively so callers see *which bucket* each input token landed in
  // (a 200 with all tokens in `invalidTokens` is not a real delivery).
  let parsed: unknown
  try {
    parsed = JSON.parse(responseBody)
  } catch {
    parsed = undefined
  }
  const envelope =
    parsed && typeof parsed === 'object'
      ? (parsed as {
          successfulTokens?: string[]
          invalidTokens?: string[]
          rateLimitedTokens?: string[]
        })
      : {}
  const summary = {
    status: response.status,
    elapsedMs,
    notificationId: payload.notificationId,
    requestedTokens: payload.tokens.length,
    successful: envelope.successfulTokens?.length ?? 0,
    invalid: envelope.invalidTokens?.length ?? 0,
    rateLimited: envelope.rateLimitedTokens?.length ?? 0,
    rawBody: parsed ? undefined : responseBody.slice(0, 200),
  }
  console.log(`${LOG_PREFIX} [send] NS response`, summary)

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${responseBody}`)
  }
  return responseBody
}

// NS may send the notification URL without a scheme (e.g. "ns.example/notification").
// `fetch` requires an absolute URL; default to https for any scheme-less value.
const ensureHttps = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`)

// Webhook endpoint - receives lifecycle events from the Notification Server (NS).
// See backend/NS_WEBHOOK.md for the contract.
app.post('/webhook', async (c) => {
  const rawBody = await c.req.text()
  console.log(`${LOG_PREFIX} [webhook] ===== incoming request =====`)
  console.log(`${LOG_PREFIX} [webhook] method=${c.req.method} url=${c.req.url}`)
  console.log(`${LOG_PREFIX} [webhook] headers=${JSON.stringify(Object.fromEntries(c.req.raw.headers.entries()))}`)
  console.log(`${LOG_PREFIX} [webhook] raw body=${rawBody}`)

  try {
    await verifyWebhookSignature(rawBody, c.req.header('x-webhook-signature'))
  } catch (err) {
    console.error(`${LOG_PREFIX} [webhook] signature verification failed:`, err)
    return c.json({ success: false, error: 'invalid signature' }, 401)
  }

  let payload: ReturnType<typeof parseWebhookPayload>
  try {
    payload = parseWebhookPayload(rawBody)
  } catch (err) {
    console.error(`${LOG_PREFIX} [webhook] failed to parse NS payload:`, err)
    return c.json({ success: false, error: 'invalid payload' }, 400)
  }

  let userAddress: string
  try {
    userAddress = await decodeUserAddress(c.req.header('x-user-address'))
  } catch (err) {
    console.error(`${LOG_PREFIX} [webhook] failed to decode x-user-address:`, err)
    return c.json({ success: false, error: 'invalid x-user-address' }, 400)
  }

  switch (payload.event) {
    case NS_WEBHOOK_EVENTS.MINIAPP_ADDED:
    case NS_WEBHOOK_EVENTS.NOTIFICATIONS_ENABLED: {
      const url = ensureHttps(payload.notificationDetails.url)
      tokensByAddress.set(userAddress, { url, token: payload.notificationDetails.token })
      console.log(
        `${LOG_PREFIX} [webhook] ${payload.event} userAddress=${userAddress} url=${url} token=${tokenPreview(payload.notificationDetails.token)}...`,
      )
      logTokenStore(`after ${payload.event}`)
      break
    }
    case NS_WEBHOOK_EVENTS.MINIAPP_REMOVED:
    case NS_WEBHOOK_EVENTS.NOTIFICATIONS_DISABLED:
      tokensByAddress.delete(userAddress)
      console.log(`${LOG_PREFIX} [webhook] ${payload.event} userAddress=${userAddress}`)
      logTokenStore(`after ${payload.event}`)
      break
  }

  return c.json({ success: true })
})

// Mint endpoint - called by frontend after successful mint
app.post('/api/mint', async (c) => {
  const body = await c.req.json() as { userAddress?: string }
  const normalizedUserAddress = body.userAddress ? normalizeUserAddress(body.userAddress) : undefined
  console.log(`${LOG_PREFIX} [mint] received request, userAddress=${body.userAddress || 'MISSING'}`)

  if (!normalizedUserAddress) {
    return c.json({ error: 'Missing userAddress' }, 400)
  }

  const details = tokensByAddress.get(normalizedUserAddress)
  if (!details) {
    console.log(`${LOG_PREFIX} [mint] no notification token found for address ${normalizedUserAddress}`)
    return c.json({ error: 'No notification registered for this address' }, 404)
  }

  const now = Date.now()

  // Immediate notification: NFT minted
  try {
    const immediatePayload = {
      notificationId: `mustard-minted-${now}`,
      title: 'Mustard',
      body: 'New Mustard NFT was minted!',
      targetUrl: FRONTEND_URL,
      tokens: [details.token],
    }
    console.log(`${LOG_PREFIX} [mint] sending immediate notification to`, details.url)
    const result = await sendNotification(details.url, immediatePayload)
    console.log(`${LOG_PREFIX} [mint] immediate notification sent:`, result)
  } catch (e) {
    console.error(`${LOG_PREFIX} [mint] failed to send immediate notification:`, e)
  }

  // Schedule "mint again" notification for 60 seconds later
  const notificationId = `mustardready-${now}`
  const scheduledFor = now + 20_000

  scheduledNotifications.push({
    id: notificationId,
    scheduledFor,
    url: details.url,
    notification: {
      notificationId,
      title: 'Mustard',
      body: 'You can mint NFT again!',
      targetUrl: FRONTEND_URL,
      tokens: [details.token],
    },
  })

  const scheduledDate = new Date(scheduledFor).toLocaleTimeString()
  console.log(`${LOG_PREFIX} [scheduler] notification "${notificationId}" scheduled for ${scheduledDate} (in 60s)`)
  console.log(`${LOG_PREFIX} [scheduler] queue size: ${scheduledNotifications.length}`)

  return c.json({ success: true, scheduledFor })
})

// Test notification endpoint - called by frontend to send a test notification
// using the token stored via /webhook for this user.
app.post('/api/test-notification', async (c) => {
  const body = await c.req.json() as { userAddress?: string }
  const normalizedUserAddress = body.userAddress ? normalizeUserAddress(body.userAddress) : undefined
  console.log(`${LOG_PREFIX} [test] received request, userAddress=${body.userAddress || "MISSING"}`)

  if (!normalizedUserAddress) {
    return c.json({ error: 'Missing userAddress' }, 400)
  }

  const details = tokensByAddress.get(normalizedUserAddress)
  if (!details) {
    console.log(`${LOG_PREFIX} [test] no notification token found for address ${normalizedUserAddress}`)
    return c.json({ error: 'No notification registered for this address' }, 404)
  }

  try {
    const notificationBody = testNotificationBodies[nextTestNotificationBodyIndex]
    nextTestNotificationBodyIndex = (nextTestNotificationBodyIndex + 1) % testNotificationBodies.length

    const payload = {
      notificationId: `mustard-test-${Date.now()}`,
      title: 'Mustard',
      body: notificationBody,
      targetUrl: FRONTEND_URL,
      tokens: [details.token],
    }
    console.log(`${LOG_PREFIX} [test] sending test notification to ${details.url}`)
    const result = await sendNotification(details.url, payload)
    console.log(`${LOG_PREFIX} [test] notification sent:`, result)
    return c.json({ success: true })
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : 'Failed to send notification'
    console.error(`${LOG_PREFIX} [test] failed to send notification:`, e)
    return c.json({ error: errorMessage }, 500)
  }
})

// Notification status endpoint - check if user has active notification registration
app.get('/api/notification-status', (c) => {
  const userAddress = c.req.query('userAddress')
  const normalizedUserAddress = userAddress ? normalizeUserAddress(userAddress) : undefined
  if (!normalizedUserAddress) {
    return c.json({ error: 'Missing userAddress query param' }, 400)
  }
  const enabled = tokensByAddress.has(normalizedUserAddress)
  console.log(`${LOG_PREFIX} [status] userAddress=${normalizedUserAddress}, enabled=${enabled}`)
  if (enabled) {
    const details = tokensByAddress.get(normalizedUserAddress)
    if (details) {
      console.log(`${LOG_PREFIX} [status] token preview for ${normalizedUserAddress}: ${tokenPreview(details.token)}...`)
      console.log(`${LOG_PREFIX} [status] notification URL for ${normalizedUserAddress}: ${details.url}`)
    }
  } else {
    logTokenStore('status lookup miss')
  }
  return c.json({ enabled })
})

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    addresses: tokensByAddress.size,
    pending: scheduledNotifications.length,
  })
})

// Scheduler - checks every second for due notifications
setInterval(async () => {
  const now = Date.now()
  const due = scheduledNotifications.filter(n => n.scheduledFor <= now)

  if (due.length > 0) {
    console.log(`${LOG_PREFIX} [scheduler] ${due.length} notification(s) due, processing...`)
  }

  for (const item of due) {
    console.log(`${LOG_PREFIX} [scheduler] sending to ${item.url}`)
    console.log(`${LOG_PREFIX} [scheduler] payload: ${JSON.stringify(item.notification)}`)

    try {
      const result = await sendNotification(item.url, item.notification)
      console.log(`${LOG_PREFIX} [scheduler] SUCCESS sent notification: ${item.id}`)
      console.log(`${LOG_PREFIX} [scheduler] response: ${result}`)
    } catch (e) {
      console.error(`${LOG_PREFIX} [scheduler] FAILED to send notification:`, e)
    }

    // Remove from queue regardless of success/failure
    const index = scheduledNotifications.findIndex(n => n.id === item.id)
    if (index !== -1) {
      scheduledNotifications.splice(index, 1)
    }
    console.log(`${LOG_PREFIX} [scheduler] remaining queue size: ${scheduledNotifications.length}`)
  }
}, 1000)

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(LOG_PREFIX)
  console.log(`${LOG_PREFIX} \x1b[33mmustardbackend\x1b[0m — Notification Scheduler`)
  console.log(LOG_PREFIX)
  console.log(`${LOG_PREFIX} Server:          http://localhost:${info.port}`)
  console.log(`${LOG_PREFIX} Webhook:         POST http://localhost:${info.port}/webhook`)
  console.log(`${LOG_PREFIX} Mint:            POST http://localhost:${info.port}/api/mint`)
  console.log(`${LOG_PREFIX} Test Notif:      POST http://localhost:${info.port}/api/test-notification`)
  console.log(`${LOG_PREFIX} Notif Status:    GET  http://localhost:${info.port}/api/notification-status?userAddress=0x...`)
  console.log(`${LOG_PREFIX} Health:          GET  http://localhost:${info.port}/health`)
  console.log(LOG_PREFIX)
})
