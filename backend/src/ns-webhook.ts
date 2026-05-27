// NS (Notification Server) webhook helper.
//
// Drop-in module for any miniapp backend that needs to receive NS subscription
// webhooks. Framework-agnostic — depends only on `jose`. See ../NS_WEBHOOK.md.

import { compactVerify, createRemoteJWKSet } from 'jose'

const NS_BASE_URL = process.env.NS_BASE_URL
if (!NS_BASE_URL) {
  throw new Error('NS_BASE_URL env var is required for ns-webhook.ts (e.g. https://ns.example.com)')
}

const JWKS = createRemoteJWKSet(new URL(`${NS_BASE_URL}/.well-known/jwks.json`))

export const NS_WEBHOOK_EVENTS = {
  MINIAPP_ADDED: 'miniapp_added',
  MINIAPP_REMOVED: 'miniapp_removed',
  NOTIFICATIONS_ENABLED: 'notifications_enabled',
  NOTIFICATIONS_DISABLED: 'notifications_disabled',
} as const

export type NotificationDetails = {
  url: string
  token: string
}

export type NsWebhookPayload =
  | { event: typeof NS_WEBHOOK_EVENTS.MINIAPP_ADDED; notificationDetails: NotificationDetails }
  | { event: typeof NS_WEBHOOK_EVENTS.NOTIFICATIONS_ENABLED; notificationDetails: NotificationDetails }
  | { event: typeof NS_WEBHOOK_EVENTS.MINIAPP_REMOVED }
  | { event: typeof NS_WEBHOOK_EVENTS.NOTIFICATIONS_DISABLED }

// Parse and narrow an NS webhook body into the typed union. Throws on shape mismatch.
export function parseWebhookPayload(rawBody: string): NsWebhookPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch (err) {
    throw new Error(`ns-webhook: body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('ns-webhook: body is not a JSON object')
  }

  const envelope = parsed as { event?: unknown; notificationDetails?: unknown }
  const event = envelope.event

  if (event === NS_WEBHOOK_EVENTS.MINIAPP_ADDED || event === NS_WEBHOOK_EVENTS.NOTIFICATIONS_ENABLED) {
    const details = assertNotificationDetails(envelope.notificationDetails)
    return { event, notificationDetails: details }
  }
  if (event === NS_WEBHOOK_EVENTS.MINIAPP_REMOVED || event === NS_WEBHOOK_EVENTS.NOTIFICATIONS_DISABLED) {
    return { event }
  }

  throw new Error(`ns-webhook: unknown event "${String(event)}"`)
}

function assertNotificationDetails(value: unknown): NotificationDetails {
  if (!value || typeof value !== 'object') {
    throw new Error('ns-webhook: notificationDetails is not an object')
  }
  const d = value as Record<string, unknown>
  if (typeof d.url !== 'string') throw new Error('ns-webhook: notificationDetails.url is not a string')
  if (typeof d.token !== 'string') throw new Error('ns-webhook: notificationDetails.token is not a string')
  return { url: d.url, token: d.token }
}

// Verify and decode the `x-user-address` header. Per the NS team, this is a
// JWS Compact Serialization (signed with the same key as X-Webhook-Signature)
// whose payload IS the raw address string — not a JWT with claims.
// Returns the lowercased address. Throws on missing or invalid header.
export async function decodeUserAddress(headerValue: string | undefined): Promise<string> {
  if (!headerValue) {
    throw new Error('ns-webhook: missing x-user-address header')
  }

  const { payload } = await compactVerify(headerValue, JWKS)
  const address = new TextDecoder().decode(payload).trim()
  if (!address) {
    throw new Error('ns-webhook: x-user-address signed payload is empty')
  }
  return address.toLowerCase()
}

// Verify the `X-Webhook-Signature` header against the raw body using NS JWKS.
// Per the NS team, the header is a JWS Compact Serialization (header.payload.sig)
// whose signed payload is the marshaled JSON request body verbatim. Read the
// body as raw bytes/string — reserializing parsed JSON will break byte equality.
// Throws on mismatch. NOT wired in Step 1 — ships ready for Step 2.
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
): Promise<void> {
  if (!signatureHeader) {
    throw new Error('ns-webhook: missing X-Webhook-Signature header')
  }

  const { payload } = await compactVerify(signatureHeader, JWKS)
  const signedBody = new TextDecoder().decode(payload)
  if (signedBody !== rawBody) {
    throw new Error('ns-webhook: X-Webhook-Signature payload does not match request body')
  }
}
