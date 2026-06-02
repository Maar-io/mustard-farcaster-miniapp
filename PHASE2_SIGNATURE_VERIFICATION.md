# Phase 2 — Svix Ed25519 Webhook Signature Verification

This document describes the **remaining** implementation work for the Mustard miniapp's
NS (Notification Server) webhook handling. Phase 1 (raw payload handling, no signature
check) is already done. Phase 2 adds proper signature verification.

> **Status:** planned / not yet implemented. Phase 1 is live in `backend/src/ns-webhook.ts`
> and `backend/src/index.ts`.

---

## Context

NS now signs every webhook with the **Svix** scheme (Ed25519). Phase 1 deliberately skipped
verification so the new payload shape could be exercised end-to-end first. Phase 2 wires the
actual signature check so the miniapp rejects forged or tampered webhooks.

The authoritative reference for the exact scheme is the NS integration test and signer:

- `superapp-backend/services/notification-service/test/integration/webhook_test.go` — verification recipe
- `superapp-backend/services/notification-service/internal/implementations/svix/webhook.go` — signing recipe
- `superapp-backend/services/notification-service/internal/core/domain/webhook.go` — payload shape

---

## The signature scheme

NS sends these headers alongside the JSON body:

| Header           | Example                          | Meaning                                              |
| ---------------- | -------------------------------- | ---------------------------------------------------- |
| `svix-id`        | `msg_1717245600000000000`        | Unique message id                                    |
| `svix-timestamp` | `1717245600`                     | Unix seconds at send time                            |
| `svix-signature` | `v1,<base64-std sig>`            | `scheme,signature`; may be multiple space-separated  |
| `x-key-id`       | `key-2`                          | `kid` of the JWKS key to verify against              |

**Signed string:**

```
${svix-id}.${svix-timestamp}.${rawBody}
```

where `rawBody` is the **exact bytes** of the request body (read it as a raw string — never
re-`JSON.stringify` the parsed object; key ordering / whitespace would diverge and break
verification).

**Signature:** a raw **Ed25519** signature over `toSign`, encoded with **base64 standard**
(not base64url). The `v1` prefix is the scheme version. Svix may emit several space-separated
`scheme,sig` entries — accept the webhook if **any** entry verifies.

**Key:** look up the Ed25519 public key in the NS JWKS (`NS_JWKS_URL`, served at
`/.well-known/jwks.json`) whose `kid` matches the `x-key-id` header. Keys are `kty: OKP`,
`crv: Ed25519`, `alg: EdDSA`.

---

## Decisions (already agreed)

- **Timestamp: NOT enforced.** Verify the signature only; do not reject on `svix-timestamp`
  freshness. The header is still required because it is part of `toSign`. Add a code comment
  noting replay protection is intentionally skipped for this demo miniapp.
- **Crypto: `jose.importJWK` + Node built-in `crypto.verify`.** No new dependency. `jose` is
  already in `package.json`. Do **not** add the official `svix` npm package — it targets
  symmetric secrets and its own header handling, and does not fit this Ed25519-via-JWKS scheme.

---

## Implementation

### `backend/src/ns-webhook.ts`

Add a new `verifyWebhookSignature` (the Phase 1 removal of the old JWS version is already done).

```ts
import { importJWK } from 'jose'
import { verify as cryptoVerify } from 'node:crypto'

const NS_JWKS_URL = process.env.NS_JWKS_URL
if (!NS_JWKS_URL) {
  throw new Error('NS_JWKS_URL env var is required for Phase 2 signature verification')
}

type SvixHeaders = {
  svixId?: string
  svixTimestamp?: string
  svixSignature?: string
  keyId?: string
}

// Verifies the Svix Ed25519 signature. Throws on any failure.
// Replay protection (svix-timestamp freshness) is intentionally NOT enforced here.
export async function verifyWebhookSignature(rawBody: string, headers: SvixHeaders): Promise<void> {
  const { svixId, svixTimestamp, svixSignature, keyId } = headers
  if (!svixId || !svixTimestamp || !svixSignature || !keyId) {
    throw new Error('ns-webhook: missing one of svix-id / svix-timestamp / svix-signature / x-key-id')
  }

  const key = await loadEd25519PublicKey(keyId)            // see below — fetch JWKS, pick by kid
  const toSign = Buffer.from(`${svixId}.${svixTimestamp}.${rawBody}`)

  // svix-signature = "v1,<sig> v2,<sig> ..." — accept if any v1 entry verifies.
  const candidates = svixSignature
    .split(' ')
    .map((entry) => entry.split(','))
    .filter(([scheme]) => scheme === 'v1')
    .map(([, sig]) => sig)

  if (candidates.length === 0) {
    throw new Error('ns-webhook: no v1 signature in svix-signature header')
  }

  for (const sig of candidates) {
    const sigBytes = Buffer.from(sig, 'base64')            // base64 STANDARD, not base64url
    // Ed25519: algorithm arg is null; key is a Node KeyObject.
    if (cryptoVerify(null, toSign, key, sigBytes)) return
  }

  throw new Error('ns-webhook: Svix signature verification failed')
}
```

