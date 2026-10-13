#!/usr/bin/env python3
"""Patch src/App.jsx: no video player, selection + Download MP3, cookies upload UI."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src" / "App.jsx"

NEW_PANEL = r'''<aside className="youtube-player-panel glass-mist-panel">
                  <div className="youtube-panel-heading"><div><p className="eyebrow">SELECTED TRACK</p><h2>Ready to import</h2></div><span className="youtube-live-label"><span /> SELECT</span></div>
                  {selectedYoutube ? (
                    <>
                      {selectedYoutube.thumbnail ? (
                        <img className="youtube-selected-thumb" src={selectedYoutube.thumbnail} alt="" width={320} height={180} loading="lazy" />
                      ) : null}
                      <div className="youtube-selected-meta">
                        <strong>{selectedYoutube.title}</strong>
                        <span>{selectedYoutube.channelTitle}{selectedYoutube.duration ? " · " + selectedYoutube.duration : ""}</span>
                      </div>
                      {profile.role === "admin" && (
                        <button className="youtube-download-button primary-button" type="button" disabled={youtubeJobStarting || ["queued", "running"].includes(youtubeJob?.status)} onClick={() => startYoutubeDownload({ videoId: selectedYoutube.videoId, metadata: { title: selectedYoutube.title, artist: selectedYoutube.channelTitle } }, "explore")}>
                          {youtubeJobStarting || ["queued", "running"].includes(youtubeJob?.status) ? <RefreshCw size={15} className="spin" /> : <Download size={15} />}
                          <span>{youtubeJobStarting ? "Queueing…" : ["queued", "running"].includes(youtubeJob?.status) ? "Download in progress" : "Download MP3"}</span>
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="youtube-player-empty"><div className="youtube-player-art"><Youtube size={35} /></div><strong>Pick a track</strong><span>Choose a result to see title, channel, duration, then Download MP3.</span></div>
                  )}
                  <div className="youtube-local-note"><Headphones size={16} /><span>Audio is saved into your library. No embedded YouTube player.</span></div>
                  {profile.role === "admin" && (
                    <div className="youtube-cookies-box">
                      <p className="eyebrow">AGE-RESTRICTED / SIGN-IN</p>
                      <p className="youtube-cookies-help">Optional: upload a Netscape <code>cookies.txt</code> from a browser signed into YouTube so yt-dlp can convert restricted videos.</p>
                      <label className="youtube-cookies-file">
                        <input type="file" accept=".txt,text/plain" onChange={async (event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (!file) return;
                          try {
                            const text = await file.text();
                            const response = await fetch("/api/youtube/cookies", {
                              method: "POST",
                              credentials: "same-origin",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ cookies: text }),
                            });
                            if (!response.ok) throw new Error(await readMessage(response));
                            setYoutubeError("");
                            setYoutubeUrlError("");
                            window.alert("YouTube cookies saved on the server. Try Download MP3 again.");
                          } catch (error) {
                            window.alert(error.message || "Could not save cookies.");
                          }
                        }} />
                        <span>Upload cookies.txt</span>
                      </label>
                    </div>
                  )}
                </aside>'''


def main() -> int:
    if not APP.is_file():
        print("ERROR: src/App.jsx not found", file=sys.stderr)
        return 1

    t = APP.read_text(encoding="utf-8")
    original = t
    changes = []

    def rep(old: str, new: str, label: str) -> None:
        nonlocal t
        if old not in t:
            print(f"WARN: skip {label}")
            return
        t = t.replace(old, new, 1)
        changes.append(label)

    # Replace entire selected-track panel (with or without empty iframe hole)
    t2, n = re.subn(
        r"<aside className=\"youtube-player-panel glass-mist-panel\">[\s\S]*?</aside>",
        NEW_PANEL.strip(),
        t,
        count=1,
    )
    if n:
        t = t2
        changes.append("replaced player panel with select+download")
    else:
        print("WARN: youtube-player-panel not found")

    rep(
        "OPEN IN OFFICIAL PLAYER",
        "PASTE LINK TO CONVERT",
        "url caption",
    )
    rep(
        "<Play size={14} fill=\"currentColor\" /> Open video",
        "<Download size={14} /> Use link",
        "url button",
    )
    rep(
        "Searching embeddable videos…",
        "Searching tracks…",
        "loading copy",
    )
    rep(
        (
            '? "Open Settings → Integrations, add YOUTUBE_API_KEY to the server\'s private .env file, '
            'then restart SelfMusic. You can still open a direct YouTube video link here."'
        ),
        '? "Search used a fallback. Check the server or try again."',
        "api key error copy",
    )

    # Search POST (if still GET)
    if '/api/youtube/search?q=' in t:
        rep(
            (
                'const response = await fetch("/api/youtube/search?q=" + encodeURIComponent(search));\n'
                "      if (!response.ok) throw new Error(await readMessage(response));\n"
                "      const body = await response.json();\n"
                "      setYoutubeResults(Array.isArray(body.items) ? body.items : []);\n"
                '      if (!body.items?.length) setYoutubeError("No embeddable videos found. Try another search.");'
            ),
            (
                'const response = await fetch("/api/youtube/search", {\n'
                '        method: "POST",\n'
                '        credentials: "same-origin",\n'
                '        headers: { "Content-Type": "application/json" },\n'
                "        body: JSON.stringify({ query: search, limit: 20, musicOnly: true }),\n"
                "      });\n"
                "      if (!response.ok) throw new Error(await readMessage(response));\n"
                "      const body = await response.json();\n"
                "      setYoutubeResults(Array.isArray(body.items) ? body.items : []);\n"
                '      if (!body.items?.length) setYoutubeError("No results. Try another search.");'
            ),
            "POST search",
        )

    if t == original:
        print("No changes applied.")
        return 2

    APP.write_text(t, encoding="utf-8")
    print("Patched src/App.jsx:")
    for c in changes:
        print(" -", c)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
