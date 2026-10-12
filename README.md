# SelfMusic

SelfMusic is a personal, self-hosted music player. Your music files stay on your own computer; the phone or browser acts as a remote player.

**Current status:** early MVP (0.1.0). This repository contains the first working app skeleton, server authentication, folder scanning, byte-range audio streaming, a responsive web player, and an installable PWA shell. It has not yet been tested on every phone/browser combination.

## What is included

- Mobile-first web player with play/pause, previous/next, seeking, volume, shuffle, repeat, and liked tracks.
- Media Session integration for track metadata and lock-screen / headset controls when supported by the browser and operating system.
- Node.js server that scans a music folder and streams files with HTTP Range support.
- Password-protected library and audio endpoints, signed session cookies, login throttling, and basic security headers.
- Responsive interface and PWA manifest. Static app-shell assets can be cached; audio and authenticated API responses are deliberately not cached.
- Album-folder artwork when a file named **cover.jpg**, **cover.jpeg**, **cover.png**, **cover.webp**, **folder.jpg**, **folder.jpeg**, **folder.png**, or **folder.webp** sits alongside tracks.

## Important architecture notes

A browser page cannot silently become a persistent server process, open an arbitrary listening port, or browse any folder on your computer without permission. For that reason, SelfMusic has two parts:

1. **Home server:** a small Node.js process runs on the computer/NAS that stores your audio. Node.js is available for Windows, macOS, and Linux.
2. **Web client:** open the web app from your phone or another computer. Install it to the home screen where the platform supports it.

The server must be running and the home computer must have internet access for remote streaming. A phone and server do **not** need to be on the same Wi-Fi once remote access is configured.

## Requirements

- Node.js 20.19 or later and npm.
- Your own audio files that you are allowed to store and play.
- For remote listening: a private network overlay such as Tailscale, or an HTTPS tunnel with an access policy.

## Run the home server

### 1. Get the code and install dependencies

~~~sh
git clone https://github.com/b-1-o/selfmusic.git
cd selfmusic
npm install
~~~

### 2. Create your configuration

On Linux/macOS:

~~~sh
cp .env.example .env
~~~

On Windows PowerShell:

~~~powershell
Copy-Item .env.example .env
~~~

Edit the new **.env** file. At a minimum, change these values:

- **SELF_MUSIC_PASSWORD:** a unique password of at least 12 characters.
- **SESSION_SECRET:** a long random secret. Generate one with Node.js:

~~~sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
~~~

- **MUSIC_DIR:** the folder containing your music. By default it is **./music** inside the project.

Do not commit **.env** or put secrets in client-side code. The repository ignores **.env** and the default **music/** folder.

### 3. Add music and build

Create the music folder if necessary and copy your audio files into it. Subfolders are supported.

~~~sh
npm run build
npm start
~~~

Open **http://localhost:8787** on the same computer. The first-run screen explains the configuration state; after setting a password and restarting the server, sign in.

To develop the UI locally instead, use **npm run dev**. Vite serves the client and proxies API requests to port 8787.

### Alternative: Docker Compose

If Docker Desktop (Windows/macOS) or Docker Engine (Linux) is already installed, you can run the server as a container. Keep the host port loopback-only unless you have deliberately configured a private network or firewall rule.

~~~sh
cp .env.example .env
mkdir -p music
# Edit .env and set SELF_MUSIC_PASSWORD and SESSION_SECRET.
docker compose up --build -d
~~~

On Windows PowerShell, make the config with `Copy-Item .env.example .env`; create the music folder in File Explorer if needed. Then open **http://localhost:8787**. Use `docker compose logs -f selfmusic` to inspect startup logs and `docker compose down` to stop the container. The provided Compose file binds the port to localhost by default, so a tunnel running on that same host can reach it.

## Listen away from home

Do not simply port-forward port 8787 to the public internet.

### Option A: private access with Tailscale

Install Tailscale on the home server and your phone, sign both devices into the same tailnet, and access the server by its tailnet address. Keep the SelfMusic password enabled. This is best for a personal library when installing the companion network app on each device is acceptable.

### Option B: HTTPS tunnel

Use a tunnel provider to route a hostname to the local SelfMusic server. For example, Cloudflare Tunnel documentation is here:

- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/

Configure an access/login policy for the hostname as an additional layer, use HTTPS, and keep the SelfMusic password enabled too. A public hostname alone is not an access policy. Do not publish this server without authentication.

For either option, the home machine must stay on, SelfMusic must stay running, and the internet connection must be available. Remote audio uses the same authenticated streaming endpoint as local audio.

## Phone / lock-screen playback

Open the app in a browser that supports web audio and Media Session controls, start a track, and then lock the screen. On supported combinations, the operating system can show the track name and provide play/pause/skip controls.

Support is controlled by the browser and operating system, not solely by the app. iOS Safari, installed web apps, and other mobile browsers may behave differently across versions. Test on your actual phone before relying on uninterrupted background playback. The PWA shell alone does not make audio play offline.

## YouTube discovery

The **Explore YouTube** page searches embeddable videos through the official YouTube Data API v3 and plays a selected result in YouTube's visible embedded player. Search results are only kept in page memory; the server does not cache or save audiovisual content.

To enable search:

1. Create an API key in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Enable **YouTube Data API v3** for that project.
3. Put the key in the home server's local `.env` file as `YOUTUBE_API_KEY=your-key`.
4. Restrict the key to the YouTube Data API v3 where possible, then restart SelfMusic.

Keep this key on the server; do not put it in React or commit it to GitHub.

**YouTube is for visible video playback only.** This feature does not download tracks, extract audio, cache videos, or provide background/lock-screen audio from YouTube. YouTube's developer policies prohibit downloading or storing audiovisual copies and background-player behavior through API clients without the required authorization. For lock-screen playback, add audio files that you own or are permitted to store to your local `music/` folder.

## Supported file types

The server recognizes MP3, M4A, AAC, FLAC, WAV, OGG, OPUS, and WebM audio extensions. Whether a specific codec can be played depends on the browser/device. This MVP reads titles from filenames and uses the parent folder as the artist label; embedded tag and artwork parsing is not implemented yet.

## Current limitations / next milestones

- First-run setup still requires starting the home server once from a terminal. A browser-only server is not technically possible within normal browser security boundaries; a future cross-platform installer or container flow could make this easier.
- No embedded ID3/FLAC tag parsing, automatic artwork lookup, playlists, album management, or listening-history sync yet.
- Favorites and last-played track are currently saved in the browser's local storage, not synced between devices.
- Media Session controls and lock-screen artwork vary by platform.
- No server admin panel for arbitrary directory selection. Configure **MUSIC_DIR** on the server instead.

## Security checklist

- Use a unique, strong SelfMusic password.
- Configure **SESSION_SECRET** before remote use.
- Use an HTTPS tunnel or private network overlay.
- Add an access policy at the tunnel layer where available.
- Keep **.env** private and keep the server updated.
- Only store and stream music you have permission to use.

SelfMusic is a self-hosting project, not a commercial music catalogue or a streaming service that supplies tracks.
