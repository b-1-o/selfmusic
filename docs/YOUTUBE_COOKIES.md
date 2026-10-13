# YouTube cookies (age-restricted / sign-in videos)

SelfMusic converts audio with **yt-dlp**. Some videos need a logged-in YouTube session. That is done with a **cookies.txt** file on the server (never commit it).

## Quick path (recommended)

1. On your **computer**, install a browser extension that exports **Netscape cookies.txt**, for example:
   - Chromium: “Get cookies.txt LOCALLY”
   - Firefox: “cookies.txt” / similar Netscape exporter
2. Open [https://www.youtube.com](https://www.youtube.com) and **sign in**.
3. Export cookies for `youtube.com` → save as `cookies.txt`.
4. In SelfMusic (admin):
   - Open **Import → YouTube**
   - Use **Upload cookies.txt**
   - Or copy the file to the project root as `cookies.txt`:
     ```bash
     cp ~/Downloads/cookies.txt ~/selfmusic/cookies.txt
     chmod 600 ~/selfmusic/cookies.txt
     selfmusic restart
     ```
5. Try **Download MP3** again on the restricted track.

## API (optional)

```bash
# status
curl -b cookies-session.txt http://127.0.0.1:8787/api/youtube/cookies

# upload (admin session)
curl -b cookies-session.txt -X POST http://127.0.0.1:8787/api/youtube/cookies \
  -H 'Content-Type: application/json' \
  -d @<(python3 -c 'import json,sys; print(json.dumps({"cookies":open("cookies.txt").read()}))')
```

## Rules

- Only use **your** account cookies. Do not share the file.
- Cookies expire; re-export when downloads start failing again.
- `.gitignore` should keep `cookies.txt` out of git (project root file).
- Search still uses `YOUTUBE_API_KEY` in `.env` when set; cookies are for **download/convert**, not for the Data API search key.

## If it still fails

- Confirm the file is Netscape format (often starts with `# Netscape HTTP Cookie File`).
- Confirm you were signed into YouTube when exporting.
- Restart SelfMusic after replacing `cookies.txt` on disk.
- Prefer non-restricted uploads when possible.
