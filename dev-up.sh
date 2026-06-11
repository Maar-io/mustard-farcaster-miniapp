#!/usr/bin/env bash
# Boots the stack behind a Cloudflare quick tunnel.
#
# Quick tunnels get a random *.trycloudflare.com URL on every cloudflared
# (re)start, and that URL must be known before frontend/backend boot (it is
# substituted into farcaster.json and passed as FRONTEND_URL). So the order is:
#   1. start cloudflared alone
#   2. read the assigned hostname from its metrics endpoint
#   3. write PUBLIC_HOST to .env
#   4. start frontend + backend
#
# Idempotent: re-running reuses the already-running tunnel (URL unchanged).
set -euo pipefail
cd "$(dirname "$0")"

echo "Starting cloudflared quick tunnel..."
docker compose up -d cloudflared

printf 'Waiting for tunnel URL'
TUNNEL_HOSTNAME=""
for _ in $(seq 1 30); do
  TUNNEL_HOSTNAME=$(curl -fsS http://localhost:4040/quicktunnel 2>/dev/null \
    | sed -E 's/.*"hostname":[[:space:]]*"([^"]*)".*/\1/') || true
  case "$TUNNEL_HOSTNAME" in
    *.trycloudflare.com) break ;;
    *) TUNNEL_HOSTNAME="" ;;
  esac
  printf '.'
  sleep 1
done
echo

if [ -z "$TUNNEL_HOSTNAME" ]; then
  echo "ERROR: could not read tunnel URL from http://localhost:4040/quicktunnel" >&2
  echo "Last cloudflared logs:" >&2
  docker compose logs --tail 20 cloudflared >&2
  exit 1
fi

PUBLIC_HOST="https://$TUNNEL_HOSTNAME"

if grep -q '^PUBLIC_HOST=' .env 2>/dev/null; then
  # -i.bak + rm: portable in-place edit (BSD/macOS sed vs GNU sed)
  sed -i.bak "s|^PUBLIC_HOST=.*|PUBLIC_HOST=$PUBLIC_HOST|" .env && rm -f .env.bak
else
  printf '\nPUBLIC_HOST=%s\n' "$PUBLIC_HOST" >>.env
fi

echo "Starting frontend + backend..."
docker compose up -d --build frontend backend

echo
echo "  Public URL:  $PUBLIC_HOST"
echo "  Manifest:    $PUBLIC_HOST/.well-known/farcaster.json"
echo "  Webhook:     $PUBLIC_HOST/webhook  (proxied to backend:3300)"
echo "  Local app:   http://localhost:5174"
echo "  Local API:   http://localhost:3300"
echo
echo "NOTE: the URL changes whenever the cloudflared container restarts —"
echo "      re-run ./dev-up.sh afterwards and re-add the miniapp in the host."
