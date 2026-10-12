# SelfMusic

SelfMusic is a self-hosted music server with a personal library, streaming,
and a small web player. Files stay on your own computer; you can stream them
from any device on your network or through a tunnel you control.

## Features

* Personal music library scanned from a local folder.
* Streaming with HTTP range requests (seek, resume, gapless-friendly).
* Simple playlist, favorites, and "now playing" bar.
* Upload audio files from a device through the web UI.
* Import a single track from a direct HTTPS audio URL.
* **Download a YouTube video's audio to MP3 and add it to the library.**
* Optional YouTube search using the official YouTube Data API v3.
* Password-protected server with HMAC-signed session cookies.
* One-command native setup, with optional Docker deployment and private remote access through Tailscale.

## Quick start

**Recommended: native installation.** Docker and Tailscale auth keys are not required for ordinary local use.

### Linux and macOS

1. Install Node.js 20.19+ and npm. On CachyOS / Arch, for example: `sudo pacman -S nodejs npm`.
2. Clone the repository (or extract its ZIP), open a terminal in the project directory, and run:

   ~~~~bash
   bash ./install.sh
   ~~~~

3. Start SelfMusic any day with `selfmusic`. The installer adds a desktop launcher where supported.

Useful commands:

| Command | What it does |
|---|---|
| `selfmusic` | Start the server and open the browser |
| `selfmusic stop` | Stop the server |
| `selfmusic off` | Stop the server (same as `stop`) |
| `off selfmusic` | Short command to stop SelfMusic |
| `selfmusic restart` | Restart the server |
| `selfmusic status` | Show status and connection addresses |
| `selfmusic logs` | Follow the server log |
| `selfmusic remote` | Try to configure private HTTPS through Tailscale |

### Windows

1. Install Node.js 20.19+ from <https://nodejs.org/> and reopen PowerShell.
2. In the repository directory, run:

   ~~~~powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ~~~~

3. The installer creates a **SelfMusic** desktop shortcut and a `selfmusic` command shim. Click the shortcut, or open a new PowerShell window and run `selfmusic`.

Use `selfmusic stop`, `selfmusic off`, `selfmusic restart`, `selfmusic status`, `selfmusic logs`, `selfmusic open`, or `selfmusic remote` to manage the server. The Windows installer also adds the `off` command, so `off selfmusic` stops the server without closing Windows or deleting music files.

A browser/PWA shortcut can open SelfMusic, but browser security prevents a webpage from starting a stopped local server. The desktop shortcut / `selfmusic` launcher starts the server first, then opens the browser.

### Access from your phone

For use at home, open `http://<computer-lan-ip>:8787` from a phone on the same Wi-Fi network. To listen away from home, install Tailscale on the computer and phone and sign both into the same tailnet. No reusable auth key or `tag:selfmusic` policy is needed when adding the host computer as a normal Tailscale device.

Once both devices are connected, `selfmusic status` shows the private Tailscale address. Run `selfmusic remote` to try configuring Tailscale Serve HTTPS. HTTPS Serve requires MagicDNS and HTTPS certificates enabled in the tailnet admin console. The direct Tailscale-IP URL uses HTTP at the browser level, although traffic between Tailscale devices is encrypted by Tailscale; HTTPS is preferred for installable PWA/service-worker features.

The host computer must remain powered on, awake, and connected to the internet while you listen remotely. Do not port-forward SelfMusic directly to the public internet. The same-Wi-Fi LAN URL is plain HTTP, so use it only on a trusted home network; prefer the Tailscale path while away from home.

## Optional: Docker deployment (advanced)

1. Create a local configuration file and edit it:

   ```bash
   cp .env.example .env
   ```

   Set `SELF_MUSIC_PASSWORD` to a unique password of at least 12 characters, set `SESSION_SECRET` to a random secret of at least 32 characters, and add a reusable `TS_AUTHKEY` created at <https://login.tailscale.com/admin/settings/keys>. Allow `tag:selfmusic` in your tailnet policy. Never commit `.env`.

2. Place audio files in the host folder configured by `MUSIC_HOST_DIR` (defaults to `./music`). Create the data directory and start the stack:

   ```bash
   mkdir -p music data
   docker compose up -d --build
   ```

