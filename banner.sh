#!/bin/sh
# Runs from /docker-entrypoint.d/ before nginx starts (see nginx:alpine entrypoint).
# Don't exec nginx here — the parent entrypoint does that after this script returns.

PORT="${FRONTEND_PORT:-5174}"
PREFIX="[MUSTARD]"

printf '%s\n' "$PREFIX"
printf '%s \033[33mmustardfrontend\033[0m — Miniapp UI\n' "$PREFIX"
printf '%s\n' "$PREFIX"
printf '%s App:             http://localhost:%s\n' "$PREFIX" "$PORT"
printf '%s Manifest:        GET  http://localhost:%s/.well-known/farcaster.json\n' "$PREFIX" "$PORT"
printf '%s\n' "$PREFIX"
