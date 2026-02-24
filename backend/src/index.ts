import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
app.use('*', cors())

// Use env vars for Docker support, fallback to localhost for local dev
const FARCASTER_HOST_URL = process.env.FARCASTER_HOST_URL || 'http://localhost:3200'
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5174'
const PORT = Number(process.env.PORT || 3300)

// In-memory storage for notification tokens
const notificationTokens = new Map<string, { url: string; token: string }>()

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

// Webhook endpoint - receives miniapp_added events from sandbox (via host notify server)
app.post('/webhook', async (c) => {
  const body = await c.req.json() as {
    event?: string
    notificationDetails?: { url: string; token: string }
  }

  console.log(`  [webhook] received event=${body.event}, body=${JSON.stringify(body).slice(0, 200)}`)

  if (body.event === 'miniapp_added' && body.notificationDetails) {
    notificationTokens.set(body.notificationDetails.token, body.notificationDetails)
    console.log(`  [webhook] stored token: ${body.notificationDetails.token.slice(0, 16)}...`)
    console.log(`  [webhook] total tokens stored: ${notificationTokens.size}`)
  } else {
    console.log(`  [webhook] ignoring event (not miniapp_added or no notificationDetails)`)
  }

  return c.json({ success: true })
})

// Mint endpoint - called by frontend after successful mint
app.post('/api/mint', async (c) => {
  const body = await c.req.json() as { token?: string }
  console.log(`  [mint] received request, token=${body.token ? body.token.slice(0, 16) + '...' : 'MISSING'}`)

  if (!body.token) {
    console.log(`  [mint] ERROR: no token provided`)
    return c.json({ error: 'Missing token' }, 400)
  }

  // Schedule notification for 60 seconds later
  const notificationId = `mustardready-${Date.now()}`
  const scheduledFor = Date.now() + 60_000

  scheduledNotifications.push({
    id: notificationId,
    scheduledFor,
    notification: {
      notificationId,
      title: 'Mustard',
      body: 'You can mint NFT again!',
      targetUrl: FRONTEND_URL,
      tokens: [body.token],
    },
  })

  const scheduledDate = new Date(scheduledFor).toLocaleTimeString()
  console.log(`  [scheduler] notification "${notificationId}" scheduled for ${scheduledDate} (in 60s)`)
  console.log(`  [scheduler] queue size: ${scheduledNotifications.length}`)
  console.log(`  [scheduler] will POST to ${FARCASTER_HOST_URL}/api/miniapps-notifications`)

  return c.json({ success: true, scheduledFor })
})

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    tokens: notificationTokens.size,
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
    const payload = JSON.stringify(item.notification)
    console.log(`  [scheduler] sending to ${FARCASTER_HOST_URL}/api/miniapps-notifications`)
    console.log(`  [scheduler] payload: ${payload}`)

    try {
      const response = await fetch(`${FARCASTER_HOST_URL}/api/miniapps-notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      })

      const responseBody = await response.text()
      if (response.ok) {
        console.log(`  [scheduler] SUCCESS sent notification: ${item.id}`)
        console.log(`  [scheduler] FARCASTER_HOST response: ${responseBody}`)
      } else {
        console.error(`  [scheduler] FAILED to send: HTTP ${response.status} - ${responseBody}`)
      }
    } catch (e) {
      console.error(`  [scheduler] ERROR sending notification:`, e)
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
  console.log(`  Server:     http://localhost:${info.port}`)
  console.log(`  Webhook:    POST http://localhost:${info.port}/webhook`)
  console.log(`  Mint:       POST http://localhost:${info.port}/api/mint`)
  console.log(`  Health:     GET  http://localhost:${info.port}/health`)
  console.log('')
  console.log(`  Sends notifications to FARCASTER_HOST at ${FARCASTER_HOST_URL}`)
  console.log('')
})
