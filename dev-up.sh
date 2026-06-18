#!/usr/bin/env bash
# Boots the stack behind a Cloudflare named tunnel.
#
# Requires CLOUDFLARE_TUNNEL_TOKEN and PUBLIC_HOST set in .env
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy from .env.example and add CLOUDFLARE_TUNNEL_TOKEN" >&2
  exit 1
fi

# Load .env to get PUBLIC_HOST and CLOUDFLARE_TUNNEL_TOKEN
export $(grep -v '^#' .env | xargs)

if [ -z "${PUBLIC_HOST:-}" ]; then
  echo "ERROR: PUBLIC_HOST not set in .env" >&2
  exit 1
fi

if [ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  echo "ERROR: CLOUDFLARE_TUNNEL_TOKEN not set in .env" >&2
  exit 1
fi

echo "Starting frontend + backend + Cloudflare tunnel..."
docker compose up -d --build frontend backend cloudflared

echo
echo "  Public URL:  $PUBLIC_HOST"
echo "  Manifest:    $PUBLIC_HOST/.well-known/farcaster.json"
echo "  Webhook:     $PUBLIC_HOST/webhook  (proxied to backend:3300)"
echo "  Local app:   http://localhost:5174"
echo "  Local API:   http://localhost:3300"
