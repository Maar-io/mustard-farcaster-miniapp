# Mustard — Farcaster Miniapp

A Farcaster miniapp demo built with React + Vite (frontend) and Hono (backend).

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose
- Or, for local (non-Docker) development: Node.js 20+ and npm

## Quick start (Docker)

```bash
docker compose up --build
```

This starts:

- **Frontend** at http://localhost:5174 (nginx serving the built Vite app)
- **Backend** at http://localhost:3300 (Hono API)

The backend reaches services on the host machine via `host.docker.internal` (works out of the box on macOS/Windows). On Linux, uncomment the `extra_hosts` block in [docker-compose.yml](docker-compose.yml).

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

## Useful endpoints

- App: http://localhost:5174
- Farcaster manifest: http://localhost:5174/.well-known/farcaster.json
- Backend API: http://localhost:3300