3. Get the Tailscale IP and logs if necessary:

   ```bash
   docker compose exec tailscale tailscale ip -4
   docker compose logs -f selfmusic
   ```

There is no published host port by default. To use direct LAN access instead of Tailscale, follow the comments in `docker-compose.yml`; remove the shared-network settings and do not expose the service directly to the public internet.

The Compose setup keeps music in the host-mounted `MUSIC_HOST_DIR`, data in `./data`, and the Tailscale identity in a named volume. The YouTube download route is not changed by this deployment work. To use `cookies.txt` in Docker, create the file beside `.env` and uncomment the optional read-only mount in `docker-compose.yml`. Treat exported cookies as credentials.

## Manual development (advanced)

Use this section when developing the app or when you prefer to start Node.js manually instead of using the native launcher.

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/b-1-o/selfmusic.git
   cd selfmusic
   npm install
   ```

2. Create `.env` from `.env.example` and set at least:

   ```
   SELF_MUSIC_PASSWORD=your-strong-password-here
   SESSION_SECRET=replace-with-a-random-string-of-at-least-32-characters
   MUSIC_DIR=music
   PORT=8787

   # Optional
   YOUTUBE_API_KEY=
   YOUTUBE_MAX_DURATION_SECONDS=3600
   ```

   * **SELF_MUSIC_PASSWORD:** login password for the web UI; at least 12
     characters.
   * **SESSION_SECRET:** random string of 32+ characters; keeps sessions
     valid across server restarts. Generate with
     `openssl rand -hex 32`.
   * **MUSIC_DIR:** folder scanned for audio files, relative to the project
     root or an absolute path.
   * **PORT:** HTTP port for the server.
   * **YOUTUBE_API_KEY:** optional; enables YouTube search on the Explore
     page.
   * **YOUTUBE_MAX_DURATION_SECONDS:** optional; maximum length in seconds
     for a YouTube download (default 3600 = 60 minutes).

3. Run in development:

   ```bash
   npm run dev
   ```

   The Vite dev server runs on `http://localhost:5173` and proxies API calls
   to the Node server on `http://localhost:8787`.

4. Build for production and run:

   ```bash
   npm run build
   NODE_ENV=development npm start
   ```

   The Node server serves the built frontend and the API on the same port.

## Requirements

* **Node.js** 20.19 or later for native installation.
* **npm** (included with Node.js).
* A music folder on the same machine as the server.
* For **YouTube → MP3 downloads**: `yt-dlp` and `ffmpeg` installed on the
  server (see the YouTube section below).

## Music folder layout

SelfMusic scans `MUSIC_DIR` recursively. Subfolders become albums (or
artist/album paths); the leaf filename becomes the track title. Supported
extensions:

```
.mp3  .m4a  .aac  .flac  .wav  .ogg  .opus  .webm
```

Cover art is picked from the same folder as the track, using the first file
found among:

```
cover.webp  cover.jpg  cover.jpeg  cover.png
folder.webp folder.jpg folder.jpeg folder.png
```

Everything you upload or download through the web UI lands in
`MUSIC_DIR/Uploads`.

## Importing music

### Upload audio files

Choose up to 20 audio files at once from your device. Each file can be up to
250 MB. Files are streamed to the server and saved directly to
`MUSIC_DIR/Uploads`.

### Import by direct audio URL (legacy)

The Import music page also accepts a direct HTTPS URL that returns an audio
file. Paste a download URL — for example, a public MP3/FLAC download URL
from a creator or store that permits saving the file — then choose
**Import URL**. The server downloads it to `MUSIC_DIR/Uploads` and refreshes
the library.

For safety, the importer only follows a small number of HTTPS redirects,
rejects local/private IP addresses, checks the resolved public hostname on
each redirect, accepts supported audio formats only, and limits downloads
to 250 MB. It does not accept arbitrary web pages or links that require
interactive sign-in/cookies. A URL must be a direct downloadable audio
asset that you are authorized to save. Some providers use expiring or
protected links, so not every URL will work.

**For YouTube links, see the next section instead.**

## YouTube

SelfMusic has two separate YouTube features.

### 1. Search and watch (Explore YouTube)

