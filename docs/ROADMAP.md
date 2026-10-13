# SelfMusic roadmap and known limitations

This page records what is implemented on main, what automation verifies, and what still needs real service/device testing. A green CI run is not a substitute for the manual checklist near the end.

## Implemented on main

- Versioned SQLite migrations for the library, accounts, collections, integrations, durable YouTube jobs, and per-user playback snapshots.
- PWA app shell, manifest, service-worker registration, explicit per-track offline saving, Offline Downloads view, and cached audio routing.
- Media Session metadata, play/pause, previous/next, seek handlers, and lock-screen position updates where supported by the browser.
- Last.fm per-user authorization and a SQLite retry queue with bounded exponential backoff.
- YouTube download jobs persisted in SQLite, with phase-aware progress parsed from yt-dlp download/postprocess progress-template markers and SSE updates to connected clients.
- Cross-device playback sync: GET/PUT snapshot endpoints, per-user queue/position/repeat/shuffle state, monotonic revision numbers, optimistic conflict detection, and SSE pushes to that user's connected devices.
- A "Continue here" prompt for a session last updated by another device. Playback is not auto-started on page load; the user must choose to resume.
- Per-account appearance preferences (including a bounded PNG/JPEG/WebP wallpaper) and playback-prompt dismissals persisted in SQLite and synced across authenticated devices.
- Offline cache recovery that retains cached audio entries even if the browser loses their local descriptive metadata.
- The Offline Downloads refresh action re-reads CacheStorage, and its empty state guides the user back to the library rather than to server setup.
- Guest access is documented as a least-privilege managed account over a private network tunnel; no default shared guest credential is created.

## Priority 0 — manual release checks

These checks require credentials, devices, or network conditions not available to the CI runner. Record date, device/OS/browser/client version, the result, and relevant redacted logs in this checklist before marking them complete.

- [ ] YouTube Data API search with a valid server-side API key.
- [ ] YouTube → MP3 using yt-dlp and FFmpeg, checking conversion, library indexing, UI visibility, and the queued task after a server restart. Only test content the operator owns or has permission to save.
- [ ] Last.fm authorization, now-playing, scrobble threshold, and retry after a real network interruption.
- [ ] A real Subsonic client: authenticate, stream and seek, search3, getPlaylists, and scrobble.
- [ ] iOS Safari/PWA and Android Chrome/PWA: install flow, background playback, lock screen, Bluetooth/media keys, interrupted network, reconnection, and storage eviction behavior.
- [ ] Offline audio: explicitly save a track, verify it plays after disabling networking, then verify logout removes the user's offline cache as documented.
- [ ] Cross-device sync: start from one browser/device, wait for a position update, then open a second browser/device as the same account, choose "Continue here", and confirm queue order and resume position. Also test two devices attempting to update at nearly the same time.

A test is not complete unless its actual device/OS/browser/client versions and outcome are recorded. Do not add guessed version numbers to the README.

## Priority 1 — reliability and observability

### Cross-device playback sync

Implemented at the API/UI level, but still requires the manual two-device check above. The service stores one shared snapshot per user, not one independently playing session per device. The HTTP write includes an expected revision; a stale write returns 409 and the client pauses automatic writes when it detects another device's state. SSE provides near-real-time updates while connected, with a heartbeat and browser-managed reconnects.

Limits and caveats:

- A queue snapshot is capped at 500 track IDs and references tracks already indexed in that user's server library.
- Sync requires an authenticated online connection to the same SelfMusic server. Offline audio remains browser-local and is not transferred between devices.
- The user must click "Continue here" to avoid unexpected autoplay.
- Concurrent playback on multiple devices is treated as a shared-session conflict, not as independent playback sessions. Conflict behavior needs testing on a real network.

### Last.fm delivery guarantees

The SQLite queue survives a normal process restart and retries transient failures with exponential backoff. It is not a distributed queue, and the remote service can accept a scrobble while the client times out before receiving confirmation. That ambiguity can lead to a duplicate submission on retry; Last.fm does not provide a general idempotency key for every scrobble. Add operator-visible dead-letter/error history and queue retention limits in a follow-up.

### YouTube progress accuracy

The client distinguishes metadata, download, conversion and indexing. Download and postprocess percentages come from explicit yt-dlp progress-template markers. Conversion and metadata-tagging percentages may still be unavailable or approximate depending on the extractor/postprocessor. Test representative output, and show indeterminate progress when no reliable percentage is available.

## Priority 2 — deduplication interface and acoustic matching

Acoustic matching is not implemented yet. Current duplicate groups require byte-identical SHA-256 hashes. The internal `server/fingerprints.js` provider interface is now in place, and the existing `hashFile()` compatibility function still returns the same SHA-256 hex string. SHA-256 is the only registered provider today. A future optional `fpcalc` / Chromaprint provider can be registered behind this interface without changing the current duplicate API. Acoustic similarity must only flag candidates for review and must never delete files automatically.

## Priority 3 — PWA and media compatibility

SelfMusic can store selected audio tracks in the browser's Cache API and the service worker can serve them through an internal offline URL. This requires the PWA to have been opened online at least once, the service worker to control the page, and the user to explicitly save each track before losing connectivity. Browser storage may be evicted by the OS/browser; the UI cannot guarantee permanent storage. Offline downloads are not server backups and are not synchronized across devices.

Media Session handlers are implemented, but lock-screen/background behavior varies by browser, OS power-management policy, and installation method. CI cannot prove real-device audio behavior. Manually verify interruption handling, low storage, Bluetooth controls, and offline/reconnect behavior on target devices.

## Priority 4 — additional product improvements

- Add a user-visible history of Last.fm dead-letter/retry errors with retention controls.
- Improve YouTube progress reporting when conversion tools provide no percentage.
- Consider per-device session metadata / active-device labeling after the shared playback snapshot proves stable.
- Continue accessibility checks: keyboard navigation, visible focus rings, high contrast and touch targets of at least 44 CSS pixels for primary touch controls.

## Automated checks

GitHub Actions currently covers syntax checks, the Node test suite, Vite production build, Python helper compilation, Docker build/runtime smoke test, and Windows launcher parsing. The playback-sync tests cover schema availability, default state, persistence, per-user isolation, bounded inputs, unknown track rejection, and revision conflicts. These automated tests do not claim to validate external services or physical device behavior.
