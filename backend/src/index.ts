import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { NS_SEND_NOTIFICATION_URL, NS_WEBHOOK_EVENTS, decodeUserAddress, parseWebhookPayload, verifyWebhookSignature } from './ns-webhook.js'

const app = new Hono()
app.use('*', cors())

// Use env vars for Docker support, fallback to localhost for local dev
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5174'
const PORT = Number(process.env.PORT || 3300)
const LOG_PREFIX = '[MUSTARD]'

// Push token indexed by userAddress (received via NS webhook).
// NS sends a notificationDetails.url but it's malformed; we always POST to
// NS_SEND_NOTIFICATION_URL derived from NS_BASE_URL, so only the token matters.
const tokensByAddress = new Map<string, string>()

// Scheduled notifications queue
const scheduledNotifications: Array<{
  id: string
  scheduledFor: number
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

// Last 8 chars — NS tokens share a common prefix (ntf_<ULID>.sk_live_...),
// so the trailing chars are what actually distinguish one token from another.
const tokenPreview = (token: string) => `...${token.slice(-8)}`

const normalizeUserAddress = (userAddress: string) => userAddress.toLowerCase()

const logTokenStore = (label: string) => {
  const entries = Array.from(tokensByAddress.entries()).map(([address, token]) => ({
    address,
    tokenPreview: tokenPreview(token),
  }))
  console.log(`${LOG_PREFIX} [store] ${label}: count=${entries.length}`, entries)
}

// Helper: send a notification via the NS send-notification endpoint.
async function sendNotification(
  payload: { notificationId: string; title: string; body: string; targetUrl: string; tokens: string[] },
) {
  console.log(`${LOG_PREFIX} [send] outgoing payload`, {
    notificationId: payload.notificationId,
    title: payload.title,
    body: payload.body,
    targetUrl: payload.targetUrl,
    tokensCount: payload.tokens.length,
    tokensPreview: payload.tokens.map(tokenPreview),
  })

  const startedAt = Date.now()
  const response = await fetch(NS_SEND_NOTIFICATION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const elapsedMs = Date.now() - startedAt
  const responseBody = await response.text()

  console.log(`${LOG_PREFIX} [send] NS response`, {
    status: response.status,
    elapsedMs,
    notificationId: payload.notificationId,
    body: responseBody,
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${responseBody}`)
  }
  return responseBody
}

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
      const { token } = payload.notificationDetails
      tokensByAddress.set(userAddress, token)
      console.log(
        `${LOG_PREFIX} [webhook] ${payload.event} userAddress=${userAddress} token=${tokenPreview(token)}`,
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

  const token = tokensByAddress.get(normalizedUserAddress)
  if (!token) {
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
      tokens: [token],
    }
    console.log(`${LOG_PREFIX} [mint] sending immediate notification to ${NS_SEND_NOTIFICATION_URL}`)
    const result = await sendNotification(immediatePayload)
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
    notification: {
      notificationId,
      title: 'Mustard',
      body: 'You can mint NFT again!',
      targetUrl: FRONTEND_URL,
      tokens: [token],
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

  const token = tokensByAddress.get(normalizedUserAddress)
  if (!token) {
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
      tokens: [token],
    }
    console.log(`${LOG_PREFIX} [test] sending test notification to ${NS_SEND_NOTIFICATION_URL}`)
    const result = await sendNotification(payload)
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
  const token = tokensByAddress.get(normalizedUserAddress)
  const enabled = token !== undefined
  console.log(`${LOG_PREFIX} [status] userAddress=${normalizedUserAddress}, enabled=${enabled}`)
  if (token) {
    console.log(`${LOG_PREFIX} [status] token preview for ${normalizedUserAddress}: ${tokenPreview(token)}`)
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
    console.log(`${LOG_PREFIX} [scheduler] sending to ${NS_SEND_NOTIFICATION_URL}`)
    console.log(`${LOG_PREFIX} [scheduler] payload: ${JSON.stringify(item.notification)}`)

    try {
      const result = await sendNotification(item.notification)
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
