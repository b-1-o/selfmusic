import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  ArrowUpRight,
  Check,
  CircleAlert,
  Copy,
  Disc3,
  Download,
  FolderOpen,
  Globe2,
  Headphones,
  Heart,
  Library,
  Link2,
  ListMusic,
  Plus,
  LockKeyhole,
  LogOut,
  Menu,
  Music,
  Palette,
  Pause,
  Play,
  RefreshCw,
  Repeat2,
  Search,
  Server,
  ShieldCheck,
  Smartphone,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Upload,
  Trash2,
  X,
  Youtube,
} from "lucide-react";
import AddTabs from "./components/Add/AddTabs.jsx";
import FilterPanel, { FilterButton } from "./components/Library/FilterPanel.jsx";
import TrackList from "./components/Library/TrackList.jsx";
import SettingsTabs from "./components/Settings/SettingsTabs.jsx";
import Navigation from "./components/Layout/Navigation.jsx";
import Cover from "./components/Shared/Cover.jsx";
import PlayerBar from "./components/Player/PlayerBar.jsx";
import formatTime from "./utils/formatTime.js";

const FAVORITES_KEY = "selfmusic:favorites:v1";
const LAST_TRACK_KEY = "selfmusic:last-track:v1";
const APPEARANCE_KEY = "selfmusic:appearance:v1";
const REMOTE_WIZARD_KEY = "selfmusic:remote-wizard-seen:v1";
const REMOTE_PLAYBACK_DISMISSED_KEY = "selfmusic:playback-dismissed:v1";
const OFFLINE_AUDIO_CACHE = "selfmusic-offline-audio-v1";
const OFFLINE_TRACKS_KEY = "selfmusic:offline-tracks:v1";
const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
const TAILSCALE_QR_URL = "https://api.qrserver.com/v1/create-qr-code/?size=192x192&margin=8&data=" + encodeURIComponent(TAILSCALE_DOWNLOAD_URL);
const SUPPORTED_UPLOAD_EXTENSIONS = new Set(["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "webm"]);
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

const ACCENT_PRESETS = [
  { id: "rose", label: "Rose", color: "#f1a0ba" },
  { id: "ocean", label: "Ocean", color: "#87d7ee" },
  { id: "violet", label: "Violet", color: "#c5a9ff" },
  { id: "amber", label: "Amber", color: "#f4c27a" },
  { id: "silver", label: "Silver", color: "#c2cad7" },
];

const BACKGROUND_PRESETS = [
  { id: "midnight", label: "Midnight", image: "radial-gradient(ellipse at 78% 12%, rgba(92, 74, 130, .24), transparent 38%), linear-gradient(145deg, #101018, #08090e 70%)" },
  { id: "fog", label: "Fog", image: "radial-gradient(ellipse at 20% 15%, rgba(159, 174, 193, .18), transparent 42%), linear-gradient(145deg, #171b22, #0a0d13 78%)" },
  { id: "dawn", label: "Dawn", image: "radial-gradient(ellipse at 80% 12%, rgba(195, 128, 151, .24), transparent 40%), linear-gradient(145deg, #1e1721, #0c0a12 75%)" },
  { id: "neon", label: "Neon", image: "radial-gradient(ellipse at 80% 10%, rgba(78, 122, 177, .22), transparent 34%), radial-gradient(ellipse at 15% 85%, rgba(151, 89, 145, .12), transparent 44%), #090b12" },
  { id: "minimal", label: "Minimal", image: "linear-gradient(145deg, #111116, #09090c)" },
];

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

function hexToHsv(hex) {
  const normalized = String(hex || "").replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return { hue: 338, saturation: 33, value: 95 };
  const red = parseInt(normalized.slice(0, 2), 16) / 255;
  const green = parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return {
    hue: Math.round((hue + 360) % 360),
    saturation: Math.round(max === 0 ? 0 : (delta / max) * 100),
    value: Math.round(max * 100),
  };
}

function hsvToHex(hueInput, saturationInput, valueInput) {
  const hue = ((Number(hueInput) % 360) + 360) % 360;
  const saturation = clampNumber(Number(saturationInput) || 0, 0, 100) / 100;
  const value = clampNumber(Number(valueInput) || 0, 0, 100) / 100;
  const chroma = value * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  let red = 0, green = 0, blue = 0;
  if (hue < 60) [red, green, blue] = [chroma, secondary, 0];
  else if (hue < 120) [red, green, blue] = [secondary, chroma, 0];
  else if (hue < 180) [red, green, blue] = [0, chroma, secondary];
  else if (hue < 240) [red, green, blue] = [0, secondary, chroma];
  else if (hue < 300) [red, green, blue] = [secondary, 0, chroma];
  else [red, green, blue] = [chroma, 0, secondary];
  const offset = value - chroma;
  return "#" + [red, green, blue]
    .map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, "0"))
    .join("");
}

function darkenAccent(hex) {
  const hsv = hexToHsv(hex);
  return hsvToHex(hsv.hue, Math.min(100, hsv.saturation + 8), Math.max(30, hsv.value * 0.72));
}


function SectionGlyph({ kind, size = 24 }) {
  const common = {
    className: "section-glyph",
    width: size,
    height: size,
    viewBox: "0 0 48 48",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    focusable: "false",
  };

  if (kind === "library") return (
    <svg {...common}>
      <rect x="6.5" y="11" width="27" height="29" rx="7" fill="currentColor" fillOpacity=".08" />
      <rect x="11" y="7" width="29.5" height="31" rx="7.5" fill="currentColor" fillOpacity=".13" />
      <path d="M17 14.5h17M17 19.5h12" opacity=".55" />
      <path d="M23 25v7.7a3.2 3.2 0 1 1-2.1-3V21l10-2.5v10.2a3.2 3.2 0 1 1-2.1-3V16.9" strokeWidth="2.1" />
    </svg>
  );
  if (kind === "liked") return (
    <svg {...common}>
      <path d="M24 39.5 9.8 26.2C1.9 18.9 7.2 7.6 16.2 9.2c3.5.6 6 3.1 7.8 5.6 1.8-2.5 4.3-5 7.8-5.6 9-1.6 14.3 9.7 6.4 17L24 39.5Z" fill="currentColor" fillOpacity=".16" strokeWidth="2.2" />
      <path d="M14.5 23.8h5l2.8-5.2 4.1 11 2.6-5.8h4.5" strokeWidth="2" />
    </svg>
  );
  if (kind === "server") return (
    <svg {...common}>
      <rect x="7" y="6.5" width="34" height="15" rx="4.5" fill="currentColor" fillOpacity=".1" />
      <rect x="7" y="26.5" width="34" height="15" rx="4.5" fill="currentColor" fillOpacity=".1" />
      <path d="M13 12.5h13M13 32.5h13" opacity=".7" />
      <circle cx="34" cy="14" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="34" cy="34" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
  if (kind === "home") return (
    <svg {...common}>
      <path d="m5.5 22 18.5-15 18.5 15" strokeWidth="2.2" />
      <path d="M10.5 20v20h27V20" fill="currentColor" fillOpacity=".08" />
      <path d="M20 40V27.5h8V40" />
      <path d="M31.5 11.5V7h5v8" />
    </svg>
  );
  if (kind === "import") return (
    <svg {...common}>
      <path d="M24 5.5v24" strokeWidth="2.4" />
      <path d="m14.5 20 9.5 9.5 9.5-9.5" strokeWidth="2.4" />
      <path d="M8 29v9a3.5 3.5 0 0 0 3.5 3.5h25A3.5 3.5 0 0 0 40 38v-9" />
      <path d="M15 36h18" opacity=".55" />
    </svg>
  );
  if (kind === "youtube") return (
    <svg {...common}>
      <rect x="5.5" y="10" width="37" height="28" rx="8" fill="currentColor" fillOpacity=".1" />
      <path d="M21 17.5 32 24l-11 6.5v-13Z" fill="currentColor" stroke="none" />
      <path d="M5.5 18.5h-1M43.5 18.5h-1M5.5 29.5h-1M43.5 29.5h-1" opacity=".5" />
    </svg>
  );
  return (
    <svg {...common}>
      <circle cx="24" cy="24" r="16.5" fill="currentColor" fillOpacity=".07" />
      <path d="M24 12v24M12 24h24" />
    </svg>
  );
}

function readLocalJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function offlineTrackUrl(trackId) {
  return "/__selfmusic_offline/" + encodeURIComponent(trackId);
}

function remotePlaybackDismissalKey(state) {
  return state?.sourceDeviceId && state?.currentTrackId
    ? JSON.stringify([String(state.sourceDeviceId), String(state.currentTrackId)])
    : "";
}

function offlineCacheRequest(trackId) {
  return new Request(new URL(offlineTrackUrl(trackId), window.location.origin).toString(), { method: "GET" });
}

async function readOfflineLibraryFromCache() {
  if (!("caches" in window)) return { ids: [], tracks: [] };
  const cache = await window.caches.open(OFFLINE_AUDIO_CACHE);
  const requests = await cache.keys();
  const cachedIds = new Set();
  for (const request of requests) {
    try {
      const pathname = new URL(request.url).pathname;
      const prefix = "/__selfmusic_offline/";
      if (pathname.startsWith(prefix)) {
        const encodedId = pathname.slice(prefix.length);
        if (encodedId && !encodedId.includes("/")) cachedIds.add(decodeURIComponent(encodedId));
      }
    } catch {}
  }

  const stored = readLocalJson(OFFLINE_TRACKS_KEY, []);
  const byId = new Map((Array.isArray(stored) ? stored : []).filter((track) => track && typeof track.id === "string").map((track) => [track.id, track]));
  // CacheStorage can outlive localStorage (or its metadata can be evicted independently).
  // Keep every cached audio ID playable even if its descriptive metadata is missing.
  const tracks = [...cachedIds].map((id) => byId.get(id) || ({
    id,
    title: "Saved track " + id.slice(0, 8),
    artist: "Saved offline",
    album: "This device",
    albumArtist: "",
    year: null,
    genre: null,
    duration: 0,
    streamUrl: "/api/stream/" + encodeURIComponent(id),
    artworkUrl: "",
    metadataFallback: true,
  }));
  try { localStorage.setItem(OFFLINE_TRACKS_KEY, JSON.stringify(tracks)); } catch {}
  return { ids: [...cachedIds], tracks };
}



function parseYoutubeVideoId(value) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let videoId = "";

    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] || "";
    } else if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)) {
      videoId =
        url.searchParams.get("v") ||
        url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1] ||
        "";
    }

    return /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : "";
  } catch {
    return "";
  }
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "0 B";
  if (value < 1024) return value + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return size.toFixed(size >= 10 ? 0 : 1) + " " + units[unitIndex];
}

async function readMessage(response) {
  try {
    const body = await response.json();
    return body.message || body.error || "Something went wrong.";
  } catch {
    return "The server could not be reached.";
  }
}



function LoginScreen({ configured, checking, onLogin, error, serverUnavailable, appearance }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="login-shell" data-theme={appearance.theme} data-accent={appearance.accent} data-glass={appearance.glass} style={{ "--user-accent": appearance.accentColor, "--user-accent-strong": darkenAccent(appearance.accentColor), "--user-glass-opacity": appearance.glassOpacity + "%", "--user-glass-blur": appearance.glassBlur + "px", "--user-radius": appearance.cornerRadius + "px", "--user-wallpaper-blur": appearance.wallpaperBlur + "px" }}>
      <div className="login-orb login-orb-one" />
      <div className="login-orb login-orb-two" />
      <div className="login-card">
        <div className="brand brand-login">
          <span className="brand-mark"><AudioLines size={23} strokeWidth={2.2} /></span>
          <span>self<span className="brand-light">music</span></span>
        </div>
        <div className="login-art">
          <div className="art-ring art-ring-one" />
          <div className="art-ring art-ring-two" />
          <div className="art-center"><Headphones size={44} strokeWidth={1.2} /></div>
          <span className="art-dot art-dot-one" />
          <span className="art-dot art-dot-two" />
          <span className="art-dot art-dot-three" />
        </div>
        <p className="eyebrow">PERSONAL AUDIO SERVER</p>
        <h1>Your music.<br /><span>Your rules.</span></h1>
        <p className="login-copy">One personal library, streamed from your home server to wherever you are.</p>

        {checking ? (
          <div className="state-note"><RefreshCw size={17} className="spin" /> Checking your server…</div>
        ) : serverUnavailable ? (
          <div className="setup-notice">
            <div className="notice-heading"><CircleAlert size={18} /> Server could not be reached</div>
            <p>Make sure SelfMusic is running on your home computer and that the address or remote tunnel is available.</p>
            <a className="text-link" href="https://github.com/b-1-o/selfmusic#run-the-home-server" target="_blank" rel="noreferrer">Open setup guide <ArrowUpRight size={15} /></a>
          </div>
        ) : !configured ? (
          <div className="setup-notice">
            <div className="notice-heading"><CircleAlert size={18} /> The server needs setup</div>
            <p>SelfMusic runs on your computer. In the project <strong>.env</strong> file, set <code>SELF_MUSIC_PASSWORD</code> to a password of at least 8 characters and <code>SESSION_SECRET</code> to a random value of at least 32 characters. After editing the file, restart SelfMusic on the home computer. This screen cannot read or change the file for you.</p>
            <p className="notice-foot">A webpage cannot start a background server or grant itself access to your computer's music folders. The cross-platform setup steps are in the README.</p>
            <a className="text-link" href="https://github.com/b-1-o/selfmusic#run-the-home-server" target="_blank" rel="noreferrer">Open setup guide <ArrowUpRight size={15} /></a>
          </div>
        ) : (
          <form className="login-form" onSubmit={(event) => { event.preventDefault(); onLogin({ username: username.trim(), password }); }}>
            <label htmlFor="server-username">Username (optional for the server owner)</label>
            <div className="password-wrap">
              <input
                id="server-username"
                type="text"
                autoComplete="username"
                placeholder="Username for your account"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                maxLength={32}
              />
            </div>
            <label htmlFor="server-password">Password</label>
            <div className="password-wrap">
              <LockKeyhole size={17} />
              <input
                id="server-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your server password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button type="button" className="show-password" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button>
            </div>
            {error && <p className="form-error"><CircleAlert size={15} />{error}</p>}
            {serverUnavailable && <p className="form-error"><CircleAlert size={15} />The home server is offline or unreachable.</p>}
            <button className="primary-button login-button" type="submit">Open my library <ArrowUpRight size={17} /></button>
          </form>
        )}
        <div className="login-foot"><ShieldCheck size={15} /> Your files stay on your own server.</div>
      </div>
    </div>
  );
}

