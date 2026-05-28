# NS Webhook Integration Guide (for miniapp backends)

This guide explains how to wire a miniapp backend to the **Notification Server (NS)** so it can receive miniapp lifecycle events (a user added / removed the miniapp, enabled / disabled notifications).

It ships with a single drop-in helper file — `src/ns-webhook.ts` — that handles JWKS fetching, JWS verification of the `x-user-address` header, JWS signature verification of the webhook body, and runtime narrowing of the payload union. Copy that file into your backend, install `jose`, and you're done.

---

## 1. What you get

NS sends a POST to a webhook URL you register with the NS team. Each request looks like:

```http
POST /your-webhook-path HTTP/1.1
Content-Type: application/json
x-user-address: <JWS over the user's address — see §2>
X-Webhook-Signature: <JWS over the request body — see §2>

{
  "event": "miniapp_added",
  "notificationDetails": {
    "url": "https://ns.example.com/notification",
    "token": "<push token>"
  }
}
```

Four event types — two carry `notificationDetails`, two don't:

| `event`                  | Body shape                                                      | When it fires                  |
| ------------------------ | --------------------------------------------------------------- | ------------------------------ |
| `miniapp_added`          | `{ event, notificationDetails: { url, token } }`                | User added the miniapp. **Store the token.** |
| `notifications_enabled`  | `{ event, notificationDetails: { url, token } }` (new token)    | User re-enabled notifications. **Rotate the token.** |
| `notifications_disabled` | `{ event }` only                                                | User toggled notifications off. **Stop sending.** |
| `miniapp_removed`        | `{ event }` only                                                | User removed the miniapp. **Delete the token.** |

`notificationDetails.url` is the fully-qualified NS send-notification endpoint you POST to when delivering a push — use it verbatim, do not derive or rewrite it. `notificationDetails.token` is the per-user token to include in that POST. Store both together when you receive `miniapp_added` / `notifications_enabled`; either can change on a token rotation.

Respond with **HTTP 200** on success. Anything else makes NS retry (confirm the exact retry policy with the NS team).

---

## 2. Signature format

Both `x-user-address` and `X-Webhook-Signature` use the same NS signing key (look it up in the JWKS at `NS_JWKS_URL` by `kid`) and the same envelope: **JWS Compact Serialization** (`header.payload.signature`, base64url-encoded segments). The difference is what's signed:

- **`X-Webhook-Signature`** — signed payload is the marshaled JSON request body, verbatim. Verify by JWS-decoding the header and asserting the signed payload byte-matches the raw request body. Read the body as a raw string — re-serializing parsed JSON will not match.
- **`x-user-address`** — signed payload is the user's smart-account address string. Not a JWT, no claims envelope: the JWS payload bytes *are* the address. Verify the JWS and use the decoded payload directly.

What to ask the NS team:

1. **`NS_JWKS_URL`** — the full URL of the NS JWKS endpoint (typically `https://<ns-host>/.well-known/jwks.json`). Needed up front since signature verification has to happen before you can trust anything in the webhook body.
2. **Retry policy** on non-2xx responses (so you can size your idempotency window).

---

## 3. Install

```bash
npm install jose
# or: pnpm add jose / yarn add jose
```

Copy `src/ns-webhook.ts` from this repo into your backend's source tree. The file has zero project-specific code — it imports only from `jose`.

Set the env var:

```bash
NS_JWKS_URL=https://ns.example.com/.well-known/jwks.json   # ask the NS team for the real URL
```

The helper reads `process.env.NS_JWKS_URL` at module load and throws if it's missing. This is intentional — fail loud at boot rather than at first webhook.

---

## 4. Use

Framework-agnostic example — adapt the request/response wiring to your framework:

```ts
import {
  NS_WEBHOOK_EVENTS,
  decodeUserAddress,
  parseWebhookPayload,
  verifyWebhookSignature,
} from './ns-webhook.js'

async function handleNsWebhook(rawBody: string, headers: Record<string, string | undefined>) {
  // 1. Verify the signature against NS JWKS. Reject if invalid.
  await verifyWebhookSignature(rawBody, headers['x-webhook-signature'])

  // 2. Parse & narrow the body to a typed union.
  const payload = parseWebhookPayload(rawBody)

  // 3. Decode the signed x-user-address header to get the user's wallet address.
  const userAddress = await decodeUserAddress(headers['x-user-address'])

  // 4. Branch on the event.
  switch (payload.event) {
    case NS_WEBHOOK_EVENTS.MINIAPP_ADDED:
    case NS_WEBHOOK_EVENTS.NOTIFICATIONS_ENABLED:
      // payload.notificationDetails is typed: { url, token }
      await saveToken(userAddress, payload.notificationDetails)
      break
    case NS_WEBHOOK_EVENTS.NOTIFICATIONS_DISABLED:
    case NS_WEBHOOK_EVENTS.MINIAPP_REMOVED:
      await removeToken(userAddress)
      break
  }
}
```

Hono example (matches this repo). Each verification step has its own try/catch so signature failures return `401` (auth) while malformed-body failures return `400` (bad request) — useful when reading NS retry logs:

