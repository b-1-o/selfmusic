#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
DATA_DIR="$ROOT_DIR/data"
ENV_FILE="$ROOT_DIR/.env"
PID_FILE="$DATA_DIR/selfmusic.pid"
LOG_FILE="$DATA_DIR/selfmusic.log"
TAILSCALE_MARKER="$DATA_DIR/tailscaled-started-by-selfmusic"
mkdir -p "$DATA_DIR"

env_value() {
  local key="$1"
  grep -m 1 "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d '=' -f 2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true
}

PORT="$(env_value PORT)"
PORT="${PORT:-8787}"
LOCAL_URL="http://127.0.0.1:$PORT"
BROWSER_URL="http://localhost:$PORT"

green() { printf '\033[1;32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[1;33m%s\033[0m\n' "$1"; }
red() { printf '\033[1;31mERROR: %s\033[0m\n' "$1" >&2; }

usage() {
  cat <<'USAGE'
SelfMusic native launcher

Usage:
  selfmusic [start]        Start the server and open the browser
  selfmusic stop           Stop server and session Tailscale
  selfmusic off            Stop server and session Tailscale
  off selfmusic            Stop both if Tailscale was started by SelfMusic
  selfmusic restart        Restart the server
  selfmusic status         Show status and connection addresses
  selfmusic logs           Follow the server log
  selfmusic open           Open SelfMusic in the browser
  selfmusic remote         Try to configure HTTPS access through Tailscale
  selfmusic update         Safely pull updates, rebuild, and restart
  selfmusic backup         Copy the music and data folders to backups/
  selfmusic docker-start   Start the optional Docker deployment
  selfmusic docker-stop    Stop the optional Docker deployment
USAGE
}

server_command_matches() {
  local pid="$1" command_line
  command_line="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ "$command_line" == *"$ROOT_DIR/server/index.js"* ]]
}

get_pid() {
  local pid=""
  if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  fi
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && server_command_matches "$pid"; then
    printf '%s' "$pid"
    return 0
  fi
  rm -f "$PID_FILE"
  return 1
}

health_ok() {
  node -e 'fetch("http://127.0.0.1:" + process.argv[1] + "/api/health").then(async response => { if (!response.ok || (await response.json()).app !== "SelfMusic") process.exit(1); }).catch(() => process.exit(1))' "$PORT" >/dev/null 2>&1
}

show_addresses() {
  printf 'Local: %s\n' "$BROWSER_URL"
  if command -v tailscale >/dev/null 2>&1; then
    local ip serve_status https_url
    ip="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
    if [ -n "$ip" ]; then
      printf 'Private Tailscale address: http://%s:%s\n' "$ip" "$PORT"
      serve_status="$(tailscale serve status 2>/dev/null || true)"
      https_url="$(printf '%s\n' "$serve_status" | grep -Eo 'https://[A-Za-z0-9.-]+(:[0-9]+)?' | head -n 1 || true)"
      if [ -n "$https_url" ]; then
        printf 'Tailscale HTTPS address: %s\n' "$https_url"
      fi
    else
      yellow "Tailscale is installed but not connected. Run selfmusic to start its session service, then authenticate if prompted."
    fi
  fi
  printf 'Do not port-forward this app directly to the public internet.\n'
}

open_browser() {
  local url="$1"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 &
  else
    printf 'Open this address in your browser: %s\n' "$url"
  fi
}

start_tailscale() {
  if ! command -v tailscale >/dev/null 2>&1; then
    yellow "Tailscale is not installed; SelfMusic will still work locally. Install it from https://tailscale.com/download"
    return 0
  fi

  if [[ "$(uname -s)" != "Linux" ]]; then
    if tailscale ip -4 >/dev/null 2>&1; then return 0; fi
    yellow "Tailscale is not connected. Start the Tailscale app and sign in; SelfMusic can still work locally."
    return 0
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    yellow "systemctl is unavailable; start Tailscale manually. SelfMusic can still work locally."
    return 0
  fi

  if ! systemctl is-active --quiet tailscaled; then
    printf 'Starting Tailscale for this SelfMusic session...\n'
    if sudo systemctl start tailscaled; then
      if [ -r /proc/sys/kernel/random/boot_id ]; then
        cat /proc/sys/kernel/random/boot_id > "$TAILSCALE_MARKER"
        chmod 600 "$TAILSCALE_MARKER" 2>/dev/null || true
      fi
    else
      yellow "Could not start Tailscale. SelfMusic will still work locally."
      return 0
    fi
  fi

  if ! tailscale ip -4 >/dev/null 2>&1; then
    printf 'Connecting Tailscale; you may be asked to authenticate...\n'
    if ! sudo tailscale up; then
      yellow "Tailscale did not connect. Try 'sudo tailscale up' manually; SelfMusic will still work locally."
      return 0
    fi
  fi

  if tailscale ip -4 >/dev/null 2>&1; then
    local ts_ip
    ts_ip="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
    if [ -n "$ts_ip" ]; then green "Tailscale is connected: $ts_ip"; else green "Tailscale is connected."; fi
  else
    yellow "Tailscale service is running but no Tailscale IP is available yet."
  fi
}

stop_tailscale_if_owned() {
  [[ "$(uname -s)" == "Linux" ]] || return 0
  [ -f "$TAILSCALE_MARKER" ] || return 0

  local marker_boot current_boot
  marker_boot="$(cat "$TAILSCALE_MARKER" 2>/dev/null || true)"
  current_boot="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || true)"
  rm -f "$TAILSCALE_MARKER"

  # Ignore stale markers from a previous boot.
  [ -n "$current_boot" ] && [ "$marker_boot" = "$current_boot" ] || return 0
  command -v systemctl >/dev/null 2>&1 || return 0
  systemctl is-active --quiet tailscaled || return 0

  printf 'Stopping Tailscale started by SelfMusic...\n'
  if sudo systemctl stop tailscaled; then
    green "Tailscale stopped for this SelfMusic session."
  else
    yellow "Could not stop Tailscale; stop it manually with: sudo systemctl stop tailscaled"
  fi
}

