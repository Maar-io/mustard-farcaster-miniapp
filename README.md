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
- **cloudflared** named tunnel exposing the frontend on a stable public
  hostname (e.g. https://mustard.loudgoat.xyz)

One tunnel is enough: nginx proxies `/webhook`, `/api/*`, and `/health` to the
backend, so the backend is reachable through the same public URL.

`PUBLIC_HOST` must be set in `.env` to the tunnel's public hostname; it is
substituted into `/.well-known/farcaster.json` at container start, so no image
rebuild is needed when it changes.

Tunnel routing (public hostname -> `http://frontend:5174`) is configured once in
the Cloudflare dashboard: **Networks > Connectors > _tunnel_ > Published
application routes**. The hostname is stable across restarts, so the miniapp
only needs to be registered in the Farcaster host once.

> **One connector only.** The docker-compose `cloudflared` service is the sole
> connector for this tunnel. Do NOT also run `cloudflared` on the host (e.g.
> `cloudflared tunnel run --token …` or `cloudflared service install`) with the
> same token — two connectors on one named tunnel conflict and cause Cloudflare
> origin errors (1016).

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
- Tunnel connector metrics: http://localhost:4040/metrics
