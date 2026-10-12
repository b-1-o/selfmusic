#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT_DIR"

usage() {
  printf 'Usage: ./selfmusic.sh {start|stop|restart|logs|status|update|backup}\n'
}
env_value() {
  key="$1"
  grep -m 1 "^$key=" .env 2>/dev/null | cut -d '=' -f 2- | tr -d '"' | head -n 1 || true
}
copy_tree() {
  src="$1"; dest="$2"
  mkdir -p "$dest"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a -- "$src/" "$dest/"
  else
    cp -R "$src/." "$dest/"
  fi
}

action=""
if [ "$#" -gt 0 ]; then action="$1"; fi
case "$action" in
  start) docker compose up -d ;;
  stop) docker compose down ;;
  restart) docker compose restart ;;
  logs) docker compose logs -f selfmusic ;;
  status)
    docker compose ps
    printf '\nTailscale status / IP:\n'
    docker compose exec -T tailscale tailscale status 2>/dev/null || true
    docker compose exec -T tailscale tailscale ip -4 2>/dev/null || true
    ;;
  update)
    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      printf 'ERROR: update requires a Git clone. Downloaded ZIPs cannot run git pull.\n' >&2
      exit 1
    fi
    git pull --ff-only
    docker compose up -d --build
    ;;
  backup)
    stamp="$(date '+%Y%m%d-%H%M%S')"
    backup_root="$ROOT_DIR/backups/$stamp"
    mkdir -p "$backup_root" "$ROOT_DIR/data"
    music_dir="$(env_value MUSIC_HOST_DIR)"
    [ -n "$music_dir" ] || music_dir="./music"
    case "$music_dir" in
      /*) music_path="$music_dir" ;;
      *) music_path="$ROOT_DIR/$music_dir" ;;
    esac
    if [ -d "$music_path" ]; then copy_tree "$music_path" "$backup_root/music"; fi
    if [ -d "$ROOT_DIR/data" ]; then copy_tree "$ROOT_DIR/data" "$backup_root/data"; fi
    printf 'Backup saved to %s\n' "$backup_root"
    ;;
  *) usage; exit 2 ;;
esac
