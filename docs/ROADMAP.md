# SelfMusic roadmap and known limitations

This file separates implemented behavior from work that still needs implementation or device-level verification.

## Implemented in this branch

- PWA app shell with a web app manifest and production service-worker registration.
- Media Session metadata, play/pause, previous/next and seek handlers; the player updates lock-screen position where the browser supports it.
- Explicit per-track offline saving to the browser's Cache API, an Offline Downloads view, and cached audio routing through the service worker.
- Last.fm retry queue persisted in SQLite, with bounded exponential backoff for failed submissions.
- YouTube queued downloads persisted in SQLite, with progress parsed from yt-dlp output and SSE updates to connected clients.

## Known limitations and next iterations

### Acoustic duplicate detection (Chromaprint)

Not implemented. Current duplicate groups require byte-identical SHA-256 hashes. Differently encoded versions of the same recording are not grouped. A follow-up can optionally install Chromaprint and `fpcalc`, compute fingerprints as a background task, and only flag probable matches for review; it should never delete files automatically based on acoustic similarity alone.

### YouTube progress accuracy

The percentage is approximate. It parses yt-dlp's human-readable download progress, and conversion/metadata tagging do not provide a precise duration-based percentage for every extractor. A follow-up should use yt-dlp's stable progress-template output (or machine-readable hooks where supported), distinguish metadata, download, conversion, and indexing phases, and display phase-aware progress rather than presenting conversion time as an exact percentage.

### Last.fm delivery guarantees

The SQLite queue survives a normal process restart and retries transient failures with exponential backoff. It is not a distributed queue, and the remote service can accept a scrobble while the client times out before receiving confirmation. That ambiguity can lead to a duplicate submission on retry; Last.fm does not provide a general idempotency key for every scrobble. Future work should add operator-visible dead-letter/error history and retention limits.

### Cross-device playback queue and resume

Not implemented. Track lists, progress and the browser's last selected track are not a shared server-side queue/position protocol. The offline cache is per browser/device and is not synchronized across devices. A follow-up should add a server-side queue model with ordered track IDs, revision/version, current track, playback position, repeat/shuffle state and per-user authorization. Updates should use revisions or conditional writes so two devices cannot silently overwrite each other.

### Offline playback and background playback

The web application can store selected audio tracks in the browser's Cache API and the service worker can serve those tracks through an internal offline URL. This requires the PWA to have been opened online at least once, the service worker to have taken control, and the user to explicitly save each track before losing connectivity. Browser storage may be evicted by the operating system/browser; the UI cannot guarantee permanent storage. Offline downloads are not automatically synced or included in server backups.

Media Session handlers are implemented, but lock-screen/background behavior still varies by browser, OS power-management policy, and installation method. Manually verify on target iOS and Android devices, especially screen-lock playback, Bluetooth controls, interruption handling, low-storage behavior and reconnection from offline mode. CI cannot prove real device audio behavior.

### Integration and deployment validation

Unit/integration tests and the Docker image build validate packaging and internal behavior, not every external service. YouTube, Last.fm OAuth, Subsonic third-party clients, HTTPS/Tailscale, and long-running media playback require manual smoke tests with valid credentials and actual devices before promoting a release.