The **Explore YouTube** page searches embeddable videos through the
official YouTube Data API v3 and plays a selected result in YouTube's
visible embedded player. Search results are only kept in page memory; the
server does not cache or save audiovisual content. To enable search:

1. Create an API key in the
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Enable **YouTube Data API v3** for that project.
3. Put the key in the home server's local `.env` file as
   `YOUTUBE_API_KEY=your-key`.
4. Restrict the key to the YouTube Data API v3 where possible, then restart
   SelfMusic.

Keep this key on the server; do not put it in React or commit it to GitHub.

### 2. Download audio as MP3

In the Docker setup, yt-dlp and ffmpeg are already installed inside the container.

The **Import music** page can save the audio track of a YouTube video to
your library as an MP3 file. SelfMusic also downloads the video's thumbnail
as a matching JPG sidecar and embeds it into the MP3 when supported, so the
track shows its own cover instead of the generic app icon. This is useful
for archiving podcasts, talks, or music you are allowed to keep.

**Requirements**

* `yt-dlp` installed on the server:
  * **Arch / CachyOS:** `sudo pacman -S yt-dlp`
  * **Debian / Ubuntu:** `sudo apt install yt-dlp`
  * **macOS:** `brew install yt-dlp`
* **FFmpeg** (needed by `yt-dlp` for MP3 conversion):
  * **Arch / CachyOS:** `sudo pacman -S ffmpeg`
  * **Debian / Ubuntu:** `sudo apt install ffmpeg`
  * **macOS:** `brew install ffmpeg`
  * **Windows:** install FFmpeg and ensure `ffmpeg.exe` is on `PATH`. The same applies to `yt-dlp.exe`.

**How to use it**

1. Open the **Import music** page.
2. In the **Download from YouTube** panel, paste a link such as
   `https://www.youtube.com/watch?v=...` or `https://youtu.be/...`.
3. Click **Download MP3**. The file is saved to `MUSIC_DIR/Uploads` and
   appears in your library right away.

Only `youtube.com`, `m.youtube.com`, `music.youtube.com`,
`youtube-nocookie.com`, and `youtu.be` hosts are accepted. Duration is
limited by `YOUTUBE_MAX_DURATION_SECONDS`.

**Optional: cookies for age-restricted or bot-checked videos**

YouTube sometimes requires a signed-in session. To handle those cases:

1. Install a browser extension such as **Get cookies.txt LOCALLY**.
2. Sign in to YouTube in the browser.
3. Export cookies in **Netscape** format.
4. Save the file as `cookies.txt` in the project root (next to `.env`).
5. Restart the server. SelfMusic picks up the file automatically.

**Never commit `cookies.txt`** — it is already listed in `.gitignore`.

**Legal note**

Only download content you are allowed to keep. Respect YouTube's Terms of
Service and local copyright law.

## Remote access with Tailscale

### Native installation (recommended)

1. Install Tailscale on the host computer and your phone: <https://tailscale.com/download>.
2. Sign both devices into the same Tailscale account / tailnet. The host uses the regular Tailscale client; you do **not** need a reusable auth key or `tag:selfmusic` policy for this normal device setup.
3. Start SelfMusic on the host and run `selfmusic remote` (Linux/macOS) or `selfmusic remote` in PowerShell (Windows). The launcher tries to configure Tailscale Serve and prints the connection status.

Tailscale Serve HTTPS requires MagicDNS and HTTPS certificates to be enabled in the tailnet admin console. See <https://tailscale.com/docs/how-to/set-up-https-certificates>. Tailscale notes that enabling HTTPS certificates publishes device and tailnet DNS names in a public certificate-transparency log, so review that choice before enabling it.

If you don't configure Serve, the private Tailscale IP can still be used as `http://<tailscale-ip>:8787`. That HTTP URL is encrypted across Tailscale's network tunnel, but a browser may treat it as an insecure origin and restrict PWA/service-worker features. Prefer the HTTPS Serve URL when available.

### Optional Docker deployment

The Docker Compose deployment runs a Tailscale sidecar and does use an auth key:

