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

## Requirements

* **Node.js** 20 or later.
* **npm** 10 or later.
* A music folder on the same machine as the server.
* For **YouTube → MP3 downloads**: `yt-dlp` and `ffmpeg` installed on the
  server (see the YouTube section below).

## Setup

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
   NODE_ENV=production npm start
   ```

   The Node server serves the built frontend and the API on the same port.

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

The **Import music** page can save the audio track of a YouTube video to
your library as an MP3 file. This is useful for archiving podcasts, talks,
or music you are allowed to keep.

**Requirements**

* `yt-dlp` installed on the server:
  * **Arch / CachyOS:** `sudo pacman -S yt-dlp`
  * **Debian / Ubuntu:** `sudo apt install yt-dlp`
  * **macOS:** `brew install yt-dlp`
* **FFmpeg** (needed by `yt-dlp` for MP3 conversion):
  * **Arch / CachyOS:** `sudo pacman -S ffmpeg`
  * **Debian / Ubuntu:** `sudo apt install ffmpeg`
  * **macOS:** `brew install ffmpeg`

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
* No playlist persistence beyond the in-memory queue and favorites.

## Project layout

```
.
├── server/
│   └── index.js          # Express API, auth, upload, import, YouTube download
├── src/
│   └── App.jsx           # React app: library, player, import panel
├── music/                # MUSIC_DIR default (library root)
│   └── Uploads/          # uploaded and downloaded files
├── dist/                 # built frontend (after npm run build)
├── .env.example
├── package.json
└── README.md
```

## License

MIT. See `LICENSE` if present.