**`loadEd25519PublicKey(kid)`** — fetch the JWKS JSON from `NS_JWKS_URL`, select the key whose
`kid` matches, import it to a Node `KeyObject`:

```ts
import { importJWK } from 'jose'

let jwksCache: { keys: Array<Record<string, unknown>> } | null = null

async function loadEd25519PublicKey(kid: string) {
  if (!jwksCache) {
    const res = await fetch(NS_JWKS_URL!)
    if (!res.ok) throw new Error(`ns-webhook: failed to fetch JWKS: HTTP ${res.status}`)
    jwksCache = await res.json()
  }
  let jwk = jwksCache!.keys.find((k) => k.kid === kid)
  if (!jwk) {
    // kid miss → refetch once (NS may have rotated keys).
    const res = await fetch(NS_JWKS_URL!)
    if (!res.ok) throw new Error(`ns-webhook: failed to refetch JWKS: HTTP ${res.status}`)
    jwksCache = await res.json()
    jwk = jwksCache!.keys.find((k) => k.kid === kid)
  }
  if (!jwk) throw new Error(`ns-webhook: no JWKS key for kid "${kid}"`)
  // importJWK returns a Node KeyObject for OKP/Ed25519 keys, usable by crypto.verify.
  return (await importJWK(jwk, 'EdDSA')) as import('node:crypto').KeyObject
}
```

> `createRemoteJWKSet` from `jose` is JWT-header oriented and not a good fit here — fetch the
> JWKS JSON directly and select by `kid` ourselves, as above.

### `backend/src/index.ts`

Re-enable verification as the **first** step of the `/webhook` handler, before parsing, and
return **401** on failure (preserving the existing status convention). Replace the Phase 1
comment block:

```ts
import { NS_WEBHOOK_EVENTS, parseWebhookPayload, verifyWebhookSignature } from './ns-webhook.js'

app.post('/webhook', async (c) => {
  const rawBody = await c.req.text()
  // ...existing logging...

  try {
    await verifyWebhookSignature(rawBody, {
      svixId: c.req.header('svix-id'),
      svixTimestamp: c.req.header('svix-timestamp'),
      svixSignature: c.req.header('svix-signature'),
      keyId: c.req.header('x-key-id'),
    })
  } catch (err) {
    console.error(`${LOG_PREFIX} [webhook] signature verification failed:`, err)
    return c.json({ success: false, error: 'invalid signature' }, 401)
  }

  // ...existing parse + event switch (unchanged from Phase 1)...
})
```

### `backend/package.json`

No new dependency. `jose` is already present; Ed25519 verification uses Node's built-in
`crypto`.

### `backend/NS_WEBHOOK.md`

Flip the _(Phase 2)_ caveats to "implemented" once this lands — the signature section already
documents the scheme.

---

## Files to modify

- `backend/src/ns-webhook.ts` — add `verifyWebhookSignature` + `loadEd25519PublicKey`, re-add
  `NS_JWKS_URL` env requirement and `jose` import.
- `backend/src/index.ts` — call `verifyWebhookSignature` first in `/webhook`, 401 on failure,
  update import.
- `backend/NS_WEBHOOK.md` — mark Phase 2 sections as live.

---

## Verification

1. **Typecheck:** `cd backend && npx tsc --noEmit`.

2. **Local signed-webhook test** (reproduce the Go test in Node):
   - Generate an Ed25519 keypair; expose its public key as a JWKS (`{ keys: [{ kty: "OKP",
     crv: "Ed25519", x: "<base64url>", kid: "test-key", alg: "EdDSA" }] }`) at a local URL and
     point `NS_JWKS_URL` at it.
   - Build `toSign = `${id}.${ts}.${body}``, sign with the private key, base64-**standard**
     encode → `svix-signature: v1,<sig>`.
   - POST to `/webhook` with `svix-id`, `svix-timestamp`, `svix-signature`, `x-key-id: test-key`.
     → expect **200**.
   - Tamper the body (or use a wrong key) → expect **401**.
   - Omit any one signature header → expect **401**.

3. **End-to-end against NS dev** (best signal): subscribe via NS
   `POST /api/v1/miniapp/subscribe` so NS fires a live `miniapp_added` webhook at the
   ngrok-exposed `/webhook`, and confirm verification passes in the logs.

---

## Notes / gotchas

- **base64 standard, not base64url** for the signature bytes (`Buffer.from(sig, 'base64')`).
  The JWK's `x` coordinate, however, is base64url — `importJWK` handles that.
- **Raw body only.** Verify against `c.req.text()`, never a re-stringified parsed object.
- **Multiple signatures.** `svix-signature` can contain several space-separated entries; pass
  if any `v1` entry verifies.
- **Key rotation.** On a `kid` miss, refetch the JWKS once before failing.
- **Send URL is unaffected.** The `/notification → /miniapp/send-notification` rename needs no
  miniapp change — the send target comes verbatim from `notificationDetails.url` in the webhook.
