# Mustard - Farcaster Mini App

A demo Farcaster Mini App built with Next.js, deployed on Netlify. Demonstrates NFT minting on the Soneium blockchain and push notifications via the Farcaster host notification system.

## Features

- Connect via Startale smart account (Soneium chain)
- Mint NFTs on-chain with a visual gallery
- Push notifications through the Farcaster host
- External notification trigger endpoint — send notifications even when the miniapp is not active

## Getting Started

```bash
npm install
npm run dev
```

App runs at `http://localhost:5174`.

## Project Structure

```
app/
  layout.tsx               Root layout with providers
  page.tsx                 Main page
  globals.css              Mustard gradient styles
  api/
    webhook/route.ts       Receives Farcaster lifecycle events
    mint/route.ts          Sends notification on NFT mint
    test-notification/     Sends a test notification
    trigger-notification/  External trigger (see below)
    notification-status/   Checks if user has notifications enabled
    health/                Health check
components/
  App.tsx                  Main app with wallet connect
  MintGallery.tsx          NFT minting UI + on-chain reads
  NotificationSection.tsx  Enable/disable/test notifications
  ContextSection.tsx       Farcaster user context display
lib/
  wagmi.ts                 Wagmi config (Soneium + Startale connector)
  providers.tsx            WagmiProvider + QueryClientProvider
  token-store.ts           In-memory notification token storage
  send-notification.ts     Shared notification fetch helper
middleware.ts              CORS headers for API routes
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/webhook` | Farcaster host lifecycle events (`miniapp_added`, `miniapp_removed`, `notifications_disabled`) |
| `POST` | `/api/mint` | Called after NFT mint, sends immediate notification |
| `POST` | `/api/test-notification` | Send a test notification to a user |
| `POST` | `/api/trigger-notification` | External trigger — send notification when miniapp is not active |
| `GET` | `/api/notification-status?userAddress=0x...` | Check if notifications are enabled for an address |
| `GET` | `/api/health` | Health check with registered address count |

## Sending Notifications from CLI

The `/api/trigger-notification` endpoint lets you send a push notification to any registered user from outside the app. This demonstrates that miniapps can notify users even when the miniapp is not open.

### Prerequisites

1. Open the miniapp in the Farcaster host (sandbox)
2. Connect your wallet
3. Click "Enable Notifications" — this registers your notification token via the webhook

### Send a notification

```bash
curl -X POST http://localhost:5174/api/trigger-notification \
  -H "Content-Type: application/json" \
  -d '{"userAddress": "0xYOUR_WALLET_ADDRESS"}'
```

Successful response:

```json
{"success": true}
```

The user receives: **"Hello from Mustard! This notification was triggered externally."**

### Other CLI examples

Test notification (same as the "Test Notification" button in the UI):

```bash
curl -X POST http://localhost:5174/api/test-notification \
  -H "Content-Type: application/json" \
  -d '{"userAddress": "0xYOUR_WALLET_ADDRESS"}'
```

Check notification status:

```bash
curl http://localhost:5174/api/notification-status?userAddress=0xYOUR_WALLET_ADDRESS
```

Health check:

```bash
curl http://localhost:5174/api/health
```

## Token Storage

Notification tokens are stored in-memory (`lib/token-store.ts`). This works for local development where `next dev` runs as a single process. On Netlify serverless, tokens may not be shared across Lambda containers. For production, replace the Map with Netlify Blobs or Upstash Redis.

## Deploy to Netlify

1. Push to GitHub
2. Connect the repo in the Netlify dashboard
3. Set environment variable `NEXT_PUBLIC_APP_URL` to your Netlify domain
4. Update URLs in `public/.well-known/farcaster.json` to match
5. Deploy

The `netlify.toml` and `@netlify/plugin-nextjs` handle the rest automatically.