```ts
app.post('/webhook', async (c) => {
  const rawBody = await c.req.text()

  try {
    await verifyWebhookSignature(rawBody, c.req.header('x-webhook-signature'))
  } catch (err) {
    return c.json({ success: false, error: 'invalid signature' }, 401)
  }

  let payload: ReturnType<typeof parseWebhookPayload>
  try {
    payload = parseWebhookPayload(rawBody)
  } catch (err) {
    return c.json({ success: false, error: 'invalid payload' }, 400)
  }

  let userAddress: string
  try {
    userAddress = await decodeUserAddress(c.req.header('x-user-address'))
  } catch (err) {
    return c.json({ success: false, error: 'invalid x-user-address' }, 400)
  }

  // ...handle payload...
  return c.json({ success: true })
})
```

Express example:

```ts
app.post('/webhook', express.text({ type: '*/*' }), async (req, res) => {
  try {
    await verifyWebhookSignature(req.body, req.header('x-webhook-signature'))
    const payload = parseWebhookPayload(req.body)
    const userAddress = await decodeUserAddress(req.header('x-user-address'))
    // ...handle payload...
    res.status(200).json({ success: true })
  } catch (err) {
    res.status(400).json({ success: false })
  }
})
```

> **Important**: read the body as a **raw string**, not parsed JSON. `verifyWebhookSignature` needs the exact bytes that were signed — reserializing parsed JSON will not byte-match.

---

## 5. API reference (`ns-webhook.ts`)

### `parseWebhookPayload(rawBody: string): NsWebhookPayload`

Parses the JSON body and narrows it to a typed discriminated union. Throws on:

- invalid JSON
- unknown `event`
- missing or wrong-typed fields in `notificationDetails` (for `miniapp_added` / `notifications_enabled`)

### `decodeUserAddress(headerValue: string | undefined): Promise<string>`

JWS-verifies the `x-user-address` header against NS JWKS and returns the signed payload (the address string) lowercased. The header is **not** a JWT — its signed payload is the raw address bytes. Throws on missing header, invalid signature, or empty payload.

### `verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): Promise<void>`

Verifies `X-Webhook-Signature` (JWS Compact Serialization) against NS JWKS and asserts that the signed payload matches `rawBody` byte-for-byte. Throws on any mismatch.

### Types & constants

```ts
NS_WEBHOOK_EVENTS.MINIAPP_ADDED           // 'miniapp_added'
NS_WEBHOOK_EVENTS.MINIAPP_REMOVED         // 'miniapp_removed'
NS_WEBHOOK_EVENTS.NOTIFICATIONS_ENABLED   // 'notifications_enabled'
NS_WEBHOOK_EVENTS.NOTIFICATIONS_DISABLED  // 'notifications_disabled'

type NotificationDetails = { url: string; token: string }

type NsWebhookPayload =
  | { event: 'miniapp_added';          notificationDetails: NotificationDetails }
  | { event: 'notifications_enabled';  notificationDetails: NotificationDetails }
  | { event: 'miniapp_removed' }
  | { event: 'notifications_disabled' }
```

---

## 6. Response contract

- **200**: webhook accepted. Use any `2xx` body (most teams use `{ "success": true }`).
- **non-200**: NS will retry per its retry policy. Use `401` for signature failures and `400` for malformed-body / bad header failures, so permanent errors don't loop forever once the policy is honored — but **confirm the retry semantics with the NS team** before depending on this.

---

## 7. Troubleshooting

| Symptom | Likely cause |
| ------- | ------------ |
| `Failed to fetch JWKS` at boot | `NS_JWKS_URL` wrong or NS unreachable from your backend's egress. Curl `${NS_JWKS_URL}` from the backend host. |
| `JWKSNoMatchingKey` on every request | NS rotated keys and the in-process JWKS cache is stale. `jose` refetches automatically on `kid` miss; if you still see this, check that your `x-user-address` and `X-Webhook-Signature` are actually signed by *this* NS instance and not a sibling. |
| `x-user-address signed payload is empty` | The JWS verified but its payload had no bytes. Should never happen with a real NS request — confirm you're not stripping the header or passing a placeholder. |
| `X-Webhook-Signature payload does not match request body` | Your framework parsed and re-serialized the body before handing it to `verifyWebhookSignature`. Read the raw body as a string. |
| Tokens received but pushes never arrive | Unrelated to this webhook — check that you're calling the NS send-notification endpoint correctly with the token you stored. |

---

## 8. What's NOT covered here

- **Sending notifications.** This guide is webhook-side only (NS → you). The send-side (you → NS to deliver a push) is a separate endpoint with its own contract — ask the NS team.
- **Idempotency / dedupe.** If NS retries on transient errors, you may see the same event more than once. NS doesn't currently send a stable event ID — dedupe with `(userAddress, event, token)` if you care.
- **Rate limits.** NS may rate-limit your send side; webhook receive side typically isn't rate-limited.
- **Local testing without NS.** If you want to test without a live NS, you can stand up a local JWKS server and sign test tokens with a matching private key. Out of scope for this guide.
