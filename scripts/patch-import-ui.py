#!/usr/bin/env python3
"""Patch src/App.jsx: Import tabs, no embed player, POST search. Run from repo root."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src" / "App.jsx"


def main() -> int:
    if not APP.is_file():
        print("ERROR: src/App.jsx not found. Run from SelfMusic repo root.", file=sys.stderr)
        return 1

    t = APP.read_text(encoding="utf-8")
    original = t
    changes = []

    def rep(old: str, new: str, label: str) -> None:
        nonlocal t
        if old not in t:
            print(f"WARN: skip {label} (pattern not found)")
            return
        t = t.replace(old, new, 1)
        changes.append(label)

    rep(
        '{["import", "offline", "youtube"].includes(view) && <AddTabs view={view} onNavigate={setView} isAdmin={profile.role === "admin" && !offlineMode} />}',
        '{["import", "import-url", "offline", "youtube"].includes(view) && <AddTabs view={view} onNavigate={setView} isAdmin={profile.role === "admin" && !offlineMode} />}',
        "AddTabs views",
    )

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

    rep(
        (
            "const selectYoutubeVideo = useCallback((item) => {\n"
            "    // Keep YouTube playback inside its visible, official video player.\n"
            "    // The local audio player is paused so the two sources do not overlap.\n"
            "    audioRef.current?.pause();\n"
            "    setIsPlaying(false);\n"
            "    setSelectedYoutube(item);\n"
            "  }, []);"
        ),
        (
            "const selectYoutubeVideo = useCallback((item) => {\n"
            "    setSelectedYoutube(item);\n"
            "  }, []);"
        ),
        "selectYoutubeVideo",
    )

    rep(
        "VIDEO DISCOVERY <span /> OFFICIAL PLAYER",
        "SEARCH <span /> CONVERT TO LIBRARY",
        "hero kicker",
    )
    rep(
        "Search YouTube videos from your own home server and play them in the official YouTube player.",
        "Search tracks and convert audio into your private library. No embedded YouTube player — pick a result and Convert.",
        "hero text",
    )
    rep('aria-label="Search YouTube videos"', 'aria-label="Search YouTube tracks"', "aria search")

    old_btn = '{youtubeLoading ? "Searching" : "Search YouTube"}'
    new_btn = '{youtubeLoading ? "Searching" : "Search"}'
    if old_btn in t:
        t = t.replace(old_btn, new_btn, 1)
        changes.append("search button label")
    else:
        print("WARN: skip search button label (pattern not found)")

    # Self-closing iframe used in the YouTube selected panel
    t2, n = re.subn(
        r"\s*<iframe\s+key=\{selectedYoutube\.videoId\}[\s\S]*?/>",
        "",
        t,
        count=1,
    )
    if n:
        t = t2
        changes.append("removed iframe")
    else:
        t2, n = re.subn(
            r"\s*<iframe[\s\S]*?youtube\.com/embed/[\s\S]*?/>",
            "",
            t,
            count=1,
        )
        if n:
            t = t2
            changes.append("removed iframe")
        else:
            print("WARN: iframe not found")

    t2, n = re.subn(
        r"\s*<a className=\"youtube-watch-link\"[\s\S]*?</a>",
        "",
        t,
        count=1,
    )
    if n:
        t = t2
        changes.append("removed watch link")
    else:
        print("WARN: youtube-watch-link not found")

    rep(
        'view === "import" ? "Add music"',
        'view === "import" || view === "import-url" ? "Import"',
        "pageTitle Import",
    )

    for marker in ('{view === "import" && (', "{view === 'import' && ("):
        if marker in t:
            t = t.replace(
                marker,
                '{(view === "import" || view === "import-url") && (',
                1,
            )
            changes.append("import-url shares import page")
            break
    else:
        print("WARN: skip import page marker")

    if t == original:
        print("No changes applied (already patched?).")
        return 2

    APP.write_text(t, encoding="utf-8")
    print("Patched src/App.jsx:")
    for c in changes:
        print(" -", c)
    print("bytes", len(t.encode("utf-8")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
