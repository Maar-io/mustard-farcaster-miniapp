import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
app.use('*', cors())

// Use env vars for Docker support, fallback to localhost for local dev
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5174'
const PORT = Number(process.env.PORT || 3300)

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

// Webhook endpoint - receives miniapp_added events from host
app.post('/webhook', async (c) => {
  const body = await c.req.json() as {
    event?: string
    userAddress?: string
    notificationDetails?: { url: string; token: string }
  }

  console.log(`  [webhook] received event=${body.event}, userAddress=${body.userAddress}, body=${JSON.stringify(body).slice(0, 200)}`)

  if (body.event === 'miniapp_added' && body.notificationDetails && body.userAddress) {
    tokensByAddress.set(body.userAddress, body.notificationDetails)
    console.log(`  [webhook] stored token for address ${body.userAddress}: ${body.notificationDetails.token.slice(0, 16)}...`)
    console.log(`  [webhook] notification URL: ${body.notificationDetails.url}`)
    console.log(`  [webhook] total addresses stored: ${tokensByAddress.size}`)
  } else if (body.event === 'miniapp_removed' || body.event === 'notifications_disabled') {
    if (body.userAddress) {
      tokensByAddress.delete(body.userAddress)
      console.log(`  [webhook] removed token for address ${body.userAddress}`)
    }
  } else {
    console.log("  [webhook] ignoring event (not handled or missing fields)")
  }

  return c.json({ success: true })
})

// Mint endpoint - called by frontend after successful mint
app.post('/api/mint', async (c) => {
  const body = await c.req.json() as { userAddress?: string }
  console.log(`  [mint] received request, userAddress=${body.userAddress || 'MISSING'}`)

  if (!body.userAddress) {
    return c.json({ error: 'Missing userAddress' }, 400)
  }

  const details = tokensByAddress.get(body.userAddress)
  if (!details) {
    console.log(`  [mint] no notification token found for address ${body.userAddress}`)
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
    console.log("  [mint] sending immediate notification to", details.url)
    const result = await sendNotification(details.url, immediatePayload)
    console.log("  [mint] immediate notification sent:", result)
  } catch (e) {
    console.error("  [mint] failed to send immediate notification:", e)
  }

  // Schedule "mint again" notification for 60 seconds later
  const notificationId = `mustardready-${now}`
  const scheduledFor = now + 60_000

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
  console.log(`  [scheduler] notification "${notificationId}" scheduled for ${scheduledDate} (in 60s)`)
  console.log(`  [scheduler] queue size: ${scheduledNotifications.length}`)

  return c.json({ success: true, scheduledFor })
})

// Test notification endpoint - called by frontend to send a test notification
app.post('/api/test-notification', async (c) => {
  const body = await c.req.json() as { userAddress?: string }
  console.log(`  [test] received request, userAddress=${body.userAddress || "MISSING"}`)

  if (!body.userAddress) {
    return c.json({ error: 'Missing userAddress' }, 400)
  }

  const details = tokensByAddress.get(body.userAddress)
  if (!details) {
    console.log(`  [test] no notification token found for address ${body.userAddress}`)
    return c.json({ error: 'No notification registered for this address' }, 404)
  }

  try {
    const payload = {
      notificationId: `mustard-test-${Date.now()}`,
      title: 'Mustard',
      body: 'This is a test notification',
      targetUrl: FRONTEND_URL,
      tokens: [details.token],
    }
    console.log("  [test] sending test notification to", details.url)
    const result = await sendNotification(details.url, payload)
    console.log("  [test] notification sent:", result)
    return c.json({ success: true })
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : 'Failed to send notification'
    console.error("  [test] failed to send notification:", e)
    return c.json({ error: errorMessage }, 500)
  }
})

// Notification status endpoint - check if user has active notification registration
app.get('/api/notification-status', (c) => {
  const userAddress = c.req.query('userAddress')
  if (!userAddress) {
    return c.json({ error: 'Missing userAddress query param' }, 400)
  }
  const enabled = tokensByAddress.has(userAddress)
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
    console.log(`  [scheduler] ${due.length} notification(s) due, processing...`)
  }

  for (const item of due) {
    console.log(`  [scheduler] sending to ${item.url}`)
    console.log(`  [scheduler] payload: ${JSON.stringify(item.notification)}`)

    try {
      const result = await sendNotification(item.url, item.notification)
      console.log(`  [scheduler] SUCCESS sent notification: ${item.id}`)
      console.log(`  [scheduler] response: ${result}`)
    } catch (e) {
      console.error(`  [scheduler] FAILED to send notification:`, e)
    }

    // Remove from queue regardless of success/failure
    const index = scheduledNotifications.findIndex(n => n.id === item.id)
    if (index !== -1) {
      scheduledNotifications.splice(index, 1)
    }
    console.log(`  [scheduler] remaining queue size: ${scheduledNotifications.length}`)
  }
}, 1000)

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log('')
  console.log('  \x1b[33mmustardbackend\x1b[0m — Notification Scheduler')
  console.log('')
  console.log(`  Server:          http://localhost:${info.port}`)
  console.log(`  Webhook:         POST http://localhost:${info.port}/webhook`)
  console.log(`  Mint:            POST http://localhost:${info.port}/api/mint`)
  console.log(`  Test Notif:      POST http://localhost:${info.port}/api/test-notification`)
  console.log(`  Notif Status:    GET  http://localhost:${info.port}/api/notification-status?userAddress=0x...`)
  console.log(`  Health:          GET  http://localhost:${info.port}/health`)
  console.log('')
})
