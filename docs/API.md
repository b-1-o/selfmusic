# SelfMusic HTTP API

This document describes the API shipped with SelfMusic. The web client and API are served by the same Express process; by default it runs at http://localhost:8787. Use HTTPS when accessing the server outside a trusted LAN, for example through Tailscale Serve.

## Authentication and roles

Most endpoints require a session cookie. Sign in with either the legacy shared password or a managed account.

```bash
BASE_URL="http://localhost:8787"

# Legacy owner login
curl -i -c session-cookies.txt -H 'Content-Type: application/json' \
  -d '{"password":"replace-with-your-server-password"}' \
  "$BASE_URL/api/auth/login"

# Managed account login
curl -i -c session-cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"erik","password":"replace-with-a-unique-account-password"}' \
  "$BASE_URL/api/auth/login"

curl -b session-cookies.txt "$BASE_URL/api/auth/profile"
curl -b session-cookies.txt "$BASE_URL/api/auth/session"
curl -b session-cookies.txt -X POST "$BASE_URL/api/auth/logout"
```

Managed accounts have unique passwords of 12–128 characters. Usernames are 3–32 characters using letters, numbers, dot, underscore or hyphen. Administrators create accounts. On a fresh database, BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD create the initial administrator if a password of 12–128 characters is provided. Keep a persistent SESSION_SECRET of at least 32 characters.

| Capability | admin | user |
|---|---:|---:|
| Browse/search library and stream audio | Yes | Yes |
| Personal playlists, favorites and history | Yes | Yes |
| Connect a personal Last.fm account | Yes | Yes |
| Upload/import/delete source audio | Yes | No |
| Download/convert YouTube audio | Yes | No |
| Manage users, library scans and duplicate files | Yes | No |

Mutating requests are checked against their origin. API requests are rate-limited. Session cookies are HTTP-only and expire after seven days.

## Library, metadata and streaming

- GET /api/tracks — indexed track list; preserves the existing { "tracks": [...], "truncated": false } response.
- GET /api/artists — artists with trackCount and albumCount.
- GET /api/albums — albums; optionally filter with ?artistId=<id>.
- GET /api/search?q=<text> — metadata search over title, artist, album, album artist and genre. Query length must be 1–100 characters.
- GET /api/artwork/:trackId — embedded cover or supported folder artwork.
- GET /api/stream/:trackId — original audio with HTTP Range support.
- GET /api/stream/:trackId?format=mp3&bitrate=128k — optional FFmpeg transcoding. Formats: mp3, opus, aac. Allowed bitrates: 32k, 48k, 64k, 96k, 112k, 128k, 160k, 192k, 224k, 256k, 320k.
- GET /api/player/settings — transcoding state and supported choices.
- POST /api/library/scan — admin-only forced rescan.
- GET /api/duplicates — admin review list grouped by identical SHA-256.
- POST /api/duplicates/merge — admin-only merge. Provide a keeper ID and an array of duplicate IDs; favorites, playlists and listening history are reassigned before duplicate files are removed.
- DELETE /api/duplicates/:trackId — admin-only permanent deletion of one indexed file.

```bash
curl -b session-cookies.txt "$BASE_URL/api/tracks"
curl -b session-cookies.txt "$BASE_URL/api/artists"
curl -b session-cookies.txt "$BASE_URL/api/albums"
curl -G -b session-cookies.txt --data-urlencode 'q=moonlight' "$BASE_URL/api/search"
curl -b session-cookies.txt -H 'Range: bytes=0-1023' \
  -D - "$BASE_URL/api/stream/<track-id>" -o /dev/null

# Enable TRANSCODE_ENABLED=true in .env first.
curl -b session-cookies.txt -D - \
  "$BASE_URL/api/stream/<track-id>?format=opus&bitrate=128k" -o sample.opus

curl -b session-cookies.txt -H 'Content-Type: application/json' \
  -d '{"keepId":"<track-id-1>","duplicateIds":["<track-id-2>"]}' \
  "$BASE_URL/api/duplicates/merge"
```

Track IDs are opaque API identifiers. Do not build filesystem paths from client input. Transcoding is disabled by default; set TRANSCODE_ENABLED=true and install FFmpeg to enable it. Transcodes are cached under TRANSCODE_CACHE_DIR.

## Playlists, favorites and history

- GET /api/playlists and POST /api/playlists with {"name":"Road Trip"}.
- GET/PATCH/DELETE /api/playlists/:id.
- POST /api/playlists/:id/tracks accepts {"trackId":"..."} or {"trackIds":["..."]}.
- DELETE /api/playlists/:id/tracks/:trackId removes an entry.
- PATCH /api/playlists/:id/tracks/order accepts the complete ordered {"trackIds":["...","..."]} list.
- GET /api/playlists/:id/export.m3u downloads an M3U file.
- POST /api/playlists/import.m3u accepts {"name":"Imported","content":"#EXTM3U\n..."}.
- GET /api/playlists/smart/recently-added, /api/playlists/smart/frequently-played, or /api/playlists/smart/recently-played.
- GET /api/favorites, POST /api/favorites/:trackId, DELETE /api/favorites/:trackId.
- POST /api/history accepts {"trackId":"...","positionSeconds":23}; GET /api/history?limit=50 returns recent plays for the signed-in user.

M3U import only matches entries against indexed library paths or an unambiguous basename; it never opens arbitrary paths from a submitted playlist.

