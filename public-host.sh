#!/bin/sh
# Runs from /docker-entrypoint.d/ before nginx starts.
# Substitutes __PUBLIC_HOST__ in the deployed Farcaster manifest so the image
# does not need a rebuild when the tunnel URL changes — only a container restart.

MANIFEST=/usr/share/nginx/html/.well-known/farcaster.json

if [ -z "${PUBLIC_HOST:-}" ]; then
  echo "[MUSTARD] WARNING: PUBLIC_HOST is not set — farcaster.json will contain placeholder URLs. Run ./dev-up.sh" >&2
  exit 0
fi

if [ -f "$MANIFEST" ]; then
  # Strip a trailing slash so placeholder paths like __PUBLIC_HOST__/icon.svg stay clean
  sed -i "s|__PUBLIC_HOST__|${PUBLIC_HOST%/}|g" "$MANIFEST"
  echo "[MUSTARD] farcaster.json public host: ${PUBLIC_HOST%/}"
fi