function App() {
  const audioRef = useRef(null);
  const [checking, setChecking] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [serverUnavailable, setServerUnavailable] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlineTracks, setOfflineTracks] = useState(() => readLocalJson(OFFLINE_TRACKS_KEY, []));
  const [offlineTrackIds, setOfflineTrackIds] = useState(() => {
    const saved = readLocalJson(OFFLINE_TRACKS_KEY, []);
    return Array.isArray(saved) ? saved.map((track) => track?.id).filter((id) => typeof id === "string") : [];
  });
  const [offlineBusyIds, setOfflineBusyIds] = useState([]);
  const [offlineMessage, setOfflineMessage] = useState("");

  const [loginError, setLoginError] = useState("");
  const [tracks, setTracks] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [deletingTrackId, setDeletingTrackId] = useState("");
  const [trackActionMessage, setTrackActionMessage] = useState("");
  const [trackActionError, setTrackActionError] = useState(false);
  const [query, setQuery] = useState(() => { try { return localStorage.getItem("selfmusic:library-search:v1") || ""; } catch { return ""; } });
  const searchInputRef = useRef(null);
  const [youtubeQuery, setYoutubeQuery] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeUrlError, setYoutubeUrlError] = useState("");
  const [youtubeResults, setYoutubeResults] = useState([]);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeError, setYoutubeError] = useState("");
  const [selectedYoutube, setSelectedYoutube] = useState(null);
  const [youtubeJob, setYoutubeJob] = useState(null);
  const [youtubeJobSource, setYoutubeJobSource] = useState("import");
  const [youtubeJobStarting, setYoutubeJobStarting] = useState(false);
  const youtubeJobRef = useRef(null);

  const [view, setView] = useState("home");
  const [settingsSection, setSettingsSection] = useState("profile");
  const contentWrapRef = useRef(null);
  const [favorites, setFavorites] = useState([]);
  const [profile, setProfile] = useState({ id: "legacy", username: "owner", role: "admin", legacy: true });
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [selectedPlaylistTracks, setSelectedPlaylistTracks] = useState([]);
  const [playlistName, setPlaylistName] = useState("");
  const [playlistMessage, setPlaylistMessage] = useState("");
  const [playlistError, setPlaylistError] = useState(false);
  const [lastFmStatus, setLastFmStatus] = useState({ configured: false, connected: false, account: null });
  const [lastFmMessage, setLastFmMessage] = useState("");
  const [adminUsers, setAdminUsers] = useState([]);
  const [newAccountUsername, setNewAccountUsername] = useState("");
  const [newAccountPassword, setNewAccountPassword] = useState("");
  const [newAccountRole, setNewAccountRole] = useState("user");
  const [accountMessage, setAccountMessage] = useState("");
  const [accountMessageError, setAccountMessageError] = useState(false);
  const [libraryFilters, setLibraryFilters] = useState(() => ({ artist: "", album: "", year: "", genre: "", duration: "all", sort: "artist", offlineOnly: false, ...readLocalJson("selfmusic:library-filters:v1", {}) }));
  const [libraryFiltersOpen, setLibraryFiltersOpen] = useState(false);
  const [scanningLibrary, setScanningLibrary] = useState(false);
  const [libraryScanMessage, setLibraryScanMessage] = useState("");
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [duplicateMessage, setDuplicateMessage] = useState("");
  const [duplicateMessageError, setDuplicateMessageError] = useState(false);


  const [playerSettings, setPlayerSettings] = useState({ transcodingEnabled: false, formats: ["original"], defaultBitrate: "192k", bitrates: ["128k", "192k"] });
  const [streamFormat, setStreamFormat] = useState(() => readLocalJson("selfmusic:stream-quality:v1", {}).format || "original");
  const [streamBitrate, setStreamBitrate] = useState(() => readLocalJson("selfmusic:stream-quality:v1", {}).bitrate || "192k");
  const scrobbledTrackRef = useRef("");
  const historyTrackRef = useRef("");
  const nowPlayingTrackRef = useRef("");

  const [currentTrackId, setCurrentTrackId] = useState(() => localStorage.getItem(LAST_TRACK_KEY) || "");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const lastUiTimeRef = useRef(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState("off");
  const [playbackQueueIds, setPlaybackQueueIds] = useState([]);
  const [remotePlaybackState, setRemotePlaybackState] = useState(null);
  const [playbackSyncStatus, setPlaybackSyncStatus] = useState("connecting");
  const [playbackDeviceId] = useState(() => {
    const key = "selfmusic:playback-device:v1";
    try {
      const saved = localStorage.getItem(key);
      if (saved) return saved;
      const id = globalThis.crypto?.randomUUID?.() || ("device-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));
      localStorage.setItem(key, id);
      return id;
    } catch {
      return "device-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    }
  });
  const playbackSyncRevisionRef = useRef(0);
  const playbackSyncReadyRef = useRef(false);
  const playbackSyncPayloadRef = useRef(null);
  const playbackSyncPausedForRemoteRef = useRef(false);
  const playbackSyncWriteRef = useRef(false);
  const playbackSyncLastPayloadRef = useRef("");
  const pendingResumeRef = useRef(null);
  const dismissedPlaybackKeysRef = useRef(new Set());
  const [copied, setCopied] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const uploadInputRef = useRef(null);
  const [selectedUploadFiles, setSelectedUploadFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadError, setUploadError] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [importingUrl, setImportingUrl] = useState(false);
  const [urlImportMessage, setUrlImportMessage] = useState("");
  const [urlImportError, setUrlImportError] = useState(false);
  const [appearance, setAppearance] = useState(() => {
    const saved = readLocalJson(APPEARANCE_KEY, {});
    const validPreset = ACCENT_PRESETS.some((choice) => choice.id === saved?.accent) ? saved.accent : "rose";
    const presetColor = ACCENT_PRESETS.find((choice) => choice.id === validPreset)?.color || ACCENT_PRESETS[0].color;
    const hasSavedColor = typeof saved?.accentColor === "string" && /^#[0-9a-f]{6}$/i.test(saved.accentColor);
    const accentColor = hasSavedColor ? saved.accentColor : presetColor;
    const colorState = hexToHsv(accentColor);
    const matchingPreset = ACCENT_PRESETS.some((choice) => choice.id === saved?.accent && choice.color.toLowerCase() === accentColor.toLowerCase());
    return {
      accent: matchingPreset ? validPreset : (hasSavedColor ? "custom" : validPreset),
      accentColor,
      hue: Number.isFinite(saved?.hue) ? clampNumber(saved.hue, 0, 359) : colorState.hue,
      saturation: Number.isFinite(saved?.saturation) ? clampNumber(saved.saturation, 0, 100) : colorState.saturation,
      value: Number.isFinite(saved?.value) ? clampNumber(saved.value, 0, 100) : colorState.value,
      glass: ["liquid", "soft", "solid"].includes(saved?.glass) ? saved.glass : "liquid",
      theme: ["dark", "light", "system"].includes(saved?.theme) ? saved.theme : "dark",
      glassOpacity: Number.isFinite(saved?.glassOpacity) ? clampNumber(saved.glassOpacity, 35, 96) : 78,
      glassBlur: Number.isFinite(saved?.glassBlur) ? clampNumber(saved.glassBlur, 0, 36) : 24,
      cornerRadius: Number.isFinite(saved?.cornerRadius) ? clampNumber(saved.cornerRadius, 10, 32) : 20,
      density: saved?.density === "compact" ? "compact" : "comfortable",
      navPosition: ["auto", "left", "right", "bottom"].includes(saved?.navPosition) ? saved.navPosition : "auto",
      backgroundPreset: BACKGROUND_PRESETS.some((preset) => preset.id === saved?.backgroundPreset) ? saved.backgroundPreset : "midnight",
      wallpaperDataUrl: typeof saved?.wallpaperDataUrl === "string" && saved.wallpaperDataUrl.startsWith("data:image/") ? saved.wallpaperDataUrl : "",
      wallpaperDim: Number.isFinite(saved?.wallpaperDim) ? clampNumber(saved.wallpaperDim, 5, 85) : 38,
      wallpaperBlur: Number.isFinite(saved?.wallpaperBlur) ? clampNumber(saved.wallpaperBlur, 0, 18) : 0,
      animations: saved?.animations !== false,
      animationSpeed: ["slow", "normal", "fast"].includes(saved?.animationSpeed) ? saved.animationSpeed : "normal",
    };
  });
  const [appearanceMessage, setAppearanceMessage] = useState("");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [systemTheme, setSystemTheme] = useState(() => {
    try { return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; } catch { return "dark"; }
  });
  const [networkAddresses, setNetworkAddresses] = useState({ local: [], tailscale: [] });
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState("");
  const [serverCheckBusy, setServerCheckBusy] = useState(false);
  const [serverCheckMessage, setServerCheckMessage] = useState("");
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [pwaInstalled, setPwaInstalled] = useState(() => {
    try {
      return Boolean(window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true);
    } catch {
      return false;
    }
  });
  const [pwaInstallMessage, setPwaInstallMessage] = useState("");
  const [remoteWizardOpen, setRemoteWizardOpen] = useState(() => localStorage.getItem(REMOTE_WIZARD_KEY) !== "1");

  const currentTrack = tracks.find((track) => track.id === currentTrackId) || null;
  const remotePlaybackTrack = useMemo(
    () => remotePlaybackState?.currentTrackId ? tracks.find((track) => track.id === remotePlaybackState.currentTrackId) || null : null,
    [remotePlaybackState, tracks]
  );
  const activeQueueTracks = useMemo(() => {
    if (!playbackQueueIds.length) return tracks;
    const trackById = new Map(tracks.map((track) => [track.id, track]));
    return playbackQueueIds.map((id) => trackById.get(id)).filter(Boolean);
  }, [playbackQueueIds, tracks]);
  const syncQueue = useMemo(() => {
    const knownTrackIds = new Set(tracks.map((track) => track.id));
    let queue = playbackQueueIds.length
      ? playbackQueueIds.filter((id) => knownTrackIds.has(id))
      : tracks.map((track) => track.id);
    if (queue.length > 500) {
      const currentIndex = queue.indexOf(currentTrackId);
      const start = currentIndex >= 0 ? Math.max(0, Math.min(currentIndex - 250, queue.length - 500)) : 0;
      queue = queue.slice(start, start + 500);
    }
    if (currentTrackId && knownTrackIds.has(currentTrackId) && !queue.includes(currentTrackId)) {
      if (queue.length >= 500) queue = [...queue.slice(0, 499), currentTrackId];
      else queue = [...queue, currentTrackId];
    }
    return queue;
  }, [playbackQueueIds, tracks, currentTrackId]);
  playbackSyncPayloadRef.current = {
    queue: syncQueue,
    currentTrackId: syncQueue.includes(currentTrackId) ? currentTrackId : null,
    positionSeconds: Math.max(0, Math.min(86400, Number.isFinite(currentTime) ? currentTime : 0)),
    isPlaying: Boolean(isPlaying && syncQueue.includes(currentTrackId)),
    repeatMode: ["off", "one", "all"].includes(repeatMode) ? repeatMode : "off",
    shuffle: Boolean(shuffle),
    sourceDeviceId: playbackDeviceId
  };
  const playerTint = useMemo(() => {
    const hex = /^#[0-9a-f]{6}$/i.test(appearance.accentColor) ? appearance.accentColor : "#f1a0ba";
    return [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
      .map((channel) => Number.parseInt(channel, 16))
      .join(",");
  }, [appearance.accentColor]);

  useEffect(() => {
    if (!authenticated || offlineMode || !preferencesReady) {
      if (!authenticated || offlineMode) {
        playbackSyncReadyRef.current = false;
        setPlaybackSyncStatus("offline");
      }
      return undefined;
    }

    let source;
    try {
      source = new EventSource("/api/playback/events");
    } catch {
      setPlaybackSyncStatus("offline");
      return undefined;
    }
    const onPlaybackState = (event) => {
      try {
        const state = JSON.parse(event.data);
        if (!state || !Number.isSafeInteger(Number(state.revision))) return;
        playbackSyncRevisionRef.current = Number(state.revision);
        playbackSyncReadyRef.current = true;
        setPlaybackSyncStatus("connected");

        if (state.sourceDeviceId && state.sourceDeviceId !== playbackDeviceId && state.currentTrackId) {
          playbackSyncPausedForRemoteRef.current = true;
          const dismissalKey = remotePlaybackDismissalKey(state);
          setRemotePlaybackState(dismissedPlaybackKeysRef.current.has(dismissalKey) ? null : state);
        } else if (state.sourceDeviceId === playbackDeviceId || !state.currentTrackId) {
          playbackSyncPausedForRemoteRef.current = false;
          setRemotePlaybackState(null);
        }
      } catch {
        // Ignore malformed events; EventSource will continue listening.
      }
    };
    source.addEventListener("playback-state", onPlaybackState);
    source.onopen = () => setPlaybackSyncStatus("connected");
    source.onerror = () => setPlaybackSyncStatus("reconnecting");
    return () => source.close();
  }, [authenticated, playbackDeviceId, offlineMode, preferencesReady]);

  useEffect(() => {
    if (!authenticated || offlineMode || !preferencesReady) return undefined;
    let active = true;
    const refreshDismissedPlayback = async () => {
      try {
        const response = await fetch("/api/preferences/dismissed-playback", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = await response.json();
        const remoteKeys = Array.isArray(body.value?.keys) ? body.value.keys.filter((key) => typeof key === "string") : [];
        const keys = [...new Set([...dismissedPlaybackKeysRef.current, ...remoteKeys])].slice(-100);
        dismissedPlaybackKeysRef.current = new Set(keys);
        const storageKey = REMOTE_PLAYBACK_DISMISSED_KEY + ":" + (profile.id || "legacy");
        try { localStorage.setItem(storageKey, JSON.stringify(keys)); } catch {}
        if (keys.length !== remoteKeys.length || keys.some((key) => !remoteKeys.includes(key))) {
          fetch("/api/preferences/dismissed-playback", {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: { keys } }),
          }).catch(() => {});
        }
        setRemotePlaybackState((current) => {
          if (current && dismissedPlaybackKeysRef.current.has(remotePlaybackDismissalKey(current))) {
            playbackSyncPausedForRemoteRef.current = true;
            return null;
          }
          return current;
        });
      } catch {
        // The local dismissal cache remains effective if preference sync is temporarily unavailable.
      }
    };
    refreshDismissedPlayback();
    const timer = window.setInterval(() => { if (active) refreshDismissedPlayback(); }, 12000);
    return () => { active = false; window.clearInterval(timer); };
  }, [authenticated, offlineMode, preferencesReady, profile.id]);

  useEffect(() => {
    if (!authenticated) return undefined;
    const timer = window.setInterval(async () => {
      if (!playbackSyncReadyRef.current || playbackSyncPausedForRemoteRef.current || playbackSyncWriteRef.current) return;
      const payload = playbackSyncPayloadRef.current;
      if (!payload) return;
      const signature = JSON.stringify(payload);
      if (signature === playbackSyncLastPayloadRef.current) return;

      playbackSyncWriteRef.current = true;
      try {
        const response = await fetch("/api/playback/state", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, expectedRevision: playbackSyncRevisionRef.current })
        });
        const body = await response.json().catch(() => ({}));
        if (response.status === 409 && body.state) {
          playbackSyncRevisionRef.current = Number(body.state.revision) || 0;
          if (body.state.sourceDeviceId && body.state.sourceDeviceId !== playbackDeviceId && body.state.currentTrackId) {
            playbackSyncPausedForRemoteRef.current = true;
            setRemotePlaybackState(body.state);
          }
          setPlaybackSyncStatus("connected");
          playbackSyncLastPayloadRef.current = "";
          return;
        }
        if (!response.ok || !body.state) throw new Error("Playback sync is unavailable.");
        playbackSyncRevisionRef.current = Number(body.state.revision) || playbackSyncRevisionRef.current;
        playbackSyncLastPayloadRef.current = signature;
        setPlaybackSyncStatus("connected");
      } catch {
        setPlaybackSyncStatus("offline");
      } finally {
        playbackSyncWriteRef.current = false;
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [authenticated, playbackDeviceId]);

  useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPromptEvent(event);
    };
    const onInstalled = () => {
      setPwaInstalled(true);
      setInstallPromptEvent(null);
      setPwaInstallMessage("SelfMusic was installed on this device.");
    };
    const displayMode = window.matchMedia?.("(display-mode: standalone)");
    const onDisplayModeChange = () => setPwaInstalled(Boolean(displayMode?.matches || navigator.standalone === true));
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    displayMode?.addEventListener?.("change", onDisplayModeChange);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      displayMode?.removeEventListener?.("change", onDisplayModeChange);
    };
  }, []);

  useEffect(() => {
    const onOnline = () => setPlaybackSyncStatus("reconnecting");
    const onOffline = () => setPlaybackSyncStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const refreshNetworkAddresses = useCallback(async () => {
    setNetworkLoading(true);
    setNetworkError("");
    try {
      const response = await fetch("/api/network/addresses");
      if (response.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!response.ok) throw new Error(await readMessage(response));
      const addresses = await response.json();
      setNetworkAddresses({
        local: Array.isArray(addresses.local) ? addresses.local : [],
        tailscale: Array.isArray(addresses.tailscale) ? addresses.tailscale : [],
      });
    } catch (error) {
      setNetworkError(error.message || "Couldn't check this computer's network addresses.");
    } finally {
      setNetworkLoading(false);
    }
  }, []);

  const reconnectServer = useCallback(async () => {
    setServerCheckBusy(true);
    setServerCheckMessage("");
    const startedAt = Date.now();
    try {
      const response = await fetch("/api/health", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" }
      });
      if (!response.ok) throw new Error("The server returned HTTP " + response.status + ".");
      const health = await response.json();
      if (health?.ok !== true) throw new Error("The server health check did not confirm readiness.");
      setServerUnavailable(false);
      setServerCheckMessage(Date.now() - startedAt > 900 ? "Server reachable, but response was slow." : "Server is reachable.");
      await refreshNetworkAddresses();
      setPlaybackSyncStatus("reconnecting");
    } catch (error) {
      setServerUnavailable(true);
      setPlaybackSyncStatus("offline");
      setServerCheckMessage(error.message || "Could not reach the SelfMusic server.");
    } finally {
      setServerCheckBusy(false);
    }
  }, [refreshNetworkAddresses]);

  const installSelfMusic = useCallback(async () => {
    setPwaInstallMessage("");
    if (pwaInstalled) {
      setPwaInstallMessage("SelfMusic is already installed on this device.");
      return;
    }
    if (installPromptEvent) {
      try {
        await installPromptEvent.prompt();
        const choice = await installPromptEvent.userChoice;
        if (choice?.outcome === "accepted") {
          setPwaInstalled(true);
          setPwaInstallMessage("Installation accepted. Follow your browser's confirmation.");
        } else {
          setPwaInstallMessage("Installation was dismissed. You can install it from the browser menu later.");
        }
      } catch {
        setPwaInstallMessage("The browser could not open its install prompt. Use its menu to install SelfMusic.");
      } finally {
        setInstallPromptEvent(null);
      }
      return;
    }

    const userAgent = navigator.userAgent || "";
    if (/iphone|ipad|ipod/i.test(userAgent)) {
      setPwaInstallMessage("On iPhone or iPad: open Safari's Share menu, then choose Add to Home Screen.");
    } else if (!/^https:$/i.test(window.location.protocol) && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      setPwaInstallMessage("Use the HTTPS server address to enable PWA installation, then open the browser menu.");
    } else {
      setPwaInstallMessage("Open the browser menu and choose Install app or Create shortcut. The exact wording depends on your browser.");
    }
  }, [installPromptEvent, pwaInstalled]);

  const closeRemoteWizard = useCallback(() => {
    setRemoteWizardOpen(false);
    localStorage.setItem(REMOTE_WIZARD_KEY, "1");
  }, []);

  const updateAccentFromField = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const saturation = Math.round(clampNumber((event.clientX - bounds.left) / bounds.width, 0, 1) * 100);
    const brightness = Math.round((1 - clampNumber((event.clientY - bounds.top) / bounds.height, 0, 1)) * 100);
    setAppearance((current) => ({
      ...current,
      accent: "custom",
      saturation,
      value: brightness,
      accentColor: hsvToHex(current.hue, saturation, brightness),
    }));
  };

  const handleAccentFieldKeyDown = (event) => {
    const step = event.shiftKey ? 5 : 1;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    setAppearance((current) => {
      const saturation = clampNumber(current.saturation + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0), 0, 100);
      const brightness = clampNumber(current.value + (event.key === "ArrowDown" ? -step : event.key === "ArrowUp" ? step : 0), 0, 100);
      return { ...current, accent: "custom", saturation, value: brightness, accentColor: hsvToHex(current.hue, saturation, brightness) };
    });
  };

  useEffect(() => {
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance)); } catch {
      setAppearanceMessage("Appearance is available on this device, but browser storage is full.");
    }
  }, [appearance]);

  useEffect(() => {
    if (!authenticated || offlineMode) {
      setPreferencesReady(false);
      return undefined;
    }
    let active = true;
    setPreferencesReady(false);
    const loadPreferences = async () => {
      try {
        const response = await fetch("/api/preferences", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.status === 401) {
          if (active) setAuthenticated(false);
          return;
        }
        if (!response.ok) throw new Error("Account preferences are unavailable.");
        const body = await response.json();
        const savedAppearance = body.preferences?.appearance;
        if (savedAppearance && typeof savedAppearance === "object" && !Array.isArray(savedAppearance)) {
          setAppearance((current) => ({ ...current, ...savedAppearance }));
        }

        const storageKey = REMOTE_PLAYBACK_DISMISSED_KEY + ":" + (profile.id || "legacy");
        const localKeysValue = readLocalJson(storageKey, []);
        const localKeys = Array.isArray(localKeysValue) ? localKeysValue.filter((key) => typeof key === "string") : [];
        const remoteKeys = body.preferences?.["dismissed-playback"]?.keys;
        const validRemoteKeys = Array.isArray(remoteKeys) ? remoteKeys.filter((key) => typeof key === "string") : [];
        const keys = [...new Set([...localKeys, ...validRemoteKeys])].slice(-100);
        dismissedPlaybackKeysRef.current = new Set(keys);
        try { localStorage.setItem(storageKey, JSON.stringify(keys)); } catch {}
        if (keys.length && (keys.length !== validRemoteKeys.length || keys.some((key) => !validRemoteKeys.includes(key)))) {
          fetch("/api/preferences/dismissed-playback", {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: { keys } }),
          }).catch(() => {});
        }
      } catch {
        const storageKey = REMOTE_PLAYBACK_DISMISSED_KEY + ":" + (profile.id || "legacy");
        const localKeysValue = readLocalJson(storageKey, []);
        dismissedPlaybackKeysRef.current = new Set(Array.isArray(localKeysValue) ? localKeysValue.filter((key) => typeof key === "string") : []);
      } finally {
        if (active) setPreferencesReady(true);
      }
    };
    loadPreferences();
    return () => { active = false; };
  }, [authenticated, offlineMode, profile.id]);

  useEffect(() => {
    if (!authenticated || offlineMode || !preferencesReady) return undefined;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/preferences/appearance", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: appearance }),
        });
        if (!response.ok) throw new Error("Could not sync appearance.");
      } catch {
        setAppearanceMessage("Appearance is saved on this device; account sync is unavailable.");
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [appearance, authenticated, offlineMode, preferencesReady]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!media) return undefined;
    const update = (event) => setSystemTheme(event.matches ? "light" : "dark");
    setSystemTheme(media.matches ? "light" : "dark");
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    try { localStorage.setItem("selfmusic:library-filters:v1", JSON.stringify(libraryFilters)); } catch { /* Filters remain usable if storage is disabled. */ }
  }, [libraryFilters]);

  useEffect(() => {
    try { localStorage.setItem("selfmusic:library-search:v1", query); } catch { /* Search remains usable if storage is disabled. */ }
  }, [query]);

  useEffect(() => {
    const container = contentWrapRef.current;
    if (!container) return undefined;
    container.classList.remove("view-entering");
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => container.classList.add("view-entering"));
    });
    const timer = window.setTimeout(() => container.classList.remove("view-entering"), 480);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(timer);
    };
  }, [view]);

  useEffect(() => {
    if (!trackActionMessage) return undefined;
    const timer = window.setTimeout(() => setTrackActionMessage(""), 1500);
    return () => window.clearTimeout(timer);
  }, [trackActionMessage]);

  useEffect(() => {
    if (!uploadMessage) return undefined;
    const timer = window.setTimeout(() => setUploadMessage(""), 1500);
    return () => window.clearTimeout(timer);
  }, [uploadMessage]);

  useEffect(() => {
    if (!urlImportMessage) return undefined;
    const timer = window.setTimeout(() => setUrlImportMessage(""), 1500);
    return () => window.clearTimeout(timer);
  }, [urlImportMessage]);

  useEffect(() => {
    if (!authenticated) return;
    refreshNetworkAddresses();
  }, [authenticated, refreshNetworkAddresses]);


  const loadTracks = useCallback(async () => {
    setLoadingTracks(true);
    setLoadError("");
    try {
      const response = await fetch("/api/tracks");
      if (response.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!response.ok) throw new Error(await readMessage(response));
      const body = await response.json();
      setTracks(body.tracks || []);
      setOfflineMode(false);
      if (body.truncated) setLoadError("Your library is very large; only the first 20,000 tracks are shown.");
      setAuthenticated(true);
    } catch (error) {
      try {
        const saved = await readOfflineLibraryFromCache();
        if (saved.tracks.length) {
          setOfflineTracks(saved.tracks);
          setOfflineTrackIds(saved.ids);
          setTracks(saved.tracks);
          setOfflineMode(true);
          setProfile({ id: "offline", username: "Offline mode", role: "user", legacy: false });
          setLoadError("");
          return;
        }
      } catch {}
      setLoadError(error.message || "The music library could not be loaded.");
    } finally {
      setLoadingTracks(false);
    }
  }, []);

  const refreshOfflineLibrary = useCallback(async () => {
    setLoadingTracks(true);
    setOfflineMessage("");
    try {
      const saved = await readOfflineLibraryFromCache();
      setOfflineTracks(saved.tracks);
      setOfflineTrackIds(saved.ids);
      if (offlineMode) {
        setTracks(saved.tracks);
        setLoadError("");
      }
      setOfflineMessage(
        saved.tracks.length
          ? "Offline library refreshed."
          : "No tracks are saved on this device yet. Save tracks from your library while connected."
      );
    } catch (error) {
      setOfflineMessage(error.message || "Could not refresh saved offline tracks.");
    } finally {
      setLoadingTracks(false);
    }
  }, [offlineMode]);

  const handleDeleteTrack = useCallback(async (track) => {
    if (!track || deletingTrackId) return;
    const confirmed = window.confirm(
      'Permanently delete "' + track.title + '" from the server? This removes the actual audio file and cannot be undone.'
    );
    if (!confirmed) return;

    setDeletingTrackId(track.id);
    setTrackActionMessage("");
    setTrackActionError(false);
    try {
      const response = await fetch("/api/tracks/" + encodeURIComponent(track.id), {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) {
        setAuthenticated(false);
        throw new Error("Your session expired. Sign in again before deleting tracks.");
      }
      if (!response.ok) throw new Error(await readMessage(response));
      const result = await response.json();

      setTracks((items) => items.filter((item) => item.id !== track.id));
      setFavorites((items) => items.filter((id) => id !== track.id));
      if (currentTrackId === track.id) {
        audioRef.current?.pause();
        if (audioRef.current) {
          audioRef.current.removeAttribute("src");
          audioRef.current.load();
        }
        setIsPlaying(false);
        setCurrentTrackId("");
        setCurrentTime(0);
        setDuration(0);
        localStorage.removeItem(LAST_TRACK_KEY);
      }
      setTrackActionMessage('Deleted "' + (result.name || track.title) + '" from the server.');
    } catch (error) {
      setTrackActionError(true);
      setTrackActionMessage(error.message || "Could not delete this track. Check the server and try again.");
    } finally {
      setDeletingTrackId("");
    }
  }, [currentTrackId, deletingTrackId]);

  useEffect(() => {
    const handleSearchShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  useEffect(() => {
    let active = true;
    readOfflineLibraryFromCache().then((saved) => {
      if (!active) return;
      setOfflineTracks(saved.tracks);
      setOfflineTrackIds(saved.ids);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store", headers: { "Cache-Control": "no-cache" } })
      .then((response) => {
        if (!response.ok) throw new Error("server_unavailable");
        return response.json();
      })
      .then((state) => {
        if (!active) return;
        setConfigured(Boolean(state.configured));
        setAuthenticated(Boolean(state.authenticated));
        setChecking(false);
        if (state.authenticated) loadTracks();
      })
      .catch(async () => {
        if (!active) return;
        try {
          const saved = await readOfflineLibraryFromCache();
          if (active && saved.tracks.length) {
            setOfflineTracks(saved.tracks);
            setOfflineTrackIds(saved.ids);
            setTracks(saved.tracks);
            setOfflineMode(true);
            setConfigured(true);
            setAuthenticated(true);
            setProfile({ id: "offline", username: "Offline mode", role: "user", legacy: false });
            setView("library");
            setServerUnavailable(false);
            setLoadError("");
            setChecking(false);
            return;
          }
        } catch {}
        if (!active) return;
        setServerUnavailable(true);
        setChecking(false);
      });
    return () => { active = false; };
  }, [loadTracks]);

  useEffect(() => {
    if (!offlineMode) return undefined;
    const recoverConnection = async () => {
      if (!navigator.onLine) return;
      try {
        const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store", headers: { "Cache-Control": "no-cache" } });
        if (!response.ok) return;
        const state = await response.json();
        setOfflineMode(false);
        setServerUnavailable(false);
        setConfigured(Boolean(state.configured));
        setAuthenticated(Boolean(state.authenticated));
        if (state.authenticated) {
          await loadTracks();
          try {
            const profileResponse = await fetch("/api/auth/profile", { credentials: "same-origin", cache: "no-store" });
            if (profileResponse.ok) {
              const profileBody = await profileResponse.json();
              setProfile(profileBody.user || { id: "legacy", username: "owner", role: "admin", legacy: true });
            }
          } catch {}
        }
      } catch {
        // Keep the saved local library available until the server is reachable again.
      }
    };
    window.addEventListener("online", recoverConnection);
    return () => window.removeEventListener("online", recoverConnection);
  }, [offlineMode, loadTracks]);

  useEffect(() => {
    if (!authenticated) return undefined;
    let active = true;
    const loadAccountData = async () => {
      try {
        const profileResponse = await fetch("/api/auth/profile", { credentials: "same-origin", cache: "no-store" });
        if (profileResponse.status === 401) { setAuthenticated(false); return; }
        if (!profileResponse.ok) throw new Error("Could not load account profile.");
        const profileBody = await profileResponse.json();
        const user = profileBody.user || { id: "legacy", username: "owner", role: "admin", legacy: true };
        if (active) setProfile(user);
        if (user.role === "admin") {
          const usersResponse = await fetch("/api/admin/users", { credentials: "same-origin", cache: "no-store" });
          if (active && usersResponse.ok) {
            const usersBody = await usersResponse.json();
            setAdminUsers(usersBody.users || []);
          }
        } else if (active) {
          setAdminUsers([]);
        }
        if (user.role === "admin") {
          const duplicatesResponse = await fetch("/api/duplicates", { credentials: "same-origin", cache: "no-store" });
          if (active && duplicatesResponse.ok) setDuplicateGroups((await duplicatesResponse.json()).groups || []);
        } else if (active) {
          setDuplicateGroups([]);
        }

        let favoriteResponse = await fetch("/api/favorites", { credentials: "same-origin", cache: "no-store" });
        let favoriteBody = favoriteResponse.ok ? await favoriteResponse.json() : { tracks: [] };
        let serverFavoriteIds = (favoriteBody.tracks || []).map((track) => track.id);
        if (user.legacy && serverFavoriteIds.length === 0) {
          const previousFavorites = readLocalJson(FAVORITES_KEY, []);
          for (const id of previousFavorites.slice(0, 500)) {
            await fetch("/api/favorites/" + encodeURIComponent(id), { method: "POST", credentials: "same-origin" }).catch(() => {});
          }
          if (previousFavorites.length) {
            favoriteResponse = await fetch("/api/favorites", { credentials: "same-origin", cache: "no-store" });
            favoriteBody = favoriteResponse.ok ? await favoriteResponse.json() : { tracks: [] };
            serverFavoriteIds = (favoriteBody.tracks || []).map((track) => track.id);
          }
        }
        if (active) setFavorites(serverFavoriteIds);

        const [playlistResponse, lastFmResponse, playerResponse] = await Promise.all([
          fetch("/api/playlists", { credentials: "same-origin", cache: "no-store" }),
          fetch("/api/lastfm/status", { credentials: "same-origin", cache: "no-store" }),
          fetch("/api/player/settings", { credentials: "same-origin", cache: "no-store" }),
        ]);
        if (active && playlistResponse.ok) {
          const body = await playlistResponse.json();
          setPlaylists(body.playlists || []);
        }
        if (active && lastFmResponse.ok) setLastFmStatus(await lastFmResponse.json());
        if (active && playerResponse.ok) setPlayerSettings(await playerResponse.json());
        if (active && new URLSearchParams(window.location.search).get("lastfm") === "connected") {
          setLastFmMessage("Last.fm connected successfully.");
          window.history.replaceState({}, "", window.location.pathname + window.location.hash);
        }
      } catch {
        // Library playback still works when optional account services are unavailable.
      }
    };
    loadAccountData();
    return () => { active = false; };
  }, [authenticated]);

  useEffect(() => {
    localStorage.setItem("selfmusic:stream-quality:v1", JSON.stringify({ format: streamFormat, bitrate: streamBitrate }));
  }, [streamFormat, streamBitrate]);

  useEffect(() => {
    if (currentTrackId) localStorage.setItem(LAST_TRACK_KEY, currentTrackId);
  }, [currentTrackId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = muted ? 0 : volume;
  }, [volume, muted]);

  const handleLogin = useCallback(async ({ username, password }) => {
    setLoginError("");
    setServerUnavailable(false);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(username ? { username, password } : { password }),
      });
      if (!response.ok) {
        setLoginError(await readMessage(response));
        return;
      }

      // A short retry helps browsers which persist a Set-Cookie asynchronously.
      let session = { authenticated: false, sessionStatus: "missing" };
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, attempt * 250));
        const sessionResponse = await fetch("/api/auth/session", {
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        session = sessionResponse.ok ? await sessionResponse.json() : { authenticated: false, sessionStatus: "missing" };
        if (session.authenticated) break;
      }

      if (!session.authenticated) {
        if (session.sessionStatus === "invalid") {
          setLoginError("The browser sent a session cookie, but the server rejected it. Restart SelfMusic with selfmusic restart and try again. If this keeps happening, send the server log without sharing your .env.");
        } else {
          setLoginError("Safari still isn't sending the sign-in cookie. Confirm you're using https://blood.tail358c96.ts.net, then clear this site's website data in Safari and try again.");
        }
        return;
      }
      setAuthenticated(true);
      await loadTracks();
    } catch {
      setServerUnavailable(true);
    }
  }, [loadTracks]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      audioRef.current?.pause();
      try {
        if ("caches" in window) await window.caches.delete(OFFLINE_AUDIO_CACHE);
        localStorage.removeItem(OFFLINE_TRACKS_KEY);
      } catch {
        // The browser may reject storage cleanup; the session still needs to end.
      }
      setOfflineTracks([]);
      setOfflineTrackIds([]);
      setOfflineMode(false);
      setOfflineMessage("");
      setIsPlaying(false);
      setAuthenticated(false);
      setTracks([]);
      setFavorites([]);
      setPlaylists([]);
      setSelectedPlaylist(null);
      setSelectedPlaylistTracks([]);
      setProfile({ id: "legacy", username: "owner", role: "admin", legacy: true });
      setLastFmStatus({ configured: false, connected: false, account: null });
      setView("home");
    }
  }, []);

  const refreshPlaylists = useCallback(async () => {
    const response = await fetch("/api/playlists", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) { setAuthenticated(false); return; }
    if (!response.ok) throw new Error(await readMessage(response));
    const body = await response.json();
    setPlaylists(body.playlists || []);
  }, []);

  const createPlaylist = useCallback(async (name) => {
    const response = await fetch("/api/playlists", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!response.ok) throw new Error(await readMessage(response));
    const body = await response.json();
    setPlaylists((items) => [body.playlist, ...items]);
    setPlaylistName("");
    setPlaylistMessage("Playlist created.");
    setPlaylistError(false);
    return body.playlist;
  }, []);

  const openSmartPlaylist = useCallback(async (kind) => {
    try {
      const response = await fetch("/api/playlists/smart/" + encodeURIComponent(kind), { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await readMessage(response));
      const body = await response.json();
      setSelectedPlaylist(body);
      setSelectedPlaylistTracks(body.tracks || []);
      setPlaylistMessage("");
      setPlaylistError(false);
    } catch (error) {
      setPlaylistMessage(error.message || "Could not load smart playlist.");
      setPlaylistError(true);
    }
  }, []);

  const openPlaylist = useCallback(async (playlist) => {
    try {
      const response = await fetch("/api/playlists/" + encodeURIComponent(playlist.id), { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await readMessage(response));
      const body = await response.json();
      setSelectedPlaylist(body.playlist);
      setSelectedPlaylistTracks(body.playlist.tracks || []);
    } catch (error) {
      setPlaylistMessage(error.message || "Could not open playlist.");
      setPlaylistError(true);
    }
  }, []);

  const addTrackToPlaylist = useCallback(async (playlistId, trackId) => {
    const response = await fetch("/api/playlists/" + encodeURIComponent(playlistId) + "/tracks", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId }),
    });
    if (!response.ok) throw new Error(await readMessage(response));
    const body = await response.json();
    if (selectedPlaylist?.id === playlistId) {
      setSelectedPlaylistTracks(body.playlist.tracks || []);
      setSelectedPlaylist(body.playlist);
    }
    await refreshPlaylists();
    setPlaylistMessage("Track added to playlist.");
    setPlaylistError(false);
  }, [refreshPlaylists, selectedPlaylist]);

  const removeTrackFromPlaylist = useCallback(async (playlistId, trackId) => {
    const response = await fetch("/api/playlists/" + encodeURIComponent(playlistId) + "/tracks/" + encodeURIComponent(trackId), {
      method: "DELETE", credentials: "same-origin",
    });
    if (!response.ok) throw new Error(await readMessage(response));
    setSelectedPlaylistTracks((items) => items.filter((track) => track.id !== trackId));
    await refreshPlaylists();
    setPlaylistMessage("Track removed.");
    setPlaylistError(false);
  }, [refreshPlaylists]);

  const deletePlaylist = useCallback(async (playlistId) => {
    if (!window.confirm("Delete this playlist? The audio files will not be removed.")) return;
    const response = await fetch("/api/playlists/" + encodeURIComponent(playlistId), { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) throw new Error(await readMessage(response));
    setPlaylists((items) => items.filter((item) => item.id !== playlistId));
    if (selectedPlaylist?.id === playlistId) {
      setSelectedPlaylist(null);
      setSelectedPlaylistTracks([]);
    }
    setPlaylistMessage("Playlist deleted.");
    setPlaylistError(false);
  }, [selectedPlaylist]);

  const connectLastFm = useCallback(async () => {
    setLastFmMessage("");
    try {
      const response = await fetch("/api/lastfm/connect", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(await readMessage(response));
      const body = await response.json();
      if (body.authUrl) window.location.assign(body.authUrl);
    } catch (error) {
      setLastFmMessage(error.message || "Could not connect to Last.fm.");
    }
  }, []);

  const disconnectLastFm = useCallback(async () => {
    const response = await fetch("/api/lastfm/connect", { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) {
      setLastFmMessage(await readMessage(response));
      return;
    }
    setLastFmStatus({ configured: Boolean(lastFmStatus.configured), connected: false, account: null });
    setLastFmMessage("Last.fm disconnected.");
  }, [lastFmStatus.configured]);

  const scanLibraryNow = useCallback(async () => {
    setScanningLibrary(true);
    setLibraryScanMessage("");
    try {
      const response = await fetch("/api/library/scan", { method: "POST", credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await readMessage(response));
      const body = await response.json();
      setLibraryScanMessage("Scan complete — " + body.tracks + " tracks indexed.");
      await loadTracks();
    } catch (error) {
      setLibraryScanMessage(error.message || "Library scan failed.");
    } finally {
      setScanningLibrary(false);
    }
  }, [loadTracks]);

  const refreshDuplicates = useCallback(async () => {
    setDuplicateLoading(true);
    setDuplicateMessage("");
    try {
      const response = await fetch("/api/duplicates", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await readMessage(response));
      const body = await response.json();
      setDuplicateGroups(body.groups || []);
    } catch (error) {
      setDuplicateMessage(error.message || "Could not scan for duplicates.");
      setDuplicateMessageError(true);
    } finally {
      setDuplicateLoading(false);
    }
  }, []);

  const mergeDuplicateGroup = useCallback(async (group) => {
    if (!group.tracks || group.tracks.length < 2) return;
    const keeper = group.tracks[0];
    if (!window.confirm("Keep “" + keeper.title + "” and remove " + (group.tracks.length - 1) + " identical files? Favorites, playlists, and listening history will be moved to the retained track.")) return;
    setDuplicateMessage("");
    try {
      const response = await fetch("/api/duplicates/merge", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepId: keeper.id, duplicateIds: group.tracks.slice(1).map((track) => track.id) }),
      });
      if (!response.ok) throw new Error(await readMessage(response));
      const body = await response.json();
      setDuplicateMessage("Merged " + body.removed + " duplicate files.");
      setDuplicateMessageError(false);
      await Promise.all([refreshDuplicates(), loadTracks()]);
    } catch (error) {
      setDuplicateMessage(error.message || "Could not merge these duplicates.");
      setDuplicateMessageError(true);
    }
  }, [loadTracks, refreshDuplicates]);

  const deleteDuplicate = useCallback(async (track) => {
    if (!window.confirm("Permanently delete “" + track.title + "” from disk? This cannot be undone.")) return;
    setDuplicateMessage("");
    try {
      const response = await fetch("/api/duplicates/" + encodeURIComponent(track.id), { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error(await readMessage(response));
      setDuplicateMessage("Deleted duplicate file.");
      setDuplicateMessageError(false);
      await Promise.all([refreshDuplicates(), loadTracks()]);
    } catch (error) {
      setDuplicateMessage(error.message || "Could not delete this file.");
      setDuplicateMessageError(true);
    }
  }, [loadTracks, refreshDuplicates]);

  const createAccount = useCallback(async (event) => {
    event.preventDefault();
    setAccountMessage("");
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newAccountUsername, password: newAccountPassword, role: newAccountRole }),
      });
      if (!response.ok) throw new Error(await readMessage(response));
      const body = await response.json();
      setAdminUsers((items) => [...items, body.user]);
      setNewAccountUsername("");
      setNewAccountPassword("");
      setNewAccountRole("user");
      setAccountMessage("Created account " + body.user.username + ".");
      setAccountMessageError(false);
    } catch (error) {
      setAccountMessage(error.message || "Could not create account.");
      setAccountMessageError(true);
    }
  }, [newAccountUsername, newAccountPassword, newAccountRole]);

  const changeAccountRole = useCallback(async (user, role) => {
    try {
      const response = await fetch("/api/admin/users/" + encodeURIComponent(user.id), {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) throw new Error(await readMessage(response));
      setAdminUsers((items) => items.map((item) => item.id === user.id ? { ...item, role } : item));
    } catch (error) {
      setAccountMessage(error.message || "Could not update account role.");
      setAccountMessageError(true);
    }
  }, []);

  const deleteAccount = useCallback(async (user) => {
    if (!window.confirm("Delete account " + user.username + "? This removes that account's playlists, favorites, and history.")) return;
    try {
      const response = await fetch("/api/admin/users/" + encodeURIComponent(user.id), { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error(await readMessage(response));
      setAdminUsers((items) => items.filter((item) => item.id !== user.id));
      setAccountMessage("Deleted account " + user.username + ".");
      setAccountMessageError(false);
    } catch (error) {
      setAccountMessage(error.message || "Could not delete account.");
      setAccountMessageError(true);
    }
  }, []);

  const playTrack = useCallback((track) => {
    if (!track || !audioRef.current) return;
    playbackSyncPausedForRemoteRef.current = false;
    setRemotePlaybackState(null);
    if (pendingResumeRef.current?.trackId !== track.id) pendingResumeRef.current = null;
    setPlaybackQueueIds((existing) => {
      if (existing.includes(track.id)) return existing;
      const ids = tracks.map((item) => item.id);
      if (ids.length <= 500) return ids;
      const trackIndex = Math.max(0, ids.indexOf(track.id));
      const start = Math.max(0, Math.min(trackIndex - 250, ids.length - 500));
      return ids.slice(start, start + 500);
    });
    playbackSyncLastPayloadRef.current = "";
    setSelectedYoutube(null);
    const audio = audioRef.current;
    const requestedFormat = playerSettings.transcodingEnabled ? streamFormat : "original";
    const hasOfflineCopy = offlineTrackIds.includes(track.id) && "serviceWorker" in navigator && Boolean(navigator.serviceWorker.controller);
    const streamUrl = hasOfflineCopy
      ? offlineTrackUrl(track.id)
      : requestedFormat === "original"
        ? track.streamUrl
        : track.streamUrl + "?format=" + encodeURIComponent(requestedFormat) + "&bitrate=" + encodeURIComponent(streamBitrate);
    if (audio.getAttribute("src") !== streamUrl) {
      // Assigning src already starts resource selection; load() here can restart it.
      audio.src = streamUrl;
    }
    lastUiTimeRef.current = 0;
    scrobbledTrackRef.current = "";
    historyTrackRef.current = "";
    nowPlayingTrackRef.current = "";
    setCurrentTrackId(track.id);
    setCurrentTime(0);
    setDuration(0);
    audio.play().catch(() => setIsPlaying(false));
  }, [playerSettings.transcodingEnabled, streamFormat, streamBitrate, offlineTrackIds, tracks]);

  const playNext = useCallback(() => {
    const queue = activeQueueTracks.length ? activeQueueTracks : tracks;
    if (!queue.length) return;
    const index = queue.findIndex((track) => track.id === currentTrackId);
    if (shuffle && queue.length > 1) {
      let nextIndex = index;
      while (nextIndex === index) nextIndex = Math.floor(Math.random() * queue.length);
      playTrack(queue[nextIndex]);
      return;
    }
    const nextIndex = index < 0 ? 0 : index + 1;
    if (nextIndex >= queue.length) {
      if (repeatMode === "all") playTrack(queue[0]);
      else {
        audioRef.current?.pause();
        setIsPlaying(false);
      }
      return;
    }
    playTrack(queue[nextIndex]);
  }, [tracks, activeQueueTracks, currentTrackId, shuffle, repeatMode, playTrack]);

  const playPrevious = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const queue = activeQueueTracks.length ? activeQueueTracks : tracks;
    const index = queue.findIndex((track) => track.id === currentTrackId);
    const previousIndex = index <= 0 ? (repeatMode === "all" ? queue.length - 1 : 0) : index - 1;
    if (queue[previousIndex]) playTrack(queue[previousIndex]);
  }, [tracks, activeQueueTracks, currentTrackId, repeatMode, playTrack]);

  const playPreviousTrack = useCallback(() => {
    const queue = activeQueueTracks.length ? activeQueueTracks : tracks;
    if (!queue.length) return;
    const index = queue.findIndex((track) => track.id === currentTrackId);
    const previousIndex = index <= 0 ? (repeatMode === "all" ? queue.length - 1 : 0) : index - 1;
    if (queue[previousIndex]) playTrack(queue[previousIndex]);
  }, [tracks, activeQueueTracks, currentTrackId, repeatMode, playTrack]);

  const resumeRemotePlayback = useCallback(() => {
    const saved = remotePlaybackState;
    const track = saved?.currentTrackId ? tracks.find((item) => item.id === saved.currentTrackId) : null;
    if (!saved || !track) return;
    const queue = Array.isArray(saved.queue) ? saved.queue.filter((id) => tracks.some((item) => item.id === id)).slice(0, 500) : [];
    setPlaybackQueueIds(queue.includes(track.id) ? queue : [...queue.slice(0, 499), track.id]);
    setRepeatMode(["off", "one", "all"].includes(saved.repeatMode) ? saved.repeatMode : "off");
    setShuffle(Boolean(saved.shuffle));
    playbackSyncPausedForRemoteRef.current = false;
    playbackSyncLastPayloadRef.current = "";
    pendingResumeRef.current = { trackId: track.id, positionSeconds: Math.max(0, Number(saved.positionSeconds) || 0) };
    setRemotePlaybackState(null);
    playTrack(track);
    const audio = audioRef.current;
    if (audio && audio.readyState >= 1) {
      const position = Number(pendingResumeRef.current?.positionSeconds || 0);
      audio.currentTime = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.min(position, Math.max(0, audio.duration - 0.25)) : position;
      setCurrentTime(audio.currentTime);
      pendingResumeRef.current = null;
    }
  }, [remotePlaybackState, tracks, playTrack]);

  const dismissRemotePlayback = useCallback(() => {
    const dismissalKey = remotePlaybackDismissalKey(remotePlaybackState);
    if (dismissalKey) {
      const keys = [...new Set([...dismissedPlaybackKeysRef.current, dismissalKey])].slice(-100);
      dismissedPlaybackKeysRef.current = new Set(keys);
      const storageKey = REMOTE_PLAYBACK_DISMISSED_KEY + ":" + (profile.id || "legacy");
      try { localStorage.setItem(storageKey, JSON.stringify(keys)); } catch {}
      fetch("/api/preferences/dismissed-playback", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: { keys } }),
      }).catch(() => {});
      // Stay paused for the dismissed remote track; otherwise each SSE update reopens the prompt.
      playbackSyncPausedForRemoteRef.current = true;
    } else {
      playbackSyncPausedForRemoteRef.current = false;
    }
    setRemotePlaybackState(null);
  }, [remotePlaybackState, profile.id]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (!currentTrack && tracks.length) {
        playTrack(tracks[0]);
      } else if (currentTrack) {
        audio.play().catch(() => setIsPlaying(false));
      }
    } else {
      audio.pause();
    }
  }, [currentTrack, tracks, playTrack]);

  const handleYoutubeSearch = useCallback(async () => {
    const search = youtubeQuery.trim();
    if (search.length < 2) {
      setYoutubeError("Enter at least two characters to search YouTube.");
      setYoutubeResults([]);
      return;
    }

    setYoutubeLoading(true);
    setYoutubeError("");
    setSelectedYoutube(null);
    try {
      const response = await fetch("/api/youtube/search", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: search, limit: 20, musicOnly: true }),
      });
      if (!response.ok) throw new Error(await readMessage(response));
      const body = await response.json();
      setYoutubeResults(Array.isArray(body.items) ? body.items : []);
      if (!body.items?.length) setYoutubeError("No results. Try another search.");
    } catch (error) {
      setYoutubeResults([]);
      setYoutubeError(error.message || "YouTube search could not be completed.");
    } finally {
      setYoutubeLoading(false);
    }
  }, [youtubeQuery]);

  const selectYoutubeVideo = useCallback((item) => {
    setSelectedYoutube(item);
  }, []);

  useEffect(() => {
    if (!currentTrack || !("mediaSession" in navigator)) return;
    try {
      if ("MediaMetadata" in window) {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: currentTrack.title,
          artist: currentTrack.artist,
          album: currentTrack.album,
          artwork: [
            { src: currentTrack.artworkUrl, sizes: "192x192", type: "image/jpeg" },
            { src: currentTrack.artworkUrl, sizes: "256x256", type: "image/jpeg" },
            { src: currentTrack.artworkUrl, sizes: "384x384", type: "image/jpeg" },
            { src: currentTrack.artworkUrl, sizes: "512x512", type: "image/jpeg" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          ],
        });
      }
      navigator.mediaSession.setActionHandler("play", () => audioRef.current?.play().catch(() => {}));
      navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
      navigator.mediaSession.setActionHandler("previoustrack", playPrevious);
      navigator.mediaSession.setActionHandler("nexttrack", playNext);
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (audioRef.current && Number.isFinite(details.seekTime)) audioRef.current.currentTime = details.seekTime;
      });
      navigator.mediaSession.setActionHandler("seekbackward", (details) => {
        const audio = audioRef.current;
        if (audio) audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10));
      });
      navigator.mediaSession.setActionHandler("seekforward", (details) => {
        const audio = audioRef.current;
        if (audio) audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (details.seekOffset || 10));
      });
    } catch {
      // Not all browsers implement every Media Session action.
    }
  }, [currentTrack, playPrevious, playNext]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch {
      // Ignore browsers with partial Media Session support.
    }
  }, [isPlaying]);

  // Progress bar on the lock screen (Android). Updates as the track plays.
  useEffect(() => {
    if (!("mediaSession" in navigator) || typeof navigator.mediaSession.setPositionState !== "function") return;
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime, audio.duration),
      });
    } catch {
      // Some browsers may throw if values are out of range — ignore.
    }
  }, [currentTime, duration]);

  const filteredTracks = useMemo(() => {
    let list = tracks;
    if (view === "favorites") list = list.filter((track) => favorites.includes(track.id));
    if (view === "offline") list = offlineTracks;
    if (view === "library") {
      if (libraryFilters.artist) list = list.filter((track) => track.artist === libraryFilters.artist);
      if (libraryFilters.album) list = list.filter((track) => track.album === libraryFilters.album);
      if (libraryFilters.year) list = list.filter((track) => String(track.year || "") === libraryFilters.year);
      if (libraryFilters.genre) list = list.filter((track) => track.genre === libraryFilters.genre);
      if (libraryFilters.offlineOnly) list = list.filter((track) => offlineTrackIds.includes(track.id));
      if (libraryFilters.duration === "short") list = list.filter((track) => Number(track.duration || 0) > 0 && Number(track.duration) < 180);
      if (libraryFilters.duration === "medium") list = list.filter((track) => Number(track.duration || 0) >= 180 && Number(track.duration) <= 300);
      if (libraryFilters.duration === "long") list = list.filter((track) => Number(track.duration || 0) > 300);
    }
    const normalized = query.trim().toLowerCase();
    if (normalized) {
      list = list.filter((track) =>
        (track.title + " " + track.artist + " " + track.album + " " + (track.albumArtist || "") + " " + (track.genre || "") + " " + (track.year || "")).toLowerCase().includes(normalized),
      );
    }
    list = [...list];
    const compare = (a, b, key) => String(a[key] || "").localeCompare(String(b[key] || ""), undefined, { numeric: true, sensitivity: "base" });
    if (libraryFilters.sort === "title") list.sort((a, b) => compare(a, b, "title"));
    else if (libraryFilters.sort === "album") list.sort((a, b) => compare(a, b, "album") || compare(a, b, "trackNumber") || compare(a, b, "title"));
    else if (libraryFilters.sort === "year") list.sort((a, b) => Number(b.year || 0) - Number(a.year || 0) || compare(a, b, "title"));
    else if (libraryFilters.sort === "duration") list.sort((a, b) => Number(a.duration || 0) - Number(b.duration || 0));
    else if (libraryFilters.sort === "recent") list.sort((a, b) => String(b.addedAt || "").localeCompare(String(a.addedAt || "")));
    else list.sort((a, b) => compare(a, b, "artist") || compare(a, b, "album") || compare(a, b, "trackNumber") || compare(a, b, "title"));
    return list;
  }, [tracks, view, favorites, query, libraryFilters, offlineTracks, offlineTrackIds]);

  const toggleOfflineTrack = useCallback(async (track) => {
    if (!track?.id || offlineBusyIds.includes(track.id)) return;
    const trackId = track.id;
    let cache;
    let request;
    let createdCacheEntry = false;
    setOfflineBusyIds((current) => current.includes(trackId) ? current : [...current, trackId]);
    try {
      if (!("caches" in window)) throw new Error("This browser does not support offline audio storage.");
      cache = await window.caches.open(OFFLINE_AUDIO_CACHE);
      request = offlineCacheRequest(trackId);
      const existing = await cache.match(request);
      const stored = readLocalJson(OFFLINE_TRACKS_KEY, []);
      if (existing) {
        await cache.delete(request);
        const next = (Array.isArray(stored) ? stored : []).filter((item) => item?.id !== trackId);
        localStorage.setItem(OFFLINE_TRACKS_KEY, JSON.stringify(next));
        setOfflineTracks(next);
        setOfflineTrackIds((current) => current.filter((id) => id !== trackId));
        setOfflineMessage("Removed the offline copy of “" + track.title + "”.");
        return;
      }

      if (offlineMode || !navigator.onLine) {
        throw new Error("Connect to your SelfMusic server to save this track first.");
      }
      const response = await fetch(track.streamUrl || ("/api/stream/" + encodeURIComponent(trackId)), {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) {
        setAuthenticated(false);
        throw new Error("Sign in again before saving music for offline playback.");
      }
      if (!response.ok || response.status === 206) {
        throw new Error("The server could not provide a complete audio file for offline storage.");
      }

      const bytes = Number(response.headers.get("content-length") || 0);
      if (bytes > 0 && navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        const available = Number(estimate.quota || 0) - Number(estimate.usage || 0);
        const reserve = 8 * 1024 * 1024;
        if (available > 0 && bytes + reserve > available) {
          throw new Error("There may not be enough device storage for this track. Free space and try again.");
        }
      }

      await cache.put(request, response);
      createdCacheEntry = true;
      const offlineTrack = {
        id: trackId,
        title: String(track.title || "Untitled track"),
        artist: String(track.artist || "Unknown artist"),
        album: String(track.album || "Unknown album"),
        albumArtist: track.albumArtist || track.artist || "",
        year: track.year || null,
        genre: track.genre || null,
        duration: Number(track.duration) || 0,
        bitrate: track.bitrate || null,
        sampleRate: track.sampleRate || null,
        codec: track.codec || null,
        bytes: bytes || track.bytes || 0,
        sha256: track.sha256 || null,
        streamUrl: track.streamUrl || ("/api/stream/" + encodeURIComponent(trackId)),
        artworkUrl: track.artworkUrl || ("/api/artwork/" + encodeURIComponent(trackId)),
        addedAt: track.addedAt || null,
      };
      const next = [offlineTrack, ...(Array.isArray(stored) ? stored : []).filter((item) => item?.id !== trackId)];
      try {
        localStorage.setItem(OFFLINE_TRACKS_KEY, JSON.stringify(next));
      } catch {
        throw new Error("The track was downloaded, but its offline metadata could not be saved. Free browser storage and try again.");
      }
      setOfflineTracks(next);
      setOfflineTrackIds((current) => current.includes(trackId) ? current : [...current, trackId]);
      setOfflineMessage("Saved “" + offlineTrack.title + "” on this device for offline playback.");
    } catch (error) {
      if (createdCacheEntry && cache && request) await cache.delete(request).catch(() => {});
      const quotaError = error?.name === "QuotaExceededError";
      setOfflineMessage(quotaError ? "Device storage is full. Remove unused offline tracks and try again." : (error.message || "Could not save this track offline."));
    } finally {
      setOfflineBusyIds((current) => current.filter((id) => id !== trackId));
    }
  }, [offlineBusyIds, offlineMode]);

  const toggleFavorite = useCallback(async (id) => {
    if (offlineMode) {
      setOfflineMessage("Favorites sync to the server. You can keep listening offline and sync favorites when it is reachable again.");
      return;
    }
    const wasFavorite = favorites.includes(id);
    try {
      const response = await fetch("/api/favorites/" + encodeURIComponent(id), {
        method: wasFavorite ? "DELETE" : "POST",
        credentials: "same-origin",
      });
      if (response.status === 401) { setAuthenticated(false); return; }
      if (!response.ok) throw new Error(await readMessage(response));
      setFavorites((items) => wasFavorite ? items.filter((item) => item !== id) : (items.includes(id) ? items : [...items, id]));
    } catch (error) {
      setPlaylistMessage(error.message || "Could not update favorites.");
      setPlaylistError(true);
    }
  }, [favorites, offlineMode]);

  const handleSelectUploadFiles = useCallback((fileList) => {
    const nextFiles = Array.from(fileList || []);
    setSelectedUploadFiles(nextFiles.slice(0, 20));
    setUploadError(false);
    setUploadMessage("");

    if (nextFiles.length > 20) {
      setUploadError(true);
      setUploadMessage("Choose no more than 20 files per upload.");
      return;
    }
    const unsupported = nextFiles.find((file) => {
      const extension = file.name.split(".").pop()?.toLowerCase() || "";
      return !SUPPORTED_UPLOAD_EXTENSIONS.has(extension);
    });
    if (unsupported) {
      setUploadError(true);
      setUploadMessage(unsupported.name + " is not a supported audio format.");
      return;
    }
    const tooLarge = nextFiles.find((file) => file.size > MAX_UPLOAD_BYTES);
    if (tooLarge) {
      setUploadError(true);
      setUploadMessage(tooLarge.name + " is larger than the 250 MB per-file limit.");
    }
  }, []);

  const uploadSelectedFiles = useCallback(async () => {
    if (!selectedUploadFiles.length || uploading) return;
    const invalidFile = selectedUploadFiles.find((file) => {
      const extension = file.name.split(".").pop()?.toLowerCase() || "";
      return !SUPPORTED_UPLOAD_EXTENSIONS.has(extension) || file.size > MAX_UPLOAD_BYTES;
    });
    if (invalidFile) {
      setUploadError(true);
      setUploadMessage("Remove unsupported or oversized files before uploading.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadError(false);
    setUploadMessage("");
    const formData = new FormData();
    selectedUploadFiles.forEach((file) => formData.append("files", file, file.name));

    try {
      const result = await new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", "/api/upload");
        request.responseType = "json";
        request.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
          }
        });
        request.addEventListener("load", () => resolve({
          status: request.status,
          body: request.response || null,
        }));
        request.addEventListener("error", () => reject(new Error("The server could not be reached during upload.")));
        request.addEventListener("abort", () => reject(new Error("The upload was cancelled.")));
        request.send(formData);
      });

      if (result.status < 200 || result.status >= 300) {
        if (result.status === 401) setAuthenticated(false);
        throw new Error(result.body?.message || "The server could not save these files.");
      }

      const uploaded = Number(result.body?.uploaded || selectedUploadFiles.length);
      setUploadMessage("Imported " + uploaded + " " + (uploaded === 1 ? "track" : "tracks") + " into music/Uploads.");
      setUploadError(false);
      setUploadProgress(100);
      setSelectedUploadFiles([]);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      await loadTracks();
    } catch (error) {
      setUploadError(true);
      setUploadMessage(error.message || "Upload failed. Check the server and try again.");
    } finally {
      setUploading(false);
    }
  }, [selectedUploadFiles, uploading, loadTracks]);

  const startYoutubeDownload = useCallback(async (input, source = "import") => {
    if (youtubeJobRef.current) {
      const status = youtubeJobRef.current.status;
      if (status === "queued" || status === "running") {
        const message = "A YouTube download is already in progress. Wait for it to finish first.";
        if (source === "import") { setUrlImportError(true); setUrlImportMessage(message); }
        else setYoutubeError(message);
        return;
      }
    }
    setYoutubeJobStarting(true);
    setYoutubeJobSource(source);
    setUrlImportError(false);
    if (source === "import") setUrlImportMessage("Adding the download to the queue…");
    else setYoutubeError("");
    try {
      const response = await fetch("/api/youtube/download", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, async: true, bitrate: streamBitrate }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) setAuthenticated(false);
        throw new Error(payload.message || "Could not queue this YouTube download.");
      }
      const job = payload.job || payload;
      youtubeJobRef.current = job;
      setYoutubeJob(job);
      if (source === "import") setUrlImportMessage("Queued “" + (job.title || "YouTube audio") + "”. Progress will appear here.");
      else setYoutubeError("");
    } catch (error) {
      const message = error.message || "YouTube download failed. Check the URL and try again.";
      if (source === "import") {
        setUrlImportError(true);
        setUrlImportMessage(message);
      } else {
        setYoutubeError(message);
      }
    } finally {
      setYoutubeJobStarting(false);
    }
  }, [streamBitrate]);

  const downloadFromYoutube = useCallback(async () => {
    const url = audioUrl.trim();
    if (!url || importingUrl || youtubeJobStarting) return;
    if (!parseYoutubeVideoId(url)) {
      setUrlImportError(true);
      setUrlImportMessage("That is not a valid YouTube video link.");
      return;
    }
    setImportingUrl(true);
    setUrlImportMessage("");
    setUrlImportError(false);
    try {
      await startYoutubeDownload({ url }, "import");
    } finally {
      setImportingUrl(false);
    }
  }, [audioUrl, importingUrl, youtubeJobStarting, startYoutubeDownload]);

  useEffect(() => {
    const jobId = youtubeJob?.id;
    if (!authenticated || !jobId || !["queued", "running"].includes(youtubeJob.status)) return undefined;
    const stream = new EventSource("/api/youtube/status/" + encodeURIComponent(jobId), { withCredentials: true });
    stream.addEventListener("status", (event) => {
      let status;
      try { status = JSON.parse(event.data); } catch { return; }
      youtubeJobRef.current = status;
      setYoutubeJob(status);
      if (status.status === "completed") {
        stream.close();
        const result = status.result || {};
        const message = "Saved " + (result.name || status.title || "YouTube audio") + " to music/Uploads (" + formatBytes(result.bytes || 0) + ").";
        if (youtubeJobSource === "import") {
          setUrlImportMessage(message);
          setUrlImportError(false);
          setAudioUrl("");
        } else {
          setYoutubeError("");
        }
        loadTracks().catch(() => {});
      } else if (status.status === "failed" || status.status === "cancelled") {
        stream.close();
        const message = status.error?.message || "YouTube download failed.";
        if (youtubeJobSource === "import") {
          setUrlImportMessage(message);
          setUrlImportError(true);
        } else {
          setYoutubeError(message);
        }
      }
    });
    stream.onerror = () => {
      // EventSource reconnects automatically while the job is active.
    };
    return () => stream.close();
  }, [authenticated, youtubeJob?.id, youtubeJob?.status, youtubeJobSource, loadTracks]);


  const copyText = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, []);

  const resolvedTheme = appearance.theme === "system" ? systemTheme : appearance.theme;
  const presetBackground = BACKGROUND_PRESETS.find((preset) => preset.id === appearance.backgroundPreset)?.image || BACKGROUND_PRESETS[0].image;
  const backgroundImage = appearance.wallpaperDataUrl
    ? "linear-gradient(rgba(7, 8, 12, " + (appearance.wallpaperDim / 100) + "), rgba(7, 8, 12, " + (appearance.wallpaperDim / 100) + ")), url('" + appearance.wallpaperDataUrl + "')"
    : presetBackground;
  const motionDuration = appearance.animationSpeed === "slow" ? "360ms" : appearance.animationSpeed === "fast" ? "140ms" : "220ms";

  if (!authenticated) {
    return (
      <LoginScreen
        configured={configured}
        checking={checking}
        onLogin={handleLogin}
        error={loginError}
        serverUnavailable={serverUnavailable}
        appearance={{ ...appearance, theme: resolvedTheme }}
      />
    );
  }

  const pageTitle = view === "home" ? "Listen now" : view === "library" ? "Your library" : view === "favorites" ? "Liked tracks" : view === "offline" ? "Offline downloads" : view === "playlists" ? "Playlists" : view === "youtube" ? "Explore YouTube" : view === "import" || view === "import-url" ? "Import" : view === "server" ? "Server" : view === "settings" ? "Settings" : "SelfMusic";

  return (
    <div className="app-shell" data-view={view} data-settings-section={settingsSection} data-nav-position={appearance.navPosition} data-theme={resolvedTheme} data-accent={appearance.accent} data-glass={appearance.glass} data-animations={appearance.animations ? "on" : "off"} data-density={appearance.density} style={{ "--user-accent": appearance.accentColor, "--user-accent-strong": darkenAccent(appearance.accentColor), "--user-glass-opacity": appearance.glassOpacity + "%", "--user-glass-blur": appearance.glassBlur + "px", "--user-radius": appearance.cornerRadius + "px", "--user-background-image": backgroundImage, "--user-background-direct": appearance.wallpaperBlur === 0 ? backgroundImage : "none", "--user-wallpaper-backdrop-opacity": appearance.wallpaperBlur === 0 ? "0" : "1", "--user-wallpaper-blur": appearance.wallpaperBlur + "px", "--user-motion-duration": motionDuration }}>
      <aside className={"sidebar" + (mobileMenuOpen ? " sidebar-open" : "")}>
        <div className="brand">
          <span className="brand-mark"><AudioLines size={22} strokeWidth={2.2} /></span>
          <span>self<span className="brand-light">music</span></span>
          <button className="icon-button mobile-close" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-label">YOUR SPACE</p>
          <Navigation
            variant="desktop"
            view={view}
            onNavigate={(nextView) => { setView(nextView); setMobileMenuOpen(false); }}
            role={profile.role}
            offlineMode={offlineMode}
            trackCount={tracks.length}
          />
        </div>

        <div className="sidebar-library">
          <div className="library-heading"><span>Your collection</span><span className="live-dot" /></div>
          <button className="collection-card" onClick={() => { setView("playlists"); setMobileMenuOpen(false); }}>
            <div className="collection-art"><SectionGlyph kind="library" size={29} /></div>
            <span><strong>Playlists</strong><small>{playlists.length} {playlists.length === 1 ? "playlist" : "playlists"}</small></span>
          </button>
          <div className="sidebar-collection-links">
            <button className={view === "favorites" ? "sidebar-collection-link nav-active" : "sidebar-collection-link"} onClick={() => setView("favorites")}><Heart size={15} /><span>Liked tracks</span><span>{favorites.length}</span></button>
            <button className={view === "playlists" ? "sidebar-collection-link nav-active" : "sidebar-collection-link"} onClick={() => setView("playlists")}><ListMusic size={15} /><span>Playlists</span><span>{playlists.length}</span></button>
          </div>
          {!tracks.length && <p className="sidebar-hint">Add audio files to your server's music folder to begin.</p>}
        </div>

        <div className="sidebar-bottom">
          <div className="connection-status"><span className="status-pip" /><span>{serverUnavailable || offlineMode ? "Home server unreachable" : playbackSyncStatus === "connected" ? "Home server connected" : "Sync reconnecting"}</span></div>
          <button className={view === "server" ? "nav-item nav-active" : "nav-item"} onClick={() => { setView("server"); setMobileMenuOpen(false); }}>
            <SectionGlyph kind="server" size={19} /><span>Server</span>
          </button>
          <button className={view === "settings" ? "nav-item nav-active" : "nav-item"} onClick={() => { setView("settings"); setMobileMenuOpen(false); }}>
            <Palette size={19} /><span>Settings</span>
          </button>
          <button className="nav-item logout-item" onClick={handleLogout}><LogOut size={18} /><span>Sign out</span></button>
          <div className="sidebar-version">SELFMUSIC <span>v0.1.0</span></div>
        </div>
      </aside>

      {mobileMenuOpen && <button className="sidebar-scrim" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation" />}

      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <div className="breadcrumb"><span>SelfMusic</span><span className="crumb-slash">/</span><strong>{pageTitle}</strong></div>
          <div className="topbar-right">
            <label className="search-box">
              <Search size={17} />
              <input ref={searchInputRef} list="music-search-suggestions" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your music" aria-label="Search music" />
              {query && <button className="search-clear" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}
              <kbd>⌘ K</kbd>
            </label>
            <datalist id="music-search-suggestions">
              {Array.from(new Set(tracks.slice(0, 500).flatMap((track) => [track.title, track.artist, track.album, track.genre, track.year && String(track.year)]).filter(Boolean))).slice(0, 250).map((value) => <option key={value} value={value} />)}
            </datalist>
            <div className="avatar-pill"><span className="avatar-glyph">{String(profile.username || "S").slice(0, 1).toUpperCase()}</span><span>{profile.username || "My server"}</span></div>
          </div>
        </header>

        <div className="content-wrap" ref={contentWrapRef}>
          {["import", "import-url", "offline", "youtube"].includes(view) && <AddTabs view={view} onNavigate={setView} isAdmin={profile.role === "admin" && !offlineMode} />}
          {offlineMode && (
            <div className="offline-mode-banner" role="status">
              <Download size={16} /><span><strong>Offline mode</strong> — the home server cannot be reached. Playing local copies still works.</span>
              <button className="ghost-button offline-retry-button" type="button" onClick={() => window.location.reload()}><RefreshCw size={14} /> Retry server</button>
            </div>
          )}
          {offlineMessage && (
            <div className="offline-mode-banner offline-mode-feedback" role="status">
              <span>{offlineMessage}</span><button className="icon-button" type="button" aria-label="Dismiss offline message" onClick={() => setOfflineMessage("")}><X size={14} /></button>
            </div>
          )}
          {view === "home" && (
            <>
              <section className="hero-panel">
                <div className="hero-noise" />
                <div className="hero-content">
                  <div className="hero-kicker"><span className="hero-kicker-dot" /> PRIVATE BY DESIGN <span className="kicker-line" /></div>
                  <h1>Your sound.<br /><span>Everywhere.</span></h1>
                  <p>Your music collection, streamed from your own home server. No algorithm deciding what you hear.</p>
                  <div className="hero-actions">
                    <button className="primary-button" onClick={() => tracks.length ? playTrack(currentTrack || tracks[0]) : setView("library")}><Play size={17} fill="currentColor" /> {tracks.length ? "Start listening" : "Explore library"}</button>
                    <button className="ghost-button" onClick={() => setView("server")}><Server size={16} /> Server details</button>
                  </div>
                </div>
                <div className="hero-visual" aria-hidden="true">
                  <div className="visual-orbit orbit-a" /><div className="visual-orbit orbit-b" />
                  <div className="visual-disc"><div className="disc-grooves" /><div className="disc-label"><AudioLines size={28} /></div></div>
                  <div className="visual-stem stem-a" /><div className="visual-stem stem-b" /><div className="visual-stem stem-c" />
                  <div className="visual-chip"><span className="equalizer"><i /><i /><i /><i /></span><span>YOUR LIBRARY</span></div>
                </div>
                <div className="hero-footer"><span><LockKeyhole size={13} /> YOUR FILES STAY HOME</span><span><Globe2 size={13} /> STREAM FROM ANYWHERE*</span><small>*When remote access is configured</small></div>
              </section>

              <section className="section-block quick-stats">
                <div className="stat-card stat-card-library"><span className="stat-icon"><SectionGlyph kind="library" size={29} /></span><div><strong>{tracks.length.toLocaleString()}</strong><span>Tracks in library</span></div></div>
                <div className="stat-card stat-card-liked"><span className="stat-icon stat-icon-warm"><SectionGlyph kind="liked" size={29} /></span><div><strong>{favorites.length.toLocaleString()}</strong><span>Liked tracks</span></div></div>
                <div className="stat-card stat-card-server"><span className="stat-icon stat-icon-cool"><SectionGlyph kind="server" size={29} /></span><div><strong>Personal</strong><span>Your server, your rules</span></div></div>
              </section>

              <section className="section-block track-section">
                <div className="section-heading">
                  <div><p className="eyebrow">PICK UP THE VIBE</p><h2>{query ? "Search results" : "Your music"}</h2></div>
                  <div className="section-heading-actions"><span className="muted-count">{filteredTracks.length} tracks</span><button className="text-button" onClick={() => setView("library")}>View library <span>↗</span></button></div>
                </div>
                <TrackList
                  tracks={filteredTracks.slice(0, 8)}
                  loading={loadingTracks}
                  error={loadError}
                  currentTrackId={currentTrackId}
                  isPlaying={isPlaying}
                  favorites={favorites}
                  onPlay={playTrack}
                  onFavorite={toggleFavorite}

                  onDelete={handleDeleteTrack}

                  deletingTrackId={deletingTrackId}

                  trackActionMessage={trackActionMessage}

                  trackActionError={trackActionError}
                  onRefresh={loadTracks}
                  emptyTitle={query ? "No matches found" : view === "offline" ? "No offline tracks yet" : view === "favorites" ? "Nothing liked yet" : "Your first track is waiting"}
                  emptyCopy={query ? "Try another title, artist, or album name." : view === "offline" ? "Save tracks from your library while connected to keep them available on this device." : view === "favorites" ? "Tap the heart on a track to keep it in your liked collection." : "Put your own music files in the server's music folder, then refresh the library."}
                  onServerSetup={view === "offline" ? undefined : () => setView("server")}
                  canManage={profile.role === "admin" && !offlineMode}
                  currentTime={currentTime}
                  duration={duration}
                  offlineTrackIds={offlineTrackIds}
                  offlineBusyIds={offlineBusyIds}
                  onOffline={toggleOfflineTrack}
                />
              </section>
            </>
          )}

          {(view === "library" || view === "favorites" || view === "offline") && (
            <section className="page-section">
              <div className="page-intro">
                <div className="intro-icon">{view === "offline" ? <Download size={29} /> : <SectionGlyph kind={view === "favorites" ? "liked" : "library"} size={29} />}</div>
                <p className="eyebrow">{view === "favorites" ? "THE ONES YOU KEEP" : view === "offline" ? "SAVED TO THIS DEVICE" : "ALL YOUR AUDIO IN ONE PLACE"}</p>
                <h1>{view === "favorites" ? "Liked tracks" : view === "offline" ? "Offline downloads" : "Your library"}</h1>
                <p>{view === "favorites" ? "Your personal shortlist, saved on this device." : view === "offline" ? "These complete audio files are stored on this device and can play without connecting to your home server." : offlineMode ? "Your server is unreachable. Only tracks explicitly saved for offline playback are shown." : "Music stored on your home server, ready when you are."}</p>
                <div className="intro-meta"><span><Disc3 size={14} /> {filteredTracks.length} tracks</span><span className="meta-separator" /><span><ShieldCheck size={14} /> Private library</span></div>
              </div>
              <div className="library-toolbar">
                <button className="primary-button" onClick={() => filteredTracks.length && playTrack(filteredTracks[0])} disabled={!filteredTracks.length}><Play size={16} fill="currentColor" /> Play all</button>
                <button className="ghost-button" onClick={view === "offline" ? refreshOfflineLibrary : loadTracks}><RefreshCw size={15} className={loadingTracks ? "spin" : ""} /> Refresh</button>
                {view === "library" && <FilterButton filters={libraryFilters} open={libraryFiltersOpen} onToggle={() => setLibraryFiltersOpen((open) => !open)} />}
                {view === "library" && profile.role === "admin" && !offlineMode && <button className="ghost-button" type="button" disabled={scanningLibrary} onClick={scanLibraryNow}><RefreshCw size={15} className={scanningLibrary ? "spin" : ""} /> {scanningLibrary ? "Scanning library…" : "Rescan library"}</button>}
              </div>
              {view === "library" && !offlineMode && libraryScanMessage && <div className="upload-feedback" role="status"><span className="upload-feedback-icon"><Check size={17} /></span><span>{libraryScanMessage}</span></div>}
              {view === "library" && (
                <FilterPanel
                  tracks={tracks}
                  filters={libraryFilters}
                  setFilters={setLibraryFilters}
                  open={libraryFiltersOpen}
                  onClose={() => setLibraryFiltersOpen(false)}
                  query={query}
                  setQuery={setQuery}
                />
              )}
              <TrackList
                tracks={filteredTracks}
                loading={loadingTracks}
                error={loadError}
                currentTrackId={currentTrackId}
                isPlaying={isPlaying}
                favorites={favorites}
                onPlay={playTrack}
                onFavorite={toggleFavorite}

                onDelete={handleDeleteTrack}

                deletingTrackId={deletingTrackId}

                trackActionMessage={trackActionMessage}

                trackActionError={trackActionError}
                onRefresh={loadTracks}
                emptyTitle={view === "favorites" ? "Nothing liked yet" : query ? "No matches found" : "Your library is empty"}
                emptyCopy={view === "favorites" ? "Tap the heart beside any track to keep it here." : "Add audio files to your server's music folder, then refresh."}
                onSettings={() => setView("settings")}
                canManage={profile.role === "admin" && !offlineMode}
                currentTime={currentTime}
                duration={duration}
                offlineTrackIds={offlineTrackIds}
                offlineBusyIds={offlineBusyIds}
                onOffline={toggleOfflineTrack}
              />
            </section>
          )}

          {view === "playlists" && (
            <section className="page-section playlist-page">
              <div className="page-intro">
                <div className="intro-icon"><ListMusic size={29} /></div>
                <p className="eyebrow">YOUR MUSIC, YOUR ORDER</p>
                <h1>Playlists</h1>
                <p>Create persistent collections, reorder tracks, and export or import M3U files.</p>
              </div>

              <div className="settings-grid">
                <div className="settings-card">
                  <div className="settings-card-head"><span className="settings-icon"><Plus size={19} /></span><span className="settings-overline">NEW COLLECTION</span></div>
                  <h3>Create a playlist</h3>
                  <form className="url-import-block" onSubmit={async (event) => {
                    event.preventDefault();
                    try { await createPlaylist(playlistName); }
                    catch (error) { setPlaylistMessage(error.message || "Could not create playlist."); setPlaylistError(true); }
                  }}>
                    <label htmlFor="playlist-name">Playlist name</label>
                    <div className="url-import-row">
                      <input id="playlist-name" type="text" value={playlistName} maxLength={100} placeholder="Late night listening" onChange={(event) => setPlaylistName(event.target.value)} required />
                      <button className="primary-button" type="submit" disabled={!playlistName.trim()}><Plus size={15} /> Create</button>
                    </div>
                  </form>
                  <div className="settings-footnote">Playlists and track order are saved to the SelfMusic database and follow your signed-in account.</div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-head"><span className="settings-icon settings-icon-blue"><FolderOpen size={19} /></span><span className="settings-overline">M3U EXCHANGE</span></div>
                  <h3>Import an M3U playlist</h3>
                  <p>Import an existing .m3u file. Entries are matched against files already indexed in your library; external paths are never opened.</p>
                  <label className="settings-action" htmlFor="m3u-import-file"><Upload size={15} /> Choose M3U file <input id="m3u-import-file" type="file" accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl" onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    try {
                      if (file.size > 1024 * 1024) throw new Error("M3U files must be 1 MB or smaller.");
                      const content = await file.text();
                      const name = playlistName.trim() || file.name.replace(/\.m3u8?$/i, "") || "Imported playlist";
                      const response = await fetch("/api/playlists/import.m3u", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, content }) });
                      if (!response.ok) throw new Error(await readMessage(response));
                      const body = await response.json();
                      await refreshPlaylists();
                      setPlaylistMessage("Imported " + body.importedTracks + " tracks.");
                      setPlaylistError(false);
                    } catch (error) {
                      setPlaylistMessage(error.message || "Could not import this playlist.");
                      setPlaylistError(true);
                    } finally {
                      event.target.value = "";
                    }
                  }} /></label>
                  <div className="settings-footnote">M3U exports include relative library paths and can be downloaded from each playlist below.</div>
                </div>
              </div>

              {playlistMessage && <div className={"upload-feedback" + (playlistError ? " upload-feedback-error" : "")} role={playlistError ? "alert" : "status"}><span className="upload-feedback-icon">{playlistError ? <CircleAlert size={17} /> : <Check size={17} />}</span><span>{playlistMessage}</span></div>}

              <div className="section-heading playlist-heading">
                <div><p className="eyebrow">AUTO-UPDATED</p><h2>Smart playlists</h2></div>
              </div>
              <div className="settings-grid smart-playlist-grid">
                {[
                  { kind: "recently-added", name: "Recently added", subtitle: "Latest tracks in your library" },
                  { kind: "frequently-played", name: "Frequently played", subtitle: "Your most-played tracks" },
                  { kind: "recently-played", name: "Recently played", subtitle: "Your latest listening history" },
                ].map((item) => (
                  <button className={"settings-card smart-playlist-card" + (selectedPlaylist?.smartType === item.kind ? " playlist-card-active" : "")} type="button" key={item.kind} onClick={() => openSmartPlaylist(item.kind)}>
                    <div className="settings-card-head"><span className="settings-icon"><AudioLines size={18} /></span><span className="settings-overline">SMART PLAYLIST</span></div>
                    <h3>{item.name}</h3><p>{item.subtitle}</p><span className="text-button"><Play size={14} /> Open smart playlist</span>
                  </button>
                ))}
              </div>

              <div className="section-heading playlist-heading">
                <div><p className="eyebrow">SAVED COLLECTIONS</p><h2>Your playlists</h2></div>
                <div className="section-heading-actions"><span className="muted-count">{playlists.length} playlists</span><button className="text-button" type="button" onClick={() => refreshPlaylists().catch((error) => { setPlaylistMessage(error.message); setPlaylistError(true); })}><RefreshCw size={14} /> Refresh</button></div>
              </div>
              {playlists.length ? (
                <div className="settings-grid playlist-grid">
                  {playlists.map((playlist) => (
                    <div className={"settings-card playlist-card" + (selectedPlaylist?.id === playlist.id ? " playlist-card-active" : "")} key={playlist.id}>
                      <div className="settings-card-head"><span className="settings-icon"><ListMusic size={18} /></span><span className="settings-overline">PLAYLIST</span></div>
                      <h3>{playlist.name}</h3>
                      <p>{playlist.trackCount || 0} tracks · Updated {new Date(playlist.updatedAt || playlist.createdAt).toLocaleDateString()}</p>
                      <div className="playlist-card-actions">
                        <button className="primary-button" type="button" onClick={() => openPlaylist(playlist)}><ListMusic size={15} /> Open</button>
                        <a className="ghost-button" href={"/api/playlists/" + encodeURIComponent(playlist.id) + "/export.m3u"} download><Download size={15} /> Export M3U</a>
                        <button className="icon-button" type="button" title="Delete playlist" aria-label={"Delete playlist " + playlist.name} onClick={() => deletePlaylist(playlist.id).catch((error) => { setPlaylistMessage(error.message); setPlaylistError(true); })}><Trash2 size={15} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="empty-state"><ListMusic size={24} /><h3>No playlists yet</h3><p>Create one above, then add tracks from your library.</p></div>}

              {selectedPlaylist && (
                <section className="section-block selected-playlist">
                  <div className="section-heading">
                    <div><p className="eyebrow">NOW EDITING</p><h2>{selectedPlaylist.name}</h2><p className="muted-count">{selectedPlaylistTracks.length} tracks</p></div>
                    <div className="section-heading-actions"><button className="ghost-button" type="button" onClick={() => setSelectedPlaylist(null)}>Close</button></div>
                  </div>
                  <div className="settings-card playlist-track-panel">
                    <h3>Tracks in this playlist</h3>
                    {selectedPlaylistTracks.length ? selectedPlaylistTracks.map((track, index) => (
                      <div className="playlist-track-row" key={track.id}>
                        <button className="track-art" type="button" onClick={() => playTrack(track)} aria-label={"Play " + track.title}><Cover track={track} /></button>
                        <button className="track-identity" type="button" onClick={() => playTrack(track)}><span className="track-title">{track.title}</span><span className="track-subtitle">{track.artist} · {track.album}</span></button>
                        <span className="playlist-track-position">{index + 1}</span>
                        {!selectedPlaylist.smartType && (<button className="icon-button" type="button" title="Move up" aria-label={"Move " + track.title + " up"} disabled={index === 0} onClick={async () => {
                          const ids = selectedPlaylistTracks.map((item) => item.id);
                          [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
                          try {
                            const response = await fetch("/api/playlists/" + encodeURIComponent(selectedPlaylist.id) + "/tracks/order", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackIds: ids }) });
                            if (!response.ok) throw new Error(await readMessage(response));
                            setSelectedPlaylistTracks(await response.json().then((body) => body.tracks || []));
                          } catch (error) { setPlaylistMessage(error.message); setPlaylistError(true); }
                        }}><ArrowUpRight size={15} /></button> )}

                        {!selectedPlaylist.smartType && (<button className="icon-button" type="button" title="Remove track" aria-label={"Remove " + track.title + " from playlist"} onClick={() => removeTrackFromPlaylist(selectedPlaylist.id, track.id).catch((error) => { setPlaylistMessage(error.message); setPlaylistError(true); })}><X size={15} /></button> )}

                      </div>
                    )) : <p className="settings-footnote">This playlist is empty. Add something from your library below.</p>}
                  </div>

                  {!selectedPlaylist.smartType && (
                  <div className="settings-card playlist-track-panel">
                    <h3>Add tracks from your library</h3>
                    <div className="playlist-add-library">
                      {tracks.filter((track) => !selectedPlaylistTracks.some((item) => item.id === track.id) && (!query.trim() || (track.title + " " + track.artist + " " + track.album).toLowerCase().includes(query.trim().toLowerCase()))).slice(0, 100).map((track) => (
                        <div className="playlist-track-row" key={track.id}>
                          <button className="track-art" type="button" onClick={() => playTrack(track)} aria-label={"Play " + track.title}><Cover track={track} /></button>
                          <button className="track-identity" type="button" onClick={() => playTrack(track)}><span className="track-title">{track.title}</span><span className="track-subtitle">{track.artist} · {track.album}</span></button>
                          <button className="icon-button" type="button" title="Add to playlist" aria-label={"Add " + track.title + " to playlist"} onClick={() => addTrackToPlaylist(selectedPlaylist.id, track.id).catch((error) => { setPlaylistMessage(error.message); setPlaylistError(true); })}><Plus size={16} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                  )}
                </section>
              )}
            </section>
          )}

          {view === "youtube" && (
            <section className="page-section youtube-page">
              <div className="youtube-hero glass-mist-panel">
                <div className="youtube-fog youtube-fog-one" />
                <div className="youtube-fog youtube-fog-two" />
                <div className="youtube-hero-content">
                  <div className="youtube-kicker"><Youtube size={15} /> SEARCH <span /> CONVERT TO LIBRARY</div>
                  <h1>Find your next<br /><span>favorite sound.</span></h1>
                  <p>Search tracks and convert audio into your private library. No embedded YouTube player — pick a result and Convert.</p>
                  <form className="youtube-search-form" onSubmit={(event) => { event.preventDefault(); handleYoutubeSearch(); }}>
                    <label className="youtube-search-field">
                      <Search size={18} />
                      <input
                        value={youtubeQuery}
                        onChange={(event) => setYoutubeQuery(event.target.value)}
                        placeholder="Search artists, tracks, live sessions…"
                        aria-label="Search YouTube tracks"
                        minLength={2}
                        maxLength={100}
                      />
                    </label>
                    <button className="primary-button" type="submit" disabled={youtubeLoading || youtubeQuery.trim().length < 2}>
                      {youtubeLoading ? <RefreshCw className="spin" size={16} /> : <Search size={16} />}
                      {youtubeLoading ? "Searching" : "Search"}
                    </button>
                  </form>
                  <form
                    className="youtube-url-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const videoId = parseYoutubeVideoId(youtubeUrl);
                      if (!videoId) {
                        setYoutubeUrlError("Enter a valid HTTPS link to a YouTube video.");
                        return;
                      }
                      const item = {
                        videoId,
                        title: "Video opened from link",
                        channelTitle: "YouTube",
                        thumbnail: "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg",
                      };
                      setYoutubeUrlError("");
                      setYoutubeResults((items) => [item, ...items.filter((result) => result.videoId !== videoId)]);
                      selectYoutubeVideo(item);
                    }}
                  >
                    <div className="youtube-url-caption"><span>ALREADY HAVE A LINK?</span><span>PASTE LINK TO CONVERT</span></div>
                    <div className="youtube-url-row">
                      <label className="youtube-url-field">
                        <Link2 size={16} />
                        <input
                          type="url"
                          inputMode="url"
                          autoComplete="url"
                          value={youtubeUrl}
                          onChange={(event) => { setYoutubeUrl(event.target.value); setYoutubeUrlError(""); }}
                          placeholder="https://youtu.be/…"
                          aria-label="YouTube video URL"
                          maxLength={2048}
                          required
                        />
                      </label>
                      <button className="ghost-button youtube-url-button" type="submit">
                        <Download size={14} /> Use link
                      </button>
                    </div>
                    {youtubeUrlError && <p className="youtube-url-error" role="alert">{youtubeUrlError}</p>}
                  </form>
                  <div className="youtube-privacy-line"><ShieldCheck size={14} /> The API key stays on your server. Search results are cached briefly.</div>
                </div>
                <div className="youtube-hero-orb" aria-hidden="true"><div className="youtube-orb-core"><Youtube size={37} /></div><div className="youtube-orb-ring ring-one" /><div className="youtube-orb-ring ring-two" /></div>
              </div>

              <div className="youtube-workspace">
                <div className="youtube-results-panel glass-mist-panel">
                  <div className="youtube-panel-heading">
                    <div><p className="eyebrow">DISCOVER SOMETHING NEW</p><h2>Search results</h2></div>
                    {youtubeResults.length > 0 && <span className="youtube-result-count">{youtubeResults.length} videos</span>}
                  </div>
                  {youtubeError && (
                    <div className="youtube-message">
                      <CircleAlert size={18} />
                      <div>
                        <strong>{youtubeError}</strong>
                        <span>{youtubeError.toLowerCase().includes("youtube_api_key")
                          ? "Search used a fallback. Check the server or try again."
                          : youtubeError.toLowerCase().includes("quota")
                            ? "The search quota for your YouTube API key has been reached. Try again tomorrow or review quota usage in Google Cloud."
                            : "Check the server connection and YouTube Data API v3 configuration in Settings → Integrations, then try again. Direct video links can still open in the official player."}</span>
                      </div>
                    </div>
                  )}
                  {youtubeLoading && <div className="youtube-empty"><RefreshCw className="spin" size={23} /><strong>Looking through YouTube</strong><span>Searching tracks…</span></div>}
                  {!youtubeLoading && !youtubeError && youtubeResults.length === 0 && (
                    <div className="youtube-empty"><div className="youtube-empty-icon"><Search size={22} /></div><strong>Your next discovery starts here</strong><span>Search for an artist, track, concert, or live set.</span></div>
                  )}
                  {youtubeResults.length > 0 && (
                    <div className="youtube-results-grid">
                      {youtubeResults.map((item) => (
                        <button key={item.videoId} className={"youtube-result" + (selectedYoutube?.videoId === item.videoId ? " youtube-result-active" : "")} onClick={() => selectYoutubeVideo(item)}>
                          <span className="youtube-thumb-wrap">
                            {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" /> : <span className="youtube-thumb-fallback"><Youtube size={24} /></span>}
                            <span className="youtube-thumb-play"><Play size={18} fill="currentColor" /></span>
                          </span>
                          <span className="youtube-result-title">{item.title}</span>
                          <span className="youtube-result-channel">{item.channelTitle}</span>
                          {item.duration != null && <span className="youtube-result-duration">{Math.floor(item.duration / 60)}:{String(Math.floor(item.duration % 60)).padStart(2, "0")}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="youtube-attribution"><Youtube size={14} /><span>Video results by YouTube</span><span className="attribution-dot" /><span>Playback provided by YouTube</span></div>
                </div>

                <aside className="youtube-player-panel glass-mist-panel">
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
                </aside>
              </div>
            </section>
          )}

          {view === "import" && profile.role === "admin" && (
            <section className="page-section import-page">
              <div className="page-intro">
                <div className="intro-icon"><SectionGlyph kind="import" size={29} /></div>
                <p className="eyebrow">YOUR MUSIC, ON YOUR SERVER</p>
                <h1>Import music</h1>
                <p>Choose audio files from this device and send them straight to your home library. They stay on your computer after upload.</p>
                <div className="intro-meta"><span><ShieldCheck size={14} /> Private upload</span><span className="meta-separator" /><span><Library size={14} /> {tracks.length} tracks in library</span></div>
              </div>

              <div className="import-layout">
                <div className="import-main-panel glass-mist-panel">
                  <div className="import-panel-heading">
                    <div><p className="eyebrow">ADD TO YOUR COLLECTION</p><h2>Upload audio files</h2></div>
                    <span className="import-folder-tag"><FolderOpen size={14} /> music/Uploads</span>
                  </div>

                  <div
                    className="import-dropzone"
                    onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("is-dragging"); }}
                    onDragLeave={(event) => { event.currentTarget.classList.remove("is-dragging"); }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.currentTarget.classList.remove("is-dragging");
                      handleSelectUploadFiles(event.dataTransfer.files);
                    }}
                  >
                    <input
                      ref={uploadInputRef}
                      className="import-file-input"
                      type="file"
                      accept=".mp3,.m4a,.aac,.flac,.wav,.ogg,.opus,.webm,audio/*"
                      multiple
                      onChange={(event) => {
                        handleSelectUploadFiles(event.target.files);
                        event.target.value = "";
                      }}
                      aria-label="Choose audio files to upload"
                    />
                    <div className="import-drop-icon"><Upload size={25} /></div>
                    <h3>Drop your tracks here</h3>
                    <p>or choose files from your device</p>
                    <button className="ghost-button" type="button" onClick={() => uploadInputRef.current?.click()} disabled={uploading}>
                      <FolderOpen size={15} /> Browse audio files
                    </button>
                    <div className="import-limits"><span>MP3</span><span>FLAC</span><span>M4A</span><span>AAC</span><span>WAV</span><span>OGG</span><span>OPUS</span><span>WEBM</span></div>
                    <span className="import-limit-caption">Up to 20 files per batch · 250 MB per file</span>
                  </div>

                  {selectedUploadFiles.length > 0 && (
                    <div className="upload-queue">
                      <div className="upload-queue-heading"><strong>Ready to import</strong><span>{selectedUploadFiles.length} {selectedUploadFiles.length === 1 ? "file" : "files"} · {formatBytes(selectedUploadFiles.reduce((total, file) => total + file.size, 0))}</span></div>
                      <div className="upload-queue-list">
                        {selectedUploadFiles.map((file, index) => (
                          <div className="upload-queue-row" key={file.name + "-" + file.size + "-" + index}>
                            <span className="upload-file-icon"><Music size={17} /></span>
                            <span className="upload-file-meta"><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>
                            <button className="icon-button" type="button" aria-label={"Remove " + file.name} disabled={uploading} onClick={() => { setSelectedUploadFiles((items) => items.filter((_, fileIndex) => fileIndex !== index)); setUploadError(false); setUploadMessage(""); }}><X size={16} /></button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {uploading && (
                    <div className="upload-progress-block">
                      <div className="upload-progress-caption"><span>{uploadProgress < 100 ? "Uploading to your home server…" : "Saving to library…"}</span><strong>{uploadProgress}%</strong></div>
                      <div className="upload-progress-track"><span style={{ width: uploadProgress + "%" }} /></div>
                    </div>
                  )}
                  {uploadMessage && <div className={"upload-feedback" + (uploadError ? " upload-feedback-error" : "")}><span className="upload-feedback-icon">{uploadError ? <CircleAlert size={17} /> : <Check size={17} />}</span><span>{uploadMessage}</span>{!uploadError && <button type="button" className="text-button" onClick={() => setView("library")}>Open library <ArrowUpRight size={14} /></button>}</div>}

                  {youtubeJob && (
                    <div className={"youtube-job-progress" + (youtubeJob.status === "failed" ? " youtube-job-failed" : "")} role="status">
                      <div className="youtube-job-progress-head">
                        <span className="youtube-job-icon">{youtubeJob.status === "completed" ? <Check size={16} /> : youtubeJob.status === "failed" ? <CircleAlert size={16} /> : <Download size={16} />}</span>
                        <div><strong>{youtubeJob.status === "queued" ? "Queued for download" : youtubeJob.status === "running" ? (youtubeJob.phase === "metadata" ? "Reading video metadata" : youtubeJob.phase === "download" ? "Downloading audio" : youtubeJob.phase === "conversion" ? "Converting audio" : youtubeJob.phase === "indexing" ? "Adding to library" : "Processing audio") : youtubeJob.status === "completed" ? "Download complete" : "Download failed"}</strong><small>{youtubeJob.title || "YouTube audio"}</small></div>
                        <b>{Math.round(youtubeJob.progress || 0)}%</b>
                      </div>
                      <div className="upload-progress-track"><span style={{ width: Math.max(0, Math.min(100, Number(youtubeJob.progress) || 0)) + "%" }} /></div>
                      {youtubeJob.status === "failed" && youtubeJob.error?.message && <p className="form-error">{youtubeJob.error.message}</p>}
                    </div>
                  )}
                  <div className="url-import-divider"><span>OR DOWNLOAD FROM YOUTUBE</span></div>
                  <form className="url-import-block" onSubmit={(event) => { event.preventDefault(); downloadFromYoutube(); }}>
                    <label htmlFor="audio-import-url">YouTube video URL</label>
                    <div className="url-import-row">
                      <div className="url-import-input-wrap">
                        <Youtube size={17} />
                        <input
                          id="audio-import-url"
                          type="url"
                          inputMode="url"
                          autoComplete="url"
                          placeholder="https://www.youtube.com/watch?v=..."
                          value={audioUrl}
                          onChange={(event) => { setAudioUrl(event.target.value); setUrlImportMessage(""); setUrlImportError(false); }}
                          maxLength={2048}
                          required
                          disabled={importingUrl}
                        />
                      </div>
                      <button className="primary-button" type="submit" disabled={importingUrl || !audioUrl.trim()}>
                        {importingUrl ? <RefreshCw size={15} className="spin" /> : <Download size={15} />}
                        {importingUrl ? "Downloading…" : "Download MP3"}
                      </button>
                    </div>
                    <p className="url-import-hint">Paste a link to a YouTube video — the audio is downloaded and saved as an MP3 in <code>music/Uploads</code>. Only save content you are allowed to keep.</p>
                    {urlImportMessage && <div className={"upload-feedback" + (urlImportError ? " upload-feedback-error" : "")}><span className="upload-feedback-icon">{urlImportError ? <CircleAlert size={17} /> : <Check size={17} />}</span><span>{urlImportMessage}</span>{!urlImportError && <button className="text-button" type="button" onClick={() => setView("library")}>Open library <ArrowUpRight size={14} /></button>}</div>}
                  </form>

                  <div className="import-actions">
                    <button className="primary-button" type="button" onClick={uploadSelectedFiles} disabled={uploading || selectedUploadFiles.length === 0 || uploadError}>
                      {uploading ? <RefreshCw size={16} className="spin" /> : <Upload size={16} />}
                      {uploading ? "Uploading…" : "Import selected tracks"}
                    </button>
                    <button className="text-button" type="button" disabled={uploading || selectedUploadFiles.length === 0} onClick={() => { setSelectedUploadFiles([]); setUploadMessage(""); setUploadError(false); if (uploadInputRef.current) uploadInputRef.current.value = ""; }}>Clear selection</button>
                  </div>
                </div>

                <aside className="import-side">
                  <div className="import-side-card glass-mist-panel">
                    <span className="settings-icon"><FolderOpen size={18} /></span>
                    <p className="eyebrow">WHERE FILES GO</p>
                    <h3>Saved at home</h3>
                    <p>Every upload is saved to the server's <code>music/Uploads</code> directory. It is then indexed into your music library, ready to stream when you're away from home.</p>
                    <div className="import-path"><FolderOpen size={15} /> MUSIC_DIR / Uploads</div>
                  </div>
                  <div className="import-side-card glass-mist-panel">
                    <span className="settings-icon settings-icon-blue"><Globe2 size={18} /></span>
                    <p className="eyebrow">GET MUSIC AS FILES</p>
                    <h3>Downloads you can keep</h3>
                    <p>Use stores and artists that explicitly provide downloadable audio, or music published under a license that permits downloading and personal use.</p>
                    <a className="import-resource-link" href="https://get.bandcamp.help/en/articles/15263100-where-do-i-download-my-purchase" target="_blank" rel="noreferrer">Download purchased music on Bandcamp <ArrowUpRight size={14} /></a>
                    <a className="import-resource-link" href="https://archivesupport.zendesk.com/hc/en-us/articles/360016398872-Downloading-A-Basic-Guide" target="_blank" rel="noreferrer">Internet Archive download guide <ArrowUpRight size={14} /></a>
                  </div>
                  <div className="import-side-note"><ShieldCheck size={17} /><span>Only import music you own or have permission to store. Your upload is protected by your SelfMusic session.</span></div>
                </aside>
              </div>
            </section>
          )}

          {(view === "settings" || view === "server") && (
            <section className="page-section settings-page">
              <div className="page-intro">
                <div className="intro-icon"><SectionGlyph kind="server" size={29} /></div>
                <p className="eyebrow">{view === "server" ? "CONNECTION & AVAILABILITY" : "YOUR PERSONAL MUSIC SPACE"}</p>
                <h1>{view === "server" ? "Server" : "Settings"}</h1>
                <p>{view === "server" ? "Connection details for this device and your private home server." : "Tune your profile, appearance, playback, library, and integrations."}</p>
              </div>

              {view === "settings" && <SettingsTabs active={settingsSection} onChange={setSettingsSection} />}

              <div className={"settings-status-card settings-status-" + (serverUnavailable || !navigator.onLine ? "offline" : playbackSyncStatus === "connected" ? "online" : "degraded")}>
                <div className="settings-status-icon"><span className="status-pip" /></div>
                <div className="settings-status-copy">
                  <span className="settings-overline">SERVER STATUS</span>
                  <h3>{serverUnavailable || !navigator.onLine ? "Server unreachable" : playbackSyncStatus === "connected" ? "Connected and syncing" : "Server connected · sync reconnecting"}</h3>
                  <p>The active server URL is <code>{window.location.origin}</code>.</p>
                  <p>Connection: {(/\.ts\.net$/i.test(window.location.hostname) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(window.location.hostname)) ? "Tailscale private network" : (["localhost", "127.0.0.1"].includes(window.location.hostname) || networkAddresses.local.includes(window.location.hostname)) ? "Local machine / home network" : "External domain or reverse proxy"}</p>
                  <p>Tailscale: {networkAddresses.tailscale.length ? "detected (" + networkAddresses.tailscale[0] + ")" : "no Tailscale IPv4 detected on this host"}</p>
                  {serverCheckMessage && <p className={serverUnavailable ? "form-error" : "settings-footnote"} role="status">{serverCheckMessage}</p>}
                  {networkError && <p className="form-error" role="status">{networkError}</p>}
                </div>
                <div className="settings-status-actions">
                  <span className={"status-badge " + (serverUnavailable || !navigator.onLine ? "status-badge-offline" : playbackSyncStatus === "connected" ? "" : "status-badge-degraded")}><span />{serverUnavailable || !navigator.onLine ? "Offline" : playbackSyncStatus === "connected" ? "Online" : "Degraded"}</span>
                  <button className="settings-action settings-reconnect-button" type="button" onClick={reconnectServer} disabled={serverCheckBusy}>
                    <RefreshCw size={15} className={serverCheckBusy ? "spin" : ""} /> {serverCheckBusy ? "Checking…" : "Reconnect"}
                  </button>
                </div>
              </div>

              <div className="settings-grid">
                <div className="settings-card" data-settings-section="profile">
                  <div className="settings-card-head"><span className="settings-icon"><AudioLines size={19} /></span><span className="settings-overline">SIGNED-IN ACCOUNT</span></div>
                  <h3>{profile.username || "Server owner"}</h3>
                  <p>You are signed in with the <strong>{profile.role || "user"}</strong> role. Preferences for playback stay on this browser; playlists, favorites, and history are stored on the server.</p>
                  <div className="settings-action"><ShieldCheck size={15} /> Account role <span>{profile.role || "user"}</span></div>
                  <button className="settings-action" type="button" onClick={handleLogout}><LogOut size={15} /> Sign out of this account</button>
                </div>

                <div className="settings-card" data-settings-section="player">
                  <div className="settings-card-head"><span className="settings-icon settings-icon-blue"><AudioLines size={19} /></span><span className="settings-overline">STREAM QUALITY</span></div>
                  <h3>Audio format and bitrate</h3>
                  <p>Original files avoid transcoding. Alternate formats use the server's FFmpeg cache and require <code>TRANSCODE_ENABLED=true</code>.</p>
                  <label className="appearance-control-label" htmlFor="stream-format-select"><strong>Format</strong><span>Choose what the player requests</span></label>
                  <select id="stream-format-select" value={streamFormat} onChange={(event) => setStreamFormat(event.target.value)}>
                    <option value="original">Original audio</option>
                    <option value="mp3" disabled={!playerSettings.transcodingEnabled}>MP3</option>
                    <option value="opus" disabled={!playerSettings.transcodingEnabled}>Opus</option>
                    <option value="aac" disabled={!playerSettings.transcodingEnabled}>AAC</option>
                  </select>
                  <label className="appearance-control-label" htmlFor="stream-bitrate-select"><strong>Target bitrate</strong><span>Used only when transcoding</span></label>
                  <select id="stream-bitrate-select" value={streamBitrate} onChange={(event) => setStreamBitrate(event.target.value)}>
                    {(playerSettings.bitrates || ["96k", "128k", "160k", "192k", "256k", "320k"]).map((bitrate) => <option value={bitrate} key={bitrate}>{bitrate}</option>)}
                  </select>
                  <div className="info-note"><ShieldCheck size={16} /><span>{playerSettings.transcodingEnabled ? "Transcoding is enabled." : "Transcoding is currently disabled by the server administrator."}</span></div>
                </div>

                <div className="settings-card" data-settings-section="integrations">
                  <div className="settings-card-head"><span className="settings-icon"><Globe2 size={19} /></span><span className="settings-overline">LAST.FM SCROBBLING</span></div>
                  <h3>{lastFmStatus.connected ? "Last.fm connected" : "Connect your Last.fm account"}</h3>
                  <p>{lastFmStatus.connected ? "Scrobbles will be sent for eligible tracks on this account." : "Authorize Last.fm to send now-playing updates and scrobbles from this profile."}</p>
                  {lastFmStatus.connected && <div className="settings-action"><Check size={15} /> Connected account <span>{lastFmStatus.account?.username || "Last.fm user"}</span></div>}
                  {lastFmMessage && <p className={lastFmMessage.toLowerCase().includes("could not") || lastFmMessage.toLowerCase().includes("failed") ? "form-error" : "settings-footnote"} role="status">{lastFmMessage}</p>}
                  {!lastFmStatus.connected ? (
                    <button className="settings-action" type="button" disabled={!lastFmStatus.configured} onClick={connectLastFm}><Globe2 size={15} /> Authorize Last.fm <ArrowUpRight size={15} /></button>
                  ) : (
                    <button className="settings-action" type="button" onClick={disconnectLastFm}><X size={15} /> Disconnect Last.fm</button>
                  )}
                  {!lastFmStatus.configured && <p className="settings-footnote">To enable scrobbling, create an API app at <a href="https://www.last.fm/api/account/create" target="_blank" rel="noreferrer">Last.fm API</a>. Add <code>LASTFM_API_KEY</code>, <code>LASTFM_API_SECRET</code>, and <code>LASTFM_CALLBACK_URL</code> to the server project's private <code>.env</code>; the callback must match your Last.fm app settings. Restart SelfMusic, then return here and choose Authorize Last.fm.</p>}
                </div>

                <div className="settings-card" data-settings-section="integrations">
                  <div className="settings-card-head"><span className="settings-icon settings-icon-blue"><Youtube size={19} /></span><span className="settings-overline">YOUTUBE SEARCH</span></div>
                  <h3>Explore YouTube integration</h3>
                  <p>Search needs a server-side YouTube Data API v3 key. Without it, search returns HTTP 503. Direct video links still use the official player; MP3 downloads use the separate yt-dlp tool.</p>
                  <ol className="integration-steps">
                    <li>Enable YouTube Data API v3 in Google Cloud.</li>
                    <li>Add <code>YOUTUBE_API_KEY=your-key</code> to the project’s private <code>.env</code>.</li>
                    <li>Restart SelfMusic, then try Explore YouTube again.</li>
                  </ol>
                  <a className="settings-action settings-link" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Open Google Cloud credentials <ArrowUpRight size={15} /></a>
                </div>

                {profile.role === "admin" && (
                  <div className="settings-card settings-card-wide duplicate-manager" data-settings-section="library">
                    <div className="settings-card-head"><span className="settings-icon"><Copy size={19} /></span><span className="settings-overline">LIBRARY INTEGRITY</span></div>
                    <h3>Duplicate audio files</h3>
                    <p>Files are grouped only when their SHA-256 hashes match exactly. Merging transfers favorites, playlists and history to the retained track before deleting duplicate files.</p>
                    <div className="duplicate-toolbar">
                      <span className="settings-footnote">{duplicateGroups.length} duplicate groups</span>
                      <button className="settings-action duplicate-refresh" type="button" disabled={duplicateLoading} onClick={refreshDuplicates}><RefreshCw size={15} className={duplicateLoading ? "spin" : ""} /> Scan for duplicates</button>
                    </div>
                    {duplicateMessage && <p className={duplicateMessageError ? "form-error" : "settings-footnote"} role="status">{duplicateMessage}</p>}
                    {duplicateGroups.length ? (
                      <div className="duplicate-groups">
                        {duplicateGroups.map((group) => (
                          <div className="duplicate-group" key={group.sha256}>
                            <div className="duplicate-group-heading">
                              <div><strong>{group.count} identical files</strong><small>SHA-256: {group.sha256}</small></div>
                              <button className="primary-button" type="button" onClick={() => mergeDuplicateGroup(group)}><Copy size={14} /> Keep first, merge</button>
                            </div>
                            {group.tracks.map((track, index) => (
                              <div className="admin-user-row duplicate-track-row" key={track.id}>
                                <div><strong>{track.title}</strong><small>{track.artist} · {track.album} · {track.path}</small></div>
                                <span className="duplicate-size">{index === 0 ? "Keep" : (Number(track.bytes) / 1024 / 1024).toFixed(1) + " MB"}</span>
                                {index > 0 && <button className="icon-button" type="button" title="Delete this duplicate" aria-label={"Delete duplicate " + track.title} onClick={() => deleteDuplicate(track)}><Trash2 size={15} /></button>}
                                {index === 0 && <span className="duplicate-retained"><Check size={14} /> Primary</span>}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : <p className="settings-footnote">No identical files found in the indexed library. Run a scan after importing music to update the result.</p>}
                  </div>
                )}

                {profile.role === "admin" && (
                  <div className="settings-card settings-card-wide" data-settings-section="profile">
                    <div className="settings-card-head"><span className="settings-icon"><LockKeyhole size={19} /></span><span className="settings-overline">ADMINISTRATION</span></div>
                    <h3>Manage user accounts</h3>
                    <p>Create a separate login for another household member or device. A User can listen without managing the server; an Admin can also manage files and accounts. Use a unique password of at least 12 characters and share it privately.</p>
                    <form className="account-create-form" onSubmit={createAccount}>
                      <label htmlFor="new-account-username">Username</label>
                      <input id="new-account-username" type="text" value={newAccountUsername} onChange={(event) => setNewAccountUsername(event.target.value)} minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" autoComplete="off" required />
                      <label htmlFor="new-account-password">Temporary password</label>
                      <input id="new-account-password" type="password" value={newAccountPassword} onChange={(event) => setNewAccountPassword(event.target.value)} minLength={12} maxLength={128} autoComplete="new-password" required />
                      <label htmlFor="new-account-role">Role</label>
                      <select id="new-account-role" value={newAccountRole} onChange={(event) => setNewAccountRole(event.target.value)}><option value="user">User — stream only</option><option value="admin">Admin — manage server</option></select>
                      <button className="primary-button" type="submit"><Plus size={15} /> Create account</button>
                    </form>
                    {accountMessage && <p className={accountMessageError ? "form-error" : "settings-footnote"} role="status">{accountMessage}</p>}
                    <div className="admin-user-list">
                      {adminUsers.map((user) => (
                        <div className="admin-user-row" key={user.id}>
                          <div><strong>{user.username}</strong><small>Created {new Date(user.createdAt).toLocaleDateString()}</small></div>
                          <select aria-label={"Role for " + user.username} value={user.role} disabled={user.id === profile.id} onChange={(event) => changeAccountRole(user, event.target.value)}><option value="user">User</option><option value="admin">Admin</option></select>
                          {user.id !== profile.id && <button className="icon-button" type="button" title={"Delete " + user.username} aria-label={"Delete account " + user.username} onClick={() => deleteAccount(user)}><Trash2 size={15} /></button>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="settings-card" data-settings-section="library">
                  <div className="settings-card-head"><span className="settings-icon"><FolderOpen size={19} /></span><span className="settings-overline">MUSIC COLLECTION</span></div>
                  <h3>Where your files live</h3>
                  <p>Put supported audio files into the folder configured by <code>MUSIC_DIR</code>. By default, that is <code>./music</code> in the project directory.</p>
                  <div className="format-list"><span>MP3</span><span>FLAC</span><span>M4A</span><span>AAC</span><span>WAV</span><span>OGG</span><span>OPUS</span></div>
                  <button className="settings-action" onClick={loadTracks}><RefreshCw size={15} className={loadingTracks ? "spin" : ""} /> Scan library <span>{tracks.length} tracks</span></button>
                </div>

                <div className="settings-card" data-settings-section="integrations">
                  <div className="settings-card-head"><span className="settings-icon settings-icon-blue"><Globe2 size={19} /></span><span className="settings-overline">REMOTE ACCESS</span></div>
                  <h3>Listen outside your Wi-Fi</h3>
                  <p>Set up Tailscale on this computer and your phone. No router port forwarding and no shared auth key are needed for the normal native setup.</p>
                  <button className="settings-action" type="button" onClick={() => setRemoteWizardOpen(true)}><Smartphone size={15} /> Open setup wizard <ArrowUpRight size={15} /></button>
                  {networkAddresses.tailscale.length > 0 && <div className="info-note"><ShieldCheck size={16} /><span>Tailscale detected: {networkAddresses.tailscale[0]}</span></div>}
                </div>

                <div className="settings-card" data-settings-section="offline">
                  <div className="settings-card-head"><span className="settings-icon"><Download size={19} /></span><span className="settings-overline">OFFLINE AUDIO</span></div>
                  <h3>{offlineTrackIds.length} saved {offlineTrackIds.length === 1 ? "track" : "tracks"} on this device</h3>
                  <p>Offline copies live in this browser's storage and do not automatically appear on another device. Open Offline from Add to save or remove individual tracks.</p>
                  <button className="settings-action" type="button" onClick={() => setView("offline")}><Download size={15} /> Manage offline tracks <ArrowUpRight size={15} /></button>
                  <p className="settings-footnote">Cache-size limits and automatic downloads are not configurable yet. Browser storage may be cleared by the operating system.</p>
                </div>

                <div className="settings-card" data-settings-section="advanced">
                  <div className="settings-card-head"><span className="settings-icon"><Download size={19} /></span><span className="settings-overline">INSTALLABLE PLAYER</span></div>
                  <h3>{pwaInstalled ? "SelfMusic is installed" : "Install SelfMusic"}</h3>
                  <p>Open your music server in an app-like window. Playback and offline downloads remain available where your browser supports them.</p>
                  <button className="settings-action pwa-install-button" type="button" onClick={installSelfMusic} disabled={pwaInstalled}>
                    <Smartphone size={16} /> {pwaInstalled ? "Installed on this device" : installPromptEvent ? "Install app" : "Show install instructions"}
                  </button>
                  {pwaInstallMessage && <p className="settings-footnote" role="status">{pwaInstallMessage}</p>}
                  {!pwaInstalled && <p className="settings-footnote">On iOS, use Safari's Share menu and choose Add to Home Screen. HTTPS is required for most install and service-worker features.</p>}
                </div>

                <div className="settings-card settings-card-wide appearance-settings-card" data-settings-section="appearance">
                  <div className="settings-card-head"><span className="settings-icon"><Palette size={19} /></span><span className="settings-overline">PERSONALIZE YOUR PLAYER</span></div>
                  <h3>Make SelfMusic yours</h3>
                  <p>Your appearance is saved in this browser. It changes the interface, not your music files or server settings.</p>
                  <div className="appearance-control">
                    <div className="appearance-control-label"><strong>Accent color</strong><span>Choose the interface highlight</span></div>
                    <div className="appearance-swatches" role="group" aria-label="Accent color">
                      {ACCENT_PRESETS.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          className={"appearance-swatch" + (appearance.accent === choice.id ? " appearance-swatch-active" : "")}
                          style={{ "--swatch-color": choice.color }}
                          onClick={() => {
                            const colorState = hexToHsv(choice.color);
                            setAppearance((current) => ({ ...current, ...colorState, accent: choice.id, accentColor: choice.color }));
                          }}
                          aria-label={choice.label}
                          aria-pressed={appearance.accent === choice.id}
                        >
                          <span />
                          <small>{choice.label}</small>
                        </button>
                      ))}
                    </div>
                    <div className="accent-picker">
                      <div className="accent-picker-heading"><span>Full spectrum</span><code aria-live="polite">{appearance.accentColor.toUpperCase()}</code></div>
                      <div className="accent-picker-field-wrap">
                        <div
                          className="accent-color-field"
                          role="application"
                          tabIndex={0}
                          aria-label="Choose saturation and brightness with arrow keys"
                          style={{ "--picker-hue": appearance.hue, "--picker-x": appearance.saturation + "%", "--picker-y": (100 - appearance.value) + "%" }}
                          onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); updateAccentFromField(event); }}
                          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateAccentFromField(event); }}
                          onKeyDown={handleAccentFieldKeyDown}
                        >
                          <span className="accent-color-field-white" />
                          <span className="accent-color-field-black" />
                          <span className="accent-color-field-cursor" style={{ background: appearance.accentColor }} />
                        </div>
                        <label className="accent-hue-control">
                          <span>Hue spectrum</span>
                          <input
                            className="accent-hue-range"
                            type="range"
                            min="0"
                            max="359"
                            step="1"
                            value={appearance.hue}
                            aria-label="Hue spectrum"
                            style={{ "--hue-thumb": appearance.hue }}
                            onChange={(event) => {
                              const hue = Number(event.target.value);
                              setAppearance((current) => ({ ...current, accent: "custom", hue, accentColor: hsvToHex(hue, current.saturation, current.value) }));
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="appearance-control">
                    <div className="appearance-control-label"><strong>Glass effect</strong><span>Change blur and panel opacity</span></div>
                    <div className="appearance-glass-options" role="group" aria-label="Glass effect">
                      {[
                        { id: "liquid", label: "Liquid glass", description: "Rich blur and highlights" },
                        { id: "soft", label: "Soft glass", description: "Lighter translucency" },
                        { id: "solid", label: "Solid", description: "Minimal blur, opaque panels" },
                      ].map((choice) => (
                        <button key={choice.id} type="button" className={"appearance-glass-option" + (appearance.glass === choice.id ? " appearance-glass-option-active" : "")} onClick={() => setAppearance((value) => ({ ...value, glass: choice.id }))} aria-pressed={appearance.glass === choice.id}>
                          <span className={"glass-preview glass-preview-" + choice.id} />
                          <strong>{choice.label}</strong>
                          <small>{choice.description}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="appearance-control">
                    <div className="appearance-control-label"><strong>Color scheme</strong><span>Dark, light, or follow the device</span></div>
                    <div className="appearance-glass-options theme-options" role="group" aria-label="Color scheme">
                      <button type="button" className={"appearance-glass-option" + (appearance.theme === "dark" ? " appearance-glass-option-active" : "")} onClick={() => setAppearance((value) => ({ ...value, theme: "dark" }))} aria-pressed={appearance.theme === "dark"}><span className="theme-preview theme-preview-dark" /><strong>Dark</strong><small>OLED-friendly</small></button>
                      <button type="button" className={"appearance-glass-option" + (appearance.theme === "light" ? " appearance-glass-option-active" : "")} onClick={() => setAppearance((value) => ({ ...value, theme: "light" }))} aria-pressed={appearance.theme === "light"}><span className="theme-preview theme-preview-light" /><strong>Light</strong><small>Bright surfaces</small></button>
                      <button type="button" className={"appearance-glass-option" + (appearance.theme === "system" ? " appearance-glass-option-active" : "")} onClick={() => setAppearance((value) => ({ ...value, theme: "system" }))} aria-pressed={appearance.theme === "system"}><span className="theme-preview theme-preview-system" /><strong>System</strong><small>Follow device</small></button>
                    </div>
                  </div>
                  <div className="appearance-control">
                    <div className="appearance-control-label"><strong>Background presets</strong><span>Choose the mood of your music space</span></div>
                    <div className="background-presets" role="group" aria-label="Background presets">
                      {BACKGROUND_PRESETS.map((preset) => (
                        <button type="button" key={preset.id} className={"background-preset" + (appearance.backgroundPreset === preset.id && !appearance.wallpaperDataUrl ? " background-preset-active" : "")} onClick={() => setAppearance((value) => ({ ...value, backgroundPreset: preset.id, wallpaperDataUrl: "" }))} aria-pressed={appearance.backgroundPreset === preset.id}>
                          <span style={{ backgroundImage: preset.image }} /><strong>{preset.label}</strong>
                        </button>
                      ))}
                    </div>
                    <label className="wallpaper-upload">
                      <span><Upload size={15} /> Use your own wallpaper <small>(PNG, JPEG, WebP · up to 1 MB)</small></span>
                      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 1024 * 1024) {
                          setAppearanceMessage("Choose a PNG, JPEG, or WebP image up to 1 MB so it fits browser storage.");
                          event.target.value = "";
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = () => {
                          if (typeof reader.result === "string") {
                            setAppearance((value) => ({ ...value, wallpaperDataUrl: reader.result }));
                            setAppearanceMessage("Wallpaper selected; syncing to your account…");
                          }
                        };
                        reader.onerror = () => setAppearanceMessage("Could not read this image. Try another file.");
                        reader.readAsDataURL(file);
                      }} />
                    </label>
                    {appearance.wallpaperDataUrl && <button className="text-button" type="button" onClick={() => setAppearance((value) => ({ ...value, wallpaperDataUrl: "" }))}>Remove wallpaper</button>}
                    {appearance.wallpaperDataUrl && <label className="appearance-range-label"><span>Wallpaper dimming</span><strong>{appearance.wallpaperDim}%</strong><input className="range-input" type="range" min="5" max="85" step="5" value={appearance.wallpaperDim} onChange={(event) => setAppearance((value) => ({ ...value, wallpaperDim: Number(event.target.value) }))} /></label>}
                    {appearance.wallpaperDataUrl && <label className="appearance-range-label"><span>Wallpaper blur</span><strong>{appearance.wallpaperBlur}px</strong><input className="range-input" type="range" min="0" max="18" step="1" value={appearance.wallpaperBlur} onChange={(event) => setAppearance((value) => ({ ...value, wallpaperBlur: Number(event.target.value) }))} /></label>}
                  </div>
                  <div className="appearance-control">
                    <div className="appearance-control-label"><strong>Glass and layout</strong><span>Adjust how the controls feel</span></div>
                    <label className="appearance-range-label"><span>Panel opacity</span><strong>{appearance.glassOpacity}%</strong><input className="range-input" type="range" min="35" max="96" step="1" value={appearance.glassOpacity} onChange={(event) => setAppearance((value) => ({ ...value, glassOpacity: Number(event.target.value) }))} /></label>
                    <label className="appearance-range-label"><span>Blur</span><strong>{appearance.glassBlur}px</strong><input className="range-input" type="range" min="0" max="36" step="1" value={appearance.glassBlur} onChange={(event) => setAppearance((value) => ({ ...value, glassBlur: Number(event.target.value) }))} /></label>
                    <label className="appearance-range-label"><span>Corner radius</span><strong>{appearance.cornerRadius}px</strong><input className="range-input" type="range" min="10" max="32" step="1" value={appearance.cornerRadius} onChange={(event) => setAppearance((value) => ({ ...value, cornerRadius: Number(event.target.value) }))} /></label>
                    <label className="appearance-range-label">Interface density<select value={appearance.density} onChange={(event) => setAppearance((value) => ({ ...value, density: event.target.value }))}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
                    <label className="appearance-range-label">Desktop navigation position<select value={appearance.navPosition} onChange={(event) => setAppearance((value) => ({ ...value, navPosition: event.target.value }))}><option value="auto">Adaptive (sidebar / phone bottom)</option><option value="left">Sidebar on the left</option><option value="right">Sidebar on the right</option><option value="bottom">Bottom navigation</option></select></label>
                    <label className="appearance-check-row"><input type="checkbox" checked={appearance.animations} onChange={(event) => setAppearance((value) => ({ ...value, animations: event.target.checked }))} /><span>Enable interface animations</span></label>
                    <label className="appearance-range-label">Animation speed<select value={appearance.animationSpeed} disabled={!appearance.animations} onChange={(event) => setAppearance((value) => ({ ...value, animationSpeed: event.target.value }))}><option value="slow">Slow and soft</option><option value="normal">Balanced</option><option value="fast">Fast</option></select></label>
                    {appearanceMessage && <p className="settings-footnote" role="status">{appearanceMessage}</p>}
                  </div>
                  <div className="appearance-theme-actions">
                    <button className="ghost-button" type="button" onClick={() => {
                      try {
                        const blob = new Blob([JSON.stringify({ format: "selfmusic-theme", version: 1, appearance }, null, 2)], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const anchor = document.createElement("a");
                        anchor.href = url;
                        anchor.download = "selfmusic-theme.json";
                        anchor.click();
                        URL.revokeObjectURL(url);
                        setAppearanceMessage("Theme exported. Import this JSON on another browser to copy the design.");
                      } catch {
                        setAppearanceMessage("Theme export failed in this browser.");
                      }
                    }}><Download size={15} /> Export theme</button>
                    <label className="ghost-button theme-import-button"><Upload size={15} /> Import theme
                      <input type="file" accept="application/json,.json" onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        try {
                          if (file.size > 2 * 1024 * 1024) throw new Error("Theme file is larger than 2 MB.");
                          const parsed = JSON.parse(await file.text());
                          const incoming = parsed?.appearance;
                          if (parsed?.format !== "selfmusic-theme" || parsed?.version !== 1 || !incoming || typeof incoming !== "object") throw new Error("This is not a supported SelfMusic theme file.");
                          if (incoming.wallpaperDataUrl && (typeof incoming.wallpaperDataUrl !== "string" || !/^data:image\/(png|jpeg|webp);base64,/.test(incoming.wallpaperDataUrl) || incoming.wallpaperDataUrl.length > 1450000)) throw new Error("The theme wallpaper is invalid or too large.");
                          const accentColor = /^#[0-9a-f]{6}$/i.test(incoming.accentColor || "") ? incoming.accentColor : ACCENT_PRESETS[0].color;
                          const next = {
                            ...appearance,
                            accent: ACCENT_PRESETS.some((item) => item.id === incoming.accent) ? incoming.accent : "custom",
                            accentColor,
                            ...hexToHsv(accentColor),
                            glass: ["liquid", "soft", "solid"].includes(incoming.glass) ? incoming.glass : "liquid",
                            theme: ["dark", "light", "system"].includes(incoming.theme) ? incoming.theme : "dark",
                            glassOpacity: clampNumber(Number.isFinite(Number(incoming.glassOpacity)) ? Number(incoming.glassOpacity) : 78, 35, 96),
                            glassBlur: clampNumber(Number.isFinite(Number(incoming.glassBlur)) ? Number(incoming.glassBlur) : 24, 0, 36),
                            cornerRadius: clampNumber(Number.isFinite(Number(incoming.cornerRadius)) ? Number(incoming.cornerRadius) : 20, 10, 32),
                            density: incoming.density === "compact" ? "compact" : "comfortable",
                            navPosition: ["auto", "left", "right", "bottom"].includes(incoming.navPosition) ? incoming.navPosition : "auto",
                            backgroundPreset: BACKGROUND_PRESETS.some((preset) => preset.id === incoming.backgroundPreset) ? incoming.backgroundPreset : "midnight",
                            wallpaperDataUrl: incoming.wallpaperDataUrl || "",
                            wallpaperDim: clampNumber(Number(incoming.wallpaperDim) || 38, 5, 85),
                            animations: incoming.animations !== false,
                            animationSpeed: ["slow", "normal", "fast"].includes(incoming.animationSpeed) ? incoming.animationSpeed : "normal",
                          };
                          setAppearance(next);
                          setAppearanceMessage("Theme imported and saved in this browser.");
                        } catch (error) {
                          setAppearanceMessage(error.message || "Could not import this theme file.");
                        } finally {
                          event.target.value = "";
                        }
                      }} />
                    </label>
                    <button className="text-button appearance-reset" type="button" onClick={() => { setAppearance({ accent: "rose", accentColor: ACCENT_PRESETS[0].color, ...hexToHsv(ACCENT_PRESETS[0].color), glass: "liquid", theme: "dark", glassOpacity: 78, glassBlur: 24, cornerRadius: 20, density: "comfortable", navPosition: "auto", backgroundPreset: "midnight", wallpaperDataUrl: "", wallpaperDim: 38, wallpaperBlur: 0, animations: true, animationSpeed: "normal" }); setAppearanceMessage(""); }}>Reset appearance</button>
                  </div>
                </div>

                <div className="settings-card settings-card-wide" data-settings-section="about">
                  <div className="settings-card-head"><span className="settings-icon"><AudioLines size={19} /></span><span className="settings-overline">ABOUT SELFMUSIC</span></div>
                  <h3>SelfMusic · v0.1.0</h3>
                  <p>Your personal music space, hosted on your own machine. Your server keeps the original files while this browser stores the current appearance preferences and local offline copies.</p>
                  <div className="settings-action"><Server size={15} /> Active server <span>{window.location.origin}</span></div>
                  <a className="settings-action settings-link" href="https://github.com/b-1-o/selfmusic" target="_blank" rel="noreferrer"><Globe2 size={15} /> Source code and release notes <ArrowUpRight size={15} /></a>
                  <p className="settings-footnote">Appearance and wallpaper preferences currently stay in this browser. Export a theme from Settings → Appearance and import it on another device to copy the look; server-side preference sync is not implemented yet.</p>
                </div>

                <div className="settings-card settings-card-wide" data-settings-section="advanced">
                  <div className="settings-card-head"><span className="settings-icon"><LockKeyhole size={19} /></span><span className="settings-overline">SECURITY CHECKLIST</span></div>
                  <h3>Before you use it remotely</h3>
                  <div className="security-checklist">
                    <div><Check size={16} /><span>Use unique passwords of at least 12 characters for managed accounts.</span></div>
                    <div><Check size={16} /><span>Set <code>SESSION_SECRET</code> in your local <code>.env</code> file.</span></div>
                    <div><Check size={16} /><span>Use HTTPS with a private access policy and never commit <code>.env</code>.</span></div>
                    <div><Check size={16} /><span>Keep the operating system and Node.js updated.</span></div>
                  </div>
                  <button className="settings-action" onClick={() => copyText("node -e \"console.log(require('node:crypto').randomBytes(32).toString('hex'))\"")}><Copy size={15} /> {copied ? "Copied" : "Copy secret-generation command"} {copied && <Check size={15} />}</button>
                  <p className="settings-footnote">Create and edit <code>.env</code> directly in the project folder with your preferred editor. Keep it private and never commit it to GitHub.</p>
                </div>
              </div>

              {view === "settings" && <div className="settings-footer"><span><ShieldCheck size={15} /> Self-hosted means you control the machine and its uptime.</span><button className="text-button" onClick={handleLogout}>Sign out <LogOut size={14} /></button></div>}
            </section>
          )}
        </div>
      </main>

      {remoteWizardOpen && (
        <div className="remote-wizard-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRemoteWizard(); }}>
          <section className="remote-wizard" role="dialog" aria-modal="true" aria-labelledby="remote-wizard-title">
            <div className="remote-wizard-head">
              <div className="remote-wizard-brand"><span className="remote-wizard-icon"><Globe2 size={19} /></span><span>PRIVATE REMOTE ACCESS</span></div>
              <button className="icon-button remote-wizard-close" type="button" onClick={closeRemoteWizard} aria-label="Close setup wizard"><X size={19} /></button>
            </div>
            <h2 id="remote-wizard-title">Take your music with you.</h2>
            <p className="remote-wizard-intro">Your computer keeps the original files. Tailscale connects your phone to it privately, without opening ports on your router.</p>
            <div className="remote-wizard-steps">
              <div className="remote-wizard-step"><span>1</span><div><strong>Install Tailscale on this computer</strong><p>Sign in to your Tailscale account. On Linux, make sure the system service is running.</p><a href={TAILSCALE_DOWNLOAD_URL} target="_blank" rel="noreferrer">Get Tailscale for desktop <ArrowUpRight size={14} /></a></div></div>
              <div className="remote-wizard-step"><span>2</span><div><strong>Install it on your phone</strong><p>Open the official download page, install the app, and sign in to the same account as your computer.</p><a href={TAILSCALE_DOWNLOAD_URL} target="_blank" rel="noreferrer">Open phone download page <ArrowUpRight size={14} /></a></div></div>
              <div className="remote-wizard-step"><span>3</span><div><strong>Enable private HTTPS</strong><p>On the computer, run <code>selfmusic remote</code>. Tailscale may ask you to enable MagicDNS and HTTPS certificates.</p><button className="text-button wizard-copy-command" type="button" onClick={() => copyText("selfmusic remote")}><Copy size={14} /> Copy command</button></div></div>
            </div>
            <div className="remote-wizard-qr-card">
              <img src={TAILSCALE_QR_URL} alt="QR code linking to the official Tailscale download page" width="144" height="144" loading="lazy" />
              <div><strong>Scan with your phone</strong><span>QR contains only the public Tailscale download link, not your private server address.</span></div>
              <a href={TAILSCALE_DOWNLOAD_URL} target="_blank" rel="noreferrer">Open download page <ArrowUpRight size={14} /></a>
            </div>
            <div className="remote-wizard-addresses">
              <div className="remote-address-title"><div><strong>Your connection addresses</strong><span>Refresh after Tailscale connects</span></div><button className="ghost-button" type="button" onClick={refreshNetworkAddresses} disabled={networkLoading}>{networkLoading ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />} Check connection</button></div>
              {networkError && <p className="remote-address-error">{networkError}</p>}
              {networkAddresses.tailscale.length > 0 ? networkAddresses.tailscale.map((ip) => (
                <div className="remote-address-row" key={ip}><div><span className="remote-address-kind"><ShieldCheck size={14} /> Tailscale</span><strong>http://{ip}:{window.location.port || "8787"}</strong></div><button className="icon-button" type="button" onClick={() => copyText("http://" + ip + ":" + (window.location.port || "8787"))} aria-label={"Copy Tailscale address " + ip}><Copy size={16} /></button></div>
              )) : (
                <div className="remote-address-row remote-address-pending"><div><span className="remote-address-kind"><RefreshCw size={14} /> Waiting for Tailscale</span><strong>No Tailscale IP detected on this server yet.</strong></div></div>
              )}
              {networkAddresses.local.slice(0, 2).map((ip) => (
                <div className="remote-address-row" key={ip}><div><span className="remote-address-kind"><Smartphone size={14} /> Same Wi-Fi only</span><strong>http://{ip}:{window.location.port || "8787"}</strong></div><button className="icon-button" type="button" onClick={() => copyText("http://" + ip + ":" + (window.location.port || "8787"))} aria-label={"Copy local address " + ip}><Copy size={16} /></button></div>
              ))}
            </div>
            <div className="remote-wizard-footer"><span><ShieldCheck size={15} /> Never forward port 8787 publicly.</span><button className="primary-button" type="button" onClick={closeRemoteWizard}>Got it <Check size={16} /></button></div>
          </section>
        </div>
      )}

      <Navigation
        variant="mobile"
        view={view}
        onNavigate={setView}
        role={profile.role}
        offlineMode={offlineMode}
        trackCount={tracks.length}
      />

      {authenticated && playbackSyncStatus !== "connected" && (
        <div className={"playback-sync-notice playback-sync-" + playbackSyncStatus} role="status" aria-live="polite">
          <span className="playback-sync-dot" />
          {playbackSyncStatus === "offline" ? "Playback sync offline" : "Reconnecting playback sync…"}
        </div>
      )}
      {remotePlaybackState && remotePlaybackTrack && (
        <div className="playback-resume-banner" role="status" aria-live="polite">
          <div className="playback-resume-copy">
            <span className="playback-resume-eyebrow">PLAYBACK ON ANOTHER DEVICE</span>
            <strong>{remotePlaybackTrack.title}</strong>
            <span>{remotePlaybackTrack.artist} · Resume at {Math.floor(Math.max(0, Number(remotePlaybackState.positionSeconds) || 0) / 60)}:{String(Math.floor(Math.max(0, Number(remotePlaybackState.positionSeconds) || 0) % 60)).padStart(2, "0")}</span>
          </div>
          <button className="primary-button playback-resume-action" type="button" onClick={resumeRemotePlayback}>Continue here</button>
          <button className="secondary-button playback-resume-dismiss" type="button" onClick={dismissRemotePlayback} aria-label="Dismiss cross-device playback prompt">Dismiss</button>
        </div>
      )}
      <PlayerBar
        audioRef={audioRef}
        trackTint={playerTint}
        track={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        muted={muted}
        shuffle={shuffle}
        repeatMode={repeatMode}
        onToggle={togglePlayback}
        onPrevious={playPrevious}
        onSwitchPrevious={playPreviousTrack}
        onNext={playNext}
        onSeek={(value) => { if (audioRef.current) audioRef.current.currentTime = value; lastUiTimeRef.current = value; setCurrentTime(value); }}
        onVolume={(value) => { setVolume(value); setMuted(false); }}
        onMute={() => setMuted((value) => !value)}
        onShuffle={() => setShuffle((value) => !value)}
        onRepeat={() => setRepeatMode((mode) => mode === "off" ? "all" : mode === "all" ? "one" : "off")}
        onFavorite={() => currentTrack && toggleFavorite(currentTrack.id)}
        isFavorite={Boolean(currentTrack && favorites.includes(currentTrack.id))}
      />
      <audio
        ref={audioRef}
        preload="auto"
        playsInline
        onPlay={() => {
          playbackSyncPausedForRemoteRef.current = false;
          setRemotePlaybackState(null);
          playbackSyncLastPayloadRef.current = "";
          setIsPlaying(true);
          if (currentTrack && nowPlayingTrackRef.current !== currentTrack.id) {
            nowPlayingTrackRef.current = currentTrack.id;
            if (historyTrackRef.current !== currentTrack.id) {
              historyTrackRef.current = currentTrack.id;
              fetch("/api/history", {
                method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ trackId: currentTrack.id, positionSeconds: 0 }),
              }).catch(() => {});
            }
            fetch("/api/lastfm/now-playing", {
              method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trackId: currentTrack.id, durationSeconds: currentTrack.duration }),
            }).catch(() => {});
          }
        }}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(event) => {
          const nextTime = event.currentTarget.currentTime;
          const updateInterval = window.innerWidth <= 720 ? 0.6 : 0.25;
          if (nextTime < lastUiTimeRef.current || nextTime - lastUiTimeRef.current >= updateInterval) {
            lastUiTimeRef.current = nextTime;
            setCurrentTime(nextTime);
          }
          const trackId = currentTrackId;
          const knownDuration = Number(event.currentTarget.duration || duration || 0);
          const qualifiesForScrobble = knownDuration > 0 && (nextTime > knownDuration * 0.5 || nextTime > 240);
          if (qualifiesForScrobble && trackId && scrobbledTrackRef.current !== trackId) {
            scrobbledTrackRef.current = trackId;
            fetch("/api/lastfm/scrobble", {
              method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trackId, listenedSeconds: nextTime, durationSeconds: knownDuration }),
            }).then((response) => {
              if (!response.ok) scrobbledTrackRef.current = "";
            }).catch(() => { scrobbledTrackRef.current = ""; });
          }
        }}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
          const pending = pendingResumeRef.current;
          if (pending && pending.trackId === currentTrackId) {
            const desired = Math.max(0, Number(pending.positionSeconds) || 0);
            audio.currentTime = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.min(desired, Math.max(0, audio.duration - 0.25)) : desired;
            setCurrentTime(audio.currentTime);
            pendingResumeRef.current = null;
          }
        }}
        onEnded={() => {
          if (repeatMode === "one" && audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(() => setIsPlaying(false));
          } else {
            playNext();
          }
        }}
        onError={() => setLoadError("This file could not be played by this browser. Try a different audio format.")}
      />
    </div>
  );
}


export default App;