```bash
curl -b session-cookies.txt -H 'Content-Type: application/json' \
  -d '{"name":"Road Trip","description":"Favorites for driving"}' \
  "$BASE_URL/api/playlists"

curl -b session-cookies.txt -H 'Content-Type: application/json' \
  -d '{"trackId":"<track-id>"}' \
  "$BASE_URL/api/playlists/<playlist-id>/tracks"

curl -b session-cookies.txt \
  "$BASE_URL/api/playlists/<playlist-id>/export.m3u" -o road-trip.m3u
```

## Users and administration

- GET /api/auth/profile — current user and role.
- POST /api/auth/register — admin-only; accepts {"username":"...","password":"...","role":"user"}.
- GET /api/admin/users; PATCH /api/admin/users/:userId with {"role":"user"} or {"role":"admin"}; DELETE /api/admin/users/:userId.
- POST /api/upload — admin-only multipart field files; up to 20 supported audio files per request and 250 MB per file.
- POST /api/import-url — admin-only direct HTTPS audio import. Resolved hostnames/IPs are validated to guard against SSRF.
- DELETE /api/tracks/:trackId — admin-only permanent source-file deletion.

Passwords are stored as scrypt hashes. Integration credentials such as Last.fm session keys and the encrypted Subsonic credential are protected with AES-256-GCM using a key derived from SESSION_SECRET.

## YouTube search and downloads

The official YouTube Data API v3 is used for search and duration metadata only. Actual audio conversion runs on the server using yt-dlp and FFmpeg.

- GET /api/youtube/search?q=<query> — returns items containing videoId, title, channelTitle, description, thumbnail and duration. Results are cached in server memory for YOUTUBE_CACHE_TTL_SECONDS.
- POST /api/youtube/download — backward-compatible synchronous mode remains available; send {"url":"https://youtu.be/...","async":true,"bitrate":"192k","metadata":{"title":"...","artist":"..."}} for queue/progress (HTTP 202).
- POST /api/youtube/jobs — asynchronous job endpoint (admin-only).
- GET /api/youtube/status/:jobId — poll job state; response includes status, phase (metadata, download, conversion, indexing, completed, or failed), progress, title, trackId, result or error. Send Accept: text/event-stream to receive progress updates as SSE.

```bash
curl -b session-cookies.txt -G --data-urlencode 'q=public domain jazz' \
  "$BASE_URL/api/youtube/search"

curl -b session-cookies.txt -H 'Content-Type: application/json' \
  -d '{"url":"https://youtu.be/<video-id>","async":true,"bitrate":"192k"}' \
  "$BASE_URL/api/youtube/download"

curl -N -b session-cookies.txt -H 'Accept: text/event-stream' \
  "$BASE_URL/api/youtube/status/<job-uuid>"
```

Jobs are persisted in SQLite and resumed after restart. The queue is intentionally small to limit CPU and bandwidth spikes. Queued downloads accept YouTube video URLs only; channel and playlist URLs are rejected. The requesting account must have the admin role.

**Legal warning:** download YouTube audio only from videos you own or for which you have permission from the rights holder. The user is responsible for complying with YouTube's Terms of Service and applicable copyright law.

## Last.fm

Configure LASTFM_API_KEY, LASTFM_API_SECRET and LASTFM_CALLBACK_URL in .env. Each user connects their own account:

- GET /api/lastfm/status
- POST /api/lastfm/connect returns the authorization URL.
- GET /api/lastfm/callback finalizes authorization for the signed-in user.
- DELETE /api/lastfm/connect disconnects the account.
- POST /api/lastfm/now-playing publishes the current track.
- POST /api/lastfm/scrobble queues eligible plays. A track becomes eligible after more than half its duration or more than four minutes. Queue entries are retried if Last.fm is unavailable.

## PWA, Media Session and offline playback

The client registers the service worker in production and uses the web app manifest for installation. The player exposes Media Session metadata and play/pause/previous/next/seek actions on compatible browsers.

Offline audio is a client feature rather than a separate API endpoint. While signed in and online, use the download icon next to a track to save the full audio response in the browser's Cache API. The Offline Downloads screen shows saved items and allows removing their local copies. Saved audio is served through an internal service-worker route; normal private `/api/*` responses are not added to the generic application cache.

Offline copies are scoped to the browser/device and may be evicted by the browser or operating system. Signing out purges that browser's offline audio cache for privacy. Offline copies are not synchronized to other devices and are not part of the server's SQLite or music-folder backups. The server-side playback queue/current position is not synchronized between phone and desktop yet. Background playback and lock-screen controls depend on the target browser/OS and require a real-device smoke test.

## Subsonic-compatible API

JSON endpoints are available at /rest/<method>.view. For token/salt authentication, t = MD5(password + salt), where salt is a random string. Standard direct-password parameter p is also supported; token/salt is preferable.

Supported method names:
ping, getLicense, getMusicFolders, getIndexes, getArtists, getArtist, getAlbum, getSong, stream, download, getPlaylists, getPlaylist, createPlaylist, updatePlaylist, deletePlaylist, search3, scrobble, star, unstar, getStarred2.

```bash
SALT=$(openssl rand -hex 8)
TOKEN=$(printf '%s%s' "$SUBSONIC_PASSWORD" "$SALT" | md5sum | awk '{print $1}')
curl "$BASE_URL/rest/ping.view?u=$SUBSONIC_USER&t=$TOKEN&s=$SALT&v=1.16.1&c=curl&f=json"
```

The Subsonic layer provides a minimal compatibility surface, not a guarantee of support for every client extension. The download method is admin-only; regular users can stream.