1. Create a reusable key from <https://login.tailscale.com/admin/settings/keys> and allow `tag:selfmusic` in the tailnet policy. Store it as `TS_AUTHKEY` in `.env`; never share or commit that file.
2. Install Tailscale on the phone and sign in to the same tailnet.
3. Get the address and (optionally) enable HTTPS:

   ~~~~bash
   docker compose exec tailscale tailscale ip -4
   docker compose exec tailscale tailscale serve --bg 8787
   docker compose exec tailscale tailscale serve status
   ~~~~

Keep the `tailscale-state` volume: it stores the container node's identity. Do not publish port 8787 to the public internet, and keep the SelfMusic password enabled as a second layer.

## Security notes

* Passwords are compared in constant time after SHA-256 hashing.
* Sessions use an HMAC-signed cookie with an expiry timestamp and are valid
  for 7 days.
* Login attempts are rate limited per IP address.
* Upload paths are sanitized and kept inside `MUSIC_DIR/Uploads`.
* Direct URL import and YouTube download never run as root and never accept
  remote filenames as filesystem paths.
* The server binds to `0.0.0.0`, so put it behind a reverse proxy with TLS
  if you expose it beyond your local network.

## Current limitations

* No user accounts — a single shared password protects the whole library.
* Streaming uses the source file's original codec; transcode-on-the-fly for
  very large or unsupported formats is not implemented.
* File upload supports up to 20 files per batch and 250 MB per file.
  Direct URL import supports one direct HTTPS audio link at a time, up to
  250 MB. YouTube download also produces one MP3 per request, up to
  `YOUTUBE_MAX_DURATION_SECONDS` (default 60 minutes).
* Metadata/tag extraction and duplicate-content detection are not
  implemented yet.
* Native YouTube-to-MP3 imports require `yt-dlp` and `ffmpeg` available on `PATH` (or an explicit `YT_DLP_PATH` pointing to the downloader). The native launcher works on Windows/macOS/Linux; the optional Docker image includes the downloader and FFmpeg.
* No playlist persistence beyond the in-memory queue and favorites.
* Docker build requires roughly 500 MB of disk space for the image and build cache.

## Troubleshooting

* **A port is already in use:** SelfMusic does not publish host ports by default. If you enable the optional LAN mapping, stop the other service using 8787 or pick another host port.
* **yt-dlp fails or YouTube behaviour changes:** rebuild the image with `docker compose up -d --build`, then inspect `docker compose logs -f selfmusic`. Only download content you have permission to save.
* **Tailscale does not connect:** verify `TS_AUTHKEY`, check that the key is permitted to use `tag:selfmusic`, and ensure the phone is signed in to the same tailnet. Inspect `docker compose logs -f tailscale` and `docker compose exec tailscale tailscale status`.
* **A YouTube download fails for a video requiring a signed-in session:** verify that `cookies.txt` is a valid Netscape-format export and mounted read-only into `/app/cookies.txt`. Cookies are sensitive credentials; never commit or share them.
* **The site cannot be reached remotely:** confirm both devices are connected in Tailscale and the home server is online. Try the printed Tailscale IP to separate a MagicDNS issue from a connection issue.
* **Setup rejects credentials:** edit `.env`; the password must have at least 12 characters and `SESSION_SECRET` at least 32. Restart with `docker compose up -d`.

## Project layout

```
.
├── server/
│   └── index.js              # Express API, authentication, audio streaming and YouTube routes
├── src/
│   └── App.jsx               # React client, library, player and import panels
├── public/                   # PWA manifest, service worker and icons
├── music/                    # Default host music directory
├── data/                     # Persisted application data / future data files
├── backups/                  # Local backups created by selfmusic.sh
├── Dockerfile                # Multi-stage production image
├── docker-compose.yml        # SelfMusic + Tailscale sidecar
├── docker-entrypoint.sh      # Runtime checks and process handoff
├── install.sh                # Native Linux/macOS installer; creates selfmusic command
├── install.ps1               # Native Windows installer; creates desktop shortcut
├── selfmusic.sh              # Native Linux/macOS commands plus optional Docker controls
├── selfmusic.ps1              # Windows start/stop/status/logs/remote commands
├── selfmusic.cmd              # Windows command wrapper
├── .dockerignore
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## License

MIT. See `LICENSE` if present.
