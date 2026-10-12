#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT_DIR"
ENV_FILE="$ROOT_DIR/.env"

green() { printf '\033[1;32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[1;33m%s\033[0m\n' "$1"; }
red() { printf '\033[1;31mERROR: %s\033[0m\n' "$1" >&2; }

detect_os() {
  case "$(uname -s 2>/dev/null || printf unknown)" in
    Linux*)
      if grep -qi microsoft /proc/version 2>/dev/null; then printf 'Windows via WSL';
      else printf 'Linux'; fi ;;
    Darwin*) printf 'macOS' ;;
    MINGW*|MSYS*|CYGWIN*) printf 'Windows via Git Bash' ;;
    *) printf 'unknown OS' ;;
  esac
}

docker_help() {
  red "Docker with the Compose plugin is required."
  case "$(detect_os)" in
    Linux|*"WSL"*) printf 'Install Docker Engine: https://docs.docker.com/engine/install/\n' ;;
    macOS|*"Git Bash"*) printf 'Install Docker Desktop: https://www.docker.com/products/docker-desktop/\n' ;;
    *) printf 'Docker install guide: https://docs.docker.com/get-docker/\n' ;;
  esac
  printf 'Compose installation guide: https://docs.docker.com/compose/install/\n'
}

command -v docker >/dev/null 2>&1 || { docker_help; exit 1; }
docker compose version >/dev/null 2>&1 || { docker_help; exit 1; }

os_name="$(detect_os)"
green "SelfMusic setup — $os_name"

if [ ! -f "$ENV_FILE" ]; then
  [ -f "$ROOT_DIR/.env.example" ] || { red ".env.example is missing."; exit 1; }
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  green "Created .env from .env.example"
else
  printf 'Found existing .env; valid settings will be preserved.\n'
fi

env_value() {
  key="$1"
  grep -m 1 "^$key=" "$ENV_FILE" 2>/dev/null | cut -d '=' -f 2- || true
}

write_env_value() {
  key="$1"
  value="$2"
  tmp_file="$ENV_FILE.tmp.$$"
  awk -v key="$key" -v value="$value" '
    BEGIN { written = 0 }
    index($0, key "=") == 1 {
      if (!written) { print key "=" value; written = 1 }
      next
    }
    { print }
    END { if (!written) print key "=" value }
  ' "$ENV_FILE" > "$tmp_file"
  mv "$tmp_file" "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
}

needs_value() {
  value="$1"
  min_len="$2"
  [ "${#value}" -lt "$min_len" ] || printf '%s' "$value" | grep -qi 'replace-with'
}

password="$(env_value SELF_MUSIC_PASSWORD)"
if needs_value "$password" 12 || [ -z "$password" ]; then
  while :; do
    printf 'Choose a SelfMusic password (12+ characters; input hidden): '
    IFS= read -r -s password
    printf '\nConfirm password: '
    IFS= read -r -s password_confirm
    printf '\n'
    [ "$password" = "$password_confirm" ] || { yellow "Passwords did not match; try again."; continue; }
    [ "${#password}" -ge 12 ] || { yellow "Use at least 12 characters."; continue; }
    break
  done
  write_env_value SELF_MUSIC_PASSWORD "$password"
  unset password password_confirm
else
  green "Keeping the existing SelfMusic password."
fi

session_secret="$(env_value SESSION_SECRET)"
if needs_value "$session_secret" 32 || [ -z "$session_secret" ]; then
  if command -v openssl >/dev/null 2>&1; then
    session_secret="$(openssl rand -hex 32)"
  else
    session_secret="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  fi
  [ "${#session_secret}" -ge 32 ] || { red "Could not generate SESSION_SECRET."; exit 1; }
  write_env_value SESSION_SECRET "$session_secret"
  green "Generated a new SESSION_SECRET."
  unset session_secret
else
  green "Keeping the existing SESSION_SECRET."
fi

ts_key="$(env_value TS_AUTHKEY)"
if [ -z "$ts_key" ] || printf '%s' "$ts_key" | grep -qi 'replace-with'; then
  printf '\nCreate a reusable Tailscale auth key at:\nhttps://login.tailscale.com/admin/settings/keys\n'
  printf 'Allow tag:selfmusic in your tailnet policy. Paste the key (input hidden): '
  IFS= read -r -s ts_key
  printf '\n'
  if [ -z "$ts_key" ]; then
    red "TS_AUTHKEY is required for remote access. Re-run this script after creating a key."
    exit 1
  fi
  write_env_value TS_AUTHKEY "$ts_key"
  unset ts_key
else
  green "Keeping the existing Tailscale auth key."
fi

music_host_dir="$(env_value MUSIC_HOST_DIR)"
[ -n "$music_host_dir" ] || music_host_dir="./music"
case "$music_host_dir" in
  /*) mkdir -p "$music_host_dir" ;;
  *) mkdir -p "$ROOT_DIR/$music_host_dir" ;;
esac
mkdir -p "$ROOT_DIR/data"

printf '\nBuilding and starting SelfMusic + Tailscale…\n'
docker compose up -d --build

printf '\n'
green "SelfMusic containers started."
printf 'Install Tailscale on your phone and sign in to the same tailnet:\n'
printf 'https://tailscale.com/download\n'
printf '\n'
printf 'Waiting for the Tailscale address'
ts_ip=""
attempt=0
while [ "$attempt" -lt 8 ]; do
  ts_ip="$(docker compose exec -T tailscale tailscale ip -4 2>/dev/null | head -n 1 || true)"
  [ -n "$ts_ip" ] && break
  printf '.'
  sleep 2
  attempt=$((attempt + 1))
done
printf '\n'
if [ -n "$ts_ip" ]; then
  printf 'Open on your phone: http://%s:8787\n' "$ts_ip"
  printf 'Or, if MagicDNS is enabled: http://selfmusic:8787\n'
else
  yellow "Tailscale is still connecting. Check status with: ./selfmusic.sh status"
  printf 'Logs: docker compose logs -f tailscale\n'
fi
printf 'Sign in with the SelfMusic password you set above. Keep this computer running for remote playback.\n'
printf 'To add the app: open the address in your phone browser, then choose Add to Home Screen / Install app.\n'
