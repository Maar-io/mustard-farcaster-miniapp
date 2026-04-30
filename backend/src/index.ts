import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

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
  const response = await fetch(notifUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const responseBody = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${responseBody}`)
  }
  return responseBody
}

// Webhook endpoint - receives miniapp lifecycle events from host
app.post('/webhook', async (c) => {
  const body = await c.req.json() as {
    event?: string
    userAddress?: string
    notificationDetails?: { url: string; token: string }
  }
  const normalizedUserAddress = body.userAddress ? normalizeUserAddress(body.userAddress) : undefined

  console.log(`${LOG_PREFIX} [webhook] received event=${body.event}, userAddress=${body.userAddress}, body=${JSON.stringify(body).slice(0, 200)}`)

  if ((body.event === 'miniapp_added' || body.event === 'notifications_enabled') && body.notificationDetails && normalizedUserAddress) {
    tokensByAddress.set(normalizedUserAddress, body.notificationDetails)
    console.log(`${LOG_PREFIX} [webhook] stored token for address ${normalizedUserAddress}: ${tokenPreview(body.notificationDetails.token)}...`)
    console.log(`${LOG_PREFIX} [webhook] notification URL: ${body.notificationDetails.url}`)
    console.log(`${LOG_PREFIX} [webhook] total addresses stored: ${tokensByAddress.size}`)
    logTokenStore(`after ${body.event}`)
  } else if (body.event === 'miniapp_removed' || body.event === 'notifications_disabled') {
    if (normalizedUserAddress) {
      tokensByAddress.delete(normalizedUserAddress)
      console.log(`${LOG_PREFIX} [webhook] removed token for address ${normalizedUserAddress}`)
      logTokenStore(`after ${body.event}`)
    }
  } else {
    console.log(`${LOG_PREFIX} [webhook] ignoring event (not handled or missing fields)`)
    logTokenStore('after ignored webhook event')
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
    console.log(`${LOG_PREFIX} [test] sending test notification to`, details.url)
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
