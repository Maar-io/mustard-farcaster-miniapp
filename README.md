# Mustard — Farcaster Miniapp

A Farcaster miniapp demo built with React + Vite (frontend) and Hono (backend).

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose
- Or, for local (non-Docker) development: Node.js 20+ and npm

## Quick start (Docker + Cloudflare tunnel)

```bash
./dev-up.sh
```

This starts:

- **Frontend** at http://localhost:5174 (nginx serving the built Vite app)
- **Backend** at http://localhost:3300 (Hono API)
- **cloudflared** quick tunnel exposing the frontend publicly on a random
  `*.trycloudflare.com` URL (printed by the script)

One tunnel is enough: nginx proxies `/webhook`, `/api/*`, and `/health` to the
backend, so the backend is reachable through the same public URL.

The script reads the tunnel URL from cloudflared's metrics endpoint
(http://localhost:4040/quicktunnel), writes it to `.env` as `PUBLIC_HOST`, and
then boots frontend + backend. `PUBLIC_HOST` is substituted into
`/.well-known/farcaster.json` at container start, so no image rebuild is needed
when the URL changes.

**The URL rotates whenever the cloudflared container restarts.** Re-run
`./dev-up.sh` afterwards and re-add the miniapp in the Farcaster host.
Restarting just frontend/backend (`docker compose up -d --build frontend backend`)
keeps the tunnel — and the URL — alive.

For a stable hostname, switch to a [named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/)
once a domain is added to Cloudflare (free plan is sufficient).

The backend reaches services on the host machine via `host.docker.internal`
(works out of the box on macOS/Windows). On Linux, uncomment the `extra_hosts`
block in [docker-compose.yml](docker-compose.yml).

To stop:

```bash
docker compose down
```

## Local development (without Docker)

Install dependencies (run once in each workspace):

```bash
npm install --legacy-peer-deps
cd backend && npm install && cd ..
```

Run frontend and backend in separate terminals:

```bash
npm run dev          # frontend on http://localhost:5174
npm run dev:backend  # backend on http://localhost:3300
```

Note: without Docker there is no nginx, so `/.well-known/farcaster.json` is
served with `__PUBLIC_HOST__` placeholders — fine for UI work, but miniapp
host integration requires the Docker + tunnel setup.

## Useful endpoints

- App: http://localhost:5174
- Farcaster manifest: http://localhost:5174/.well-known/farcaster.json
- Backend API: http://localhost:3300
- Tunnel URL (JSON): http://localhost:4040/quicktunnel
