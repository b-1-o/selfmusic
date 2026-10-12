#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
BIN_DIR="$HOME/.local/bin"

green() { printf '\033[1;32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[1;33m%s\033[0m\n' "$1"; }
red() { printf '\033[1;31mERROR: %s\033[0m\n' "$1" >&2; }

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  red "Node.js 20.19+ and npm are required for native installation."
  case "$(uname -s 2>/dev/null || true)" in
    Darwin*) printf 'Install Node.js from https://nodejs.org/ or with Homebrew.\n' ;;
    *) printf 'CachyOS / Arch: sudo pacman -S nodejs npm\n'; printf 'Other Linux: https://nodejs.org/en/download\n' ;;
  esac
  exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 19) ? 0 : 1)'; then
  red "Detected Node.js $(node --version); SelfMusic requires Node.js 20.19 or later."
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  [ -f "$ROOT_DIR/.env.example" ] || { red ".env.example is missing."; exit 1; }
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  green "Created .env from .env.example"
else
  printf 'Found existing .env; existing settings will be preserved.\n'
fi

env_value() {
  local key="$1"
  grep -m 1 "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d '=' -f 2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true
}

write_env_value() {
  local key="$1" value="$2" tmp_file
  tmp_file="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { written = 0 }
    index($0, key "=") == 1 {
      if (!written) { print key "=" value; written = 1 }
      next
    }
    { print }
    END { if (!written) print key "=" value }
  ' "$ENV_FILE" > "$tmp_file"
  cat "$tmp_file" > "$ENV_FILE"
  rm -f "$tmp_file"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
}

needs_value() {
  local value="$1" min_len="$2"
  [ "${#value}" -lt "$min_len" ] || printf '%s' "$value" | grep -qi 'replace-with'
}

password="$(env_value SELF_MUSIC_PASSWORD)"
if [ -z "$password" ] || needs_value "$password" 12; then
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
if [ -z "$session_secret" ] || needs_value "$session_secret" 32; then
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

music_dir="$(env_value MUSIC_DIR)"
[ -n "$music_dir" ] || { music_dir="./music"; write_env_value MUSIC_DIR "$music_dir"; }
case "$music_dir" in
  /*) mkdir -p "$music_dir" ;;
  *) mkdir -p "$ROOT_DIR/$music_dir" ;;
esac
mkdir -p "$ROOT_DIR/data"

printf '\nInstalling Node dependencies...\n'
cd "$ROOT_DIR"
npm install
printf '\nBuilding SelfMusic...\n'
npm run build

mkdir -p "$BIN_DIR"
printf '#!/usr/bin/env bash\nexec /bin/bash %q/selfmusic.sh "$@"\n' "$ROOT_DIR" > "$BIN_DIR/selfmusic"
chmod 755 "$BIN_DIR/selfmusic"

if command -v fish >/dev/null 2>&1; then
  fish -c 'fish_add_path -U "$HOME/.local/bin"' >/dev/null 2>&1 || true
fi
PROFILE_FILE="$HOME/.profile"
if [ "$(uname -s)" = "Darwin" ]; then PROFILE_FILE="$HOME/.zprofile"; fi
if ! grep -Fq '# SelfMusic user-bin PATH' "$PROFILE_FILE" 2>/dev/null; then
  printf '\n# SelfMusic user-bin PATH\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$PROFILE_FILE"
fi

if [ "$(uname -s)" != "Darwin" ]; then
  APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$APP_DIR"
  APP_ENTRY="$APP_DIR/selfmusic.desktop"
  cat > "$APP_ENTRY" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=SelfMusic
Comment=Start your personal music server
Exec=/bin/bash "$ROOT_DIR/selfmusic.sh" start
Icon=audio-x-generic
Terminal=true
Categories=AudioVideo;Audio;Player;
EOF
  chmod 755 "$APP_ENTRY"

  DESKTOP_DIR=""
  if command -v xdg-user-dir >/dev/null 2>&1; then
    DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
  fi
  [ -n "$DESKTOP_DIR" ] || DESKTOP_DIR="$HOME/Desktop"
  if [ -d "$DESKTOP_DIR" ]; then
    cp "$APP_ENTRY" "$DESKTOP_DIR/SelfMusic.desktop"
    chmod 755 "$DESKTOP_DIR/SelfMusic.desktop"
    green "Created a SelfMusic desktop shortcut."
  fi
fi

green "Native SelfMusic setup completed. Docker is not required."
printf '\nDaily use:\n'
printf '  selfmusic         Start SelfMusic and open the browser\n'
printf '  selfmusic stop    Stop the server\n'
printf '  selfmusic status  Show status and connection addresses\n'
printf '  selfmusic logs    Follow server logs\n'
printf '  selfmusic remote  Configure private HTTPS access through Tailscale\n'

if command -v tailscale >/dev/null 2>&1; then
  printf '\nTailscale CLI detected. To allow remote access, sign this computer and your phone into the same tailnet.\n'
  printf 'Run "selfmusic remote" after starting the server to try enabling HTTPS Serve.\n'
else
  printf '\nRemote access is optional. Install Tailscale on this computer and your phone, then sign in to the same account:\n'
  printf 'https://tailscale.com/download\n'
fi

if ! command -v yt-dlp >/dev/null 2>&1 || ! command -v ffmpeg >/dev/null 2>&1; then
  yellow "YouTube-to-MP3 imports need yt-dlp and ffmpeg. On CachyOS / Arch: sudo pacman -S yt-dlp ffmpeg"
fi

printf '\nStart now with: selfmusic\n'