start_server() {
  start_tailscale
  if health_ok; then
    green "SelfMusic is already running."
    show_addresses
    if [ "$NO_BROWSER" -eq 0 ]; then open_browser "$BROWSER_URL"; fi
    return 0
  fi
  if [ ! -d "$ROOT_DIR/node_modules" ]; then
    red "Dependencies are missing. Run: bash ./install.sh"
    exit 1
  fi
  if [ ! -f "$ROOT_DIR/dist/index.html" ]; then
    printf 'Production frontend build is missing; building it now...\n'
    npm run build
  fi

  if ! command -v node >/dev/null 2>&1; then
    red "Node.js is not installed or is not on PATH."
    exit 1
  fi

  printf 'Starting SelfMusic on port %s...\n' "$PORT"
  NODE_ENV=development PORT="$PORT" nohup node "$ROOT_DIR/server/index.js" >>"$LOG_FILE" 2>&1 </dev/null &
  local pid="$!"
  printf '%s\n' "$pid" > "$PID_FILE"

  local attempt
  for attempt in $(seq 1 20); do
    if health_ok; then
      green "SelfMusic is running."
      show_addresses
      if [ "$NO_BROWSER" -eq 0 ]; then open_browser "$BROWSER_URL"; fi
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      red "SelfMusic exited during startup. Recent log output:"
      tail -n 60 "$LOG_FILE" 2>/dev/null || true
      exit 1
    fi
    sleep 1
  done

  yellow "The server has not responded yet. Check logs with: selfmusic logs"
  show_addresses
  if [ "$NO_BROWSER" -eq 0 ]; then open_browser "$BROWSER_URL"; fi
}

stop_server() {
  local pid=""
  if pid="$(get_pid)"; then
    kill "$pid" 2>/dev/null || true
    local attempt
    for attempt in $(seq 1 10); do
      if ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$PID_FILE"
        green "SelfMusic stopped."
        return 0
      fi
      sleep 1
    done
    yellow "SelfMusic did not stop immediately. PID: $pid"
    return 1
  fi
  if health_ok; then
    yellow "SelfMusic responds on port $PORT, but this launcher does not own its PID. Stop the process that started it."
  else
    green "SelfMusic is not running."
  fi
}

check_git_clean() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    red "Update requires a Git clone."
    exit 1
  }
  if ! git diff --quiet || ! git diff --cached --quiet; then
    red "Local tracked changes are present. Commit or back them up before updating; SelfMusic will not overwrite them."
    exit 1
  fi
}

ACTION="${1:-start}"
NO_BROWSER=0
for arg in "$@"; do
  [ "$arg" = "--no-browser" ] && NO_BROWSER=1
done
[ "$ACTION" = "--no-browser" ] && ACTION="start"

case "$ACTION" in
  start|"") start_server ;;
  stop|off)
    stop_status=0
    stop_server || stop_status=$?
    stop_tailscale_if_owned
    exit "$stop_status"
    ;;
  restart) stop_server || true; start_server ;;
  status)
    if health_ok; then green "SelfMusic is responding."; else yellow "SelfMusic is not responding."; fi
    if pid="$(get_pid)"; then printf 'Process ID: %s\n' "$pid"; fi
    show_addresses
    ;;
  logs) touch "$LOG_FILE"; tail -n 80 -f "$LOG_FILE" ;;
  open)
    if health_ok; then open_browser "$BROWSER_URL"; else red "SelfMusic is not running. Run: selfmusic"; exit 1; fi
    ;;
  remote)
    if ! command -v tailscale >/dev/null 2>&1; then
      red "Tailscale is not installed. Install it on this computer and your phone, then sign both into the same tailnet."
      printf 'https://tailscale.com/download\n'
      exit 1
    fi
    start_tailscale
    if ! tailscale ip -4 >/dev/null 2>&1; then
      yellow "Tailscale is not connected. Run selfmusic and complete any sign-in prompt, then retry selfmusic remote."
      exit 1
    fi
    if ! health_ok; then start_server; fi
    printf 'Trying to configure private HTTPS through Tailscale Serve...\n'
    if sudo tailscale serve --bg "$PORT"; then
      sudo tailscale serve status || true
    else
      yellow "Tailscale Serve could not be configured. HTTPS needs MagicDNS and HTTPS certificates enabled in your tailnet."
      printf 'See: https://tailscale.com/docs/how-to/set-up-https-certificates\n'
      show_addresses
    fi
    ;;
  update)
    check_git_clean
    git pull --ff-only
    npm install --no-save --package-lock=false --no-audit --no-fund
    npm run build
    stop_server || true
    start_server
    ;;
  backup)
    stamp="$(date '+%Y%m%d-%H%M%S')"
    backup_root="$ROOT_DIR/backups/$stamp"
    mkdir -p "$backup_root"
    music_dir="$(env_value MUSIC_DIR)"
    [ -n "$music_dir" ] || music_dir="./music"
    case "$music_dir" in
      /*) music_path="$music_dir" ;;
      *) music_path="$ROOT_DIR/$music_dir" ;;
    esac
    [ -d "$music_path" ] && cp -R "$music_path" "$backup_root/music"
    [ -d "$ROOT_DIR/data" ] && cp -R "$ROOT_DIR/data" "$backup_root/data"
    printf 'Backup saved to %s\n' "$backup_root"
    ;;
  docker-start) docker compose up -d --build ;;
  docker-stop) docker compose down ;;
  *) usage; exit 2 ;;
esac
