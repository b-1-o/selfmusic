#!/bin/sh
set -eu

fail() {
  printf '\n[SelfMusic] ERROR: %s\n' "$1" >&2
  exit 1
}

command -v ffmpeg >/dev/null 2>&1 || fail "FFmpeg is missing. Rebuild the image with: docker compose up -d --build"
if ! command -v yt-dlp >/dev/null 2>&1 || [ ! -x /usr/bin/yt-dlp ]; then
  fail "yt-dlp is missing. Rebuild the image with: docker compose up -d --build"
fi

if [ -z "${SELF_MUSIC_PASSWORD:-}" ] || [ "${#SELF_MUSIC_PASSWORD}" -lt 8 ] || printf '%s' "$SELF_MUSIC_PASSWORD" | grep -qi 'replace-with'; then
  fail "Set SELF_MUSIC_PASSWORD in .env to a unique password with at least 8 characters."
fi

if [ -z "${SESSION_SECRET:-}" ] || [ "${#SESSION_SECRET}" -lt 32 ] || printf '%s' "$SESSION_SECRET" | grep -qi 'replace-with'; then
  fail "Set SESSION_SECRET in .env to a random secret with at least 32 characters."
fi

if [ -n "${TS_AUTHKEY:-}" ]; then
  printf '[SelfMusic] Tailscale admin: https://login.tailscale.com/admin/machines\n'
fi

exec node server/index.js
