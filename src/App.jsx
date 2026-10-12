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

const FAVORITES_KEY = "selfmusic:favorites:v1";
const LAST_TRACK_KEY = "selfmusic:last-track:v1";
const APPEARANCE_KEY = "selfmusic:appearance:v1";
const REMOTE_WIZARD_KEY = "selfmusic:remote-wizard-seen:v1";
const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
const TAILSCALE_QR_URL = "https://api.qrserver.com/v1/create-qr-code/?size=192x192&margin=8&data=" + encodeURIComponent(TAILSCALE_DOWNLOAD_URL);
const SUPPORTED_UPLOAD_EXTENSIONS = new Set(["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "webm"]);
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

const ACCENT_PRESETS = [
  { id: "rose", label: "Rose", color: "#f1a0ba" },
  { id: "ocean", label: "Ocean", color: "#87d7ee" },
  { id: "violet", label: "Violet", color: "#c5a9ff" },
  { id: "amber", label: "Amber", color: "#f4c27a" },
  { id: "mint", label: "Mint", color: "#8fe0bf" },
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

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return minutes + ":" + seconds;
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

function Cover({ track, large = false }) {
  return (
    <div className={"cover" + (large ? " cover-large" : "")}>
      <img
        src={track?.artworkUrl || "/icon.svg"}
        alt=""
        loading="lazy"
        onError={(event) => {
          if (event.currentTarget.dataset.fallback !== "1") {
            event.currentTarget.dataset.fallback = "1";
            event.currentTarget.src = "/icon.svg";
          }
        }}
      />
      <span className="cover-glow" />
    </div>
  );
}

const TrackRow = React.memo(function TrackRow({ track, index, active, playing, favorite, onPlay, onFavorite, onDelete, deleting }) {
  return (
    <div className={"track-row" + (active ? " track-row-active" : "")}>
      <button className="track-index" aria-label={"Play " + track.title} onClick={() => onPlay(track)}>
        {active && playing ? <AudioLines size={17} /> : <><span className="row-number">{index + 1}</span><Play className="row-play" size={16} fill="currentColor" /></>}
      </button>
      <button className="track-art" onClick={() => onPlay(track)} aria-label={"Play " + track.title}>
        <Cover track={track} />
      </button>
      <button className="track-identity" onClick={() => onPlay(track)}>
        <span className="track-title">{track.title}</span>
        <span className="track-subtitle">{track.artist}</span>
      </button>
      <span className="track-album">{track.album}</span>
      <button
        className={"icon-button track-heart" + (favorite ? " is-favorite" : "")}
        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
        title={favorite ? "Remove from favorites" : "Add to favorites"}
        onClick={() => onFavorite(track.id)}
      >
        <Heart size={17} fill={favorite ? "currentColor" : "none"} />
      </button>
      <button
        className="icon-button track-delete"
        type="button"
        disabled={deleting}
        aria-label={"Delete " + track.title + " from the server"}
        title="Permanently delete this audio file from the server"
        onClick={() => onDelete(track)}
      >
        {deleting ? <RefreshCw size={16} className="spin" /> : <Trash2 size={16} />}
      </button>
      <span className="track-duration">—:—</span>
    </div>
  );
});

function LoginScreen({ configured, checking, onLogin, error, serverUnavailable, appearance }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="login-shell" data-accent={appearance.accent} data-glass={appearance.glass} style={{ "--user-accent": appearance.accentColor, "--user-accent-strong": darkenAccent(appearance.accentColor) }}>
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
          <form className="login-form" onSubmit={(event) => { event.preventDefault(); onLogin(password); }}>
            <label htmlFor="server-password">Server password</label>
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
  const [loginError, setLoginError] = useState("");
  const [tracks, setTracks] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [deletingTrackId, setDeletingTrackId] = useState("");
  const [trackActionMessage, setTrackActionMessage] = useState("");
  const [trackActionError, setTrackActionError] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef(null);
  const [youtubeQuery, setYoutubeQuery] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeUrlError, setYoutubeUrlError] = useState("");
  const [youtubeResults, setYoutubeResults] = useState([]);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeError, setYoutubeError] = useState("");
  const [selectedYoutube, setSelectedYoutube] = useState(null);
  const [view, setView] = useState("home");
  const contentWrapRef = useRef(null);
  const [favorites, setFavorites] = useState(() => readLocalJson(FAVORITES_KEY, []));
  const [currentTrackId, setCurrentTrackId] = useState(() => localStorage.getItem(LAST_TRACK_KEY) || "");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const lastUiTimeRef = useRef(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState("off");
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
    };
  });
  const [networkAddresses, setNetworkAddresses] = useState({ local: [], tailscale: [] });
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState("");
  const [remoteWizardOpen, setRemoteWizardOpen] = useState(() => localStorage.getItem(REMOTE_WIZARD_KEY) !== "1");

  const currentTrack = tracks.find((track) => track.id === currentTrackId) || null;
  const playerTint = useMemo(() => {
    const hex = /^#[0-9a-f]{6}$/i.test(appearance.accentColor) ? appearance.accentColor : "#f1a0ba";
    return [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
      .map((channel) => Number.parseInt(channel, 16))
      .join(",");
  }, [appearance.accentColor]);

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
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
  }, [appearance]);

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
      if (body.truncated) setLoadError("Your library is very large; only the first 20,000 tracks are shown.");
      setAuthenticated(true);
    } catch (error) {
      setLoadError(error.message || "The music library could not be loaded.");
    } finally {
      setLoadingTracks(false);
    }
  }, []);

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
      .catch(() => {
        if (!active) return;
        setServerUnavailable(true);
        setChecking(false);
      });
    return () => { active = false; };
  }, [loadTracks]);

  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    if (currentTrackId) localStorage.setItem(LAST_TRACK_KEY, currentTrackId);
  }, [currentTrackId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = muted ? 0 : volume;
  }, [volume, muted]);

  const handleLogin = useCallback(async (password) => {
    setLoginError("");
    setServerUnavailable(false);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ password }),
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
      setIsPlaying(false);
      setAuthenticated(false);
      setTracks([]);
      setView("home");
    }
  }, []);

  const playTrack = useCallback((track) => {
    if (!track || !audioRef.current) return;
    setSelectedYoutube(null);
    const audio = audioRef.current;
    if (audio.getAttribute("src") !== track.streamUrl) {
      // Assigning src already starts resource selection; load() here can restart it.
      audio.src = track.streamUrl;
    }
    lastUiTimeRef.current = 0;
    setCurrentTrackId(track.id);
    setCurrentTime(0);
    setDuration(0);
    audio.play().catch(() => setIsPlaying(false));
  }, []);

  const playNext = useCallback(() => {
    if (!tracks.length) return;
    const index = tracks.findIndex((track) => track.id === currentTrackId);
    if (shuffle && tracks.length > 1) {
      let nextIndex = index;
      while (nextIndex === index) nextIndex = Math.floor(Math.random() * tracks.length);
      playTrack(tracks[nextIndex]);
      return;
    }
    const nextIndex = index < 0 ? 0 : index + 1;
    if (nextIndex >= tracks.length) {
      if (repeatMode === "all") playTrack(tracks[0]);
      else {
        audioRef.current?.pause();
        setIsPlaying(false);
      }
      return;
    }
    playTrack(tracks[nextIndex]);
  }, [tracks, currentTrackId, shuffle, repeatMode, playTrack]);

  const playPrevious = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const index = tracks.findIndex((track) => track.id === currentTrackId);
    const previousIndex = index <= 0 ? (repeatMode === "all" ? tracks.length - 1 : 0) : index - 1;
    if (tracks[previousIndex]) playTrack(tracks[previousIndex]);
  }, [tracks, currentTrackId, repeatMode, playTrack]);

  const playPreviousTrack = useCallback(() => {
    if (!tracks.length) return;
    const index = tracks.findIndex((track) => track.id === currentTrackId);
    const previousIndex = index <= 0 ? (repeatMode === "all" ? tracks.length - 1 : 0) : index - 1;
    if (tracks[previousIndex]) playTrack(tracks[previousIndex]);
  }, [tracks, currentTrackId, repeatMode, playTrack]);

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
      const response = await fetch("/api/youtube/search?q=" + encodeURIComponent(search));
      if (!response.ok) throw new Error(await readMessage(response));
      const body = await response.json();
      setYoutubeResults(Array.isArray(body.items) ? body.items : []);
      if (!body.items?.length) setYoutubeError("No embeddable videos found. Try another search.");
    } catch (error) {
      setYoutubeResults([]);
      setYoutubeError(error.message || "YouTube search could not be completed.");
    } finally {
      setYoutubeLoading(false);
    }
  }, [youtubeQuery]);

  const selectYoutubeVideo = useCallback((item) => {
    // Keep YouTube playback inside its visible, official video player.
    // The local audio player is paused so the two sources do not overlap.
    audioRef.current?.pause();
    setIsPlaying(false);
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
    const normalized = query.trim().toLowerCase();
    if (normalized) {
      list = list.filter((track) =>
        (track.title + " " + track.artist + " " + track.album).toLowerCase().includes(normalized),
      );
    }
    return list;
  }, [tracks, view, favorites, query]);

  const toggleFavorite = useCallback((id) => {
    setFavorites((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }, []);

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

  const downloadFromYoutube = useCallback(async () => {
    const url = audioUrl.trim();
    if (!url || importingUrl) return;
    if (!parseYoutubeVideoId(url)) {
      setUrlImportError(true);
      setUrlImportMessage("That is not a valid YouTube video link.");
      return;
    }
    setImportingUrl(true);
    setUrlImportMessage("");
    setUrlImportError(false);
    try {
      const response = await fetch("/api/youtube/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) setAuthenticated(false);
        throw new Error(payload.message || "Could not download from YouTube.");
      }
      setUrlImportMessage("Saved " + payload.name + (payload.artwork ? " with cover" : "") + " to music/Uploads (" + formatBytes(payload.bytes) + ").");
      setUrlImportError(false);
      setAudioUrl("");
      await loadTracks();
    } catch (error) {
      setUrlImportError(true);
      setUrlImportMessage(error.message || "YouTube download failed. Check the link and try again.");
    } finally {
      setImportingUrl(false);
    }
  }, [audioUrl, importingUrl, loadTracks]);

  const copyText = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, []);

  if (!authenticated) {
    return (
      <LoginScreen
        configured={configured}
        checking={checking}
        onLogin={handleLogin}
        error={loginError}
        serverUnavailable={serverUnavailable}
        appearance={appearance}
      />
    );
  }

  const pageTitle = view === "home" ? "Listen now" : view === "library" ? "Your library" : view === "favorites" ? "Liked tracks" : view === "youtube" ? "Explore YouTube" : view === "import" ? "Import music" : "Server settings";

  return (
    <div className="app-shell" data-accent={appearance.accent} data-glass={appearance.glass} style={{ "--user-accent": appearance.accentColor, "--user-accent-strong": darkenAccent(appearance.accentColor) }}>
      <aside className={"sidebar" + (mobileMenuOpen ? " sidebar-open" : "")}>
        <div className="brand">
          <span className="brand-mark"><AudioLines size={22} strokeWidth={2.2} /></span>
          <span>self<span className="brand-light">music</span></span>
          <button className="icon-button mobile-close" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-label">YOUR SPACE</p>
          <nav className="side-nav" aria-label="Main navigation">
            <button className={view === "home" ? "nav-item nav-active" : "nav-item"} onClick={() => { setView("home"); setMobileMenuOpen(false); }}>
              <SectionGlyph kind="home" size={19} /> <span>Home</span>
            </button>
            <button className={view === "library" ? "nav-item nav-active" : "nav-item"} onClick={() => { setView("library"); setMobileMenuOpen(false); }}>
              <SectionGlyph kind="library" size={19} /> <span>Library</span><span className="nav-count">{tracks.length}</span>
            </button>
            <button className={view === "import" ? "nav-item nav-active" : "nav-item"} onClick={() => { setView("import"); setMobileMenuOpen(false); }}>
              <SectionGlyph kind="import" size={19} /> <span>Import music</span>
            </button>
            <button className={view === "favorites" ? "nav-item nav-active" : "nav-item"} onClick={() => { setView("favorites"); setMobileMenuOpen(false); }}>
              <SectionGlyph kind="liked" size={19} /> <span>Liked tracks</span>
            </button>
            <button className={view === "youtube" ? "nav-item nav-active" : "nav-item"} onClick={() => { setView("youtube"); setMobileMenuOpen(false); }}>
              <SectionGlyph kind="youtube" size={19} /> <span>Explore YouTube</span>
            </button>
          </nav>
        </div>

        <div className="sidebar-library">
          <div className="library-heading"><span>Your collection</span><span className="live-dot" /></div>
          <button className="collection-card" onClick={() => setView("library")}>
            <div className="collection-art"><SectionGlyph kind="library" size={29} /></div>
            <span><strong>Home library</strong><small>{tracks.length} {tracks.length === 1 ? "track" : "tracks"}</small></span>
          </button>
          {!tracks.length && <p className="sidebar-hint">Add audio files to your server's music folder to begin.</p>}
        </div>

        <div className="sidebar-bottom">
          <div className="connection-status"><span className="status-pip" /><span>Home server connected</span></div>
          <button className={view === "settings" ? "nav-item nav-active" : "nav-item"} onClick={() => { setView("settings"); setMobileMenuOpen(false); }}>
            <SectionGlyph kind="server" size={19} /><span>Server settings</span>
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
              <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your music" aria-label="Search music" />
              {query && <button className="search-clear" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}
              <kbd>⌘ K</kbd>
            </label>
            <div className="avatar-pill"><span className="avatar-glyph">S</span><span>My server</span></div>
          </div>
        </header>

        <div className="content-wrap" ref={contentWrapRef}>
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
                    <button className="ghost-button" onClick={() => setView("settings")}><Server size={16} /> Server details</button>
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
                  emptyTitle={query ? "No matches found" : "Your first track is waiting"}
                  emptyCopy={query ? "Try another title, artist, or album name." : "Put your own music files in the server's music folder, then refresh the library."}
                  onSettings={() => setView("settings")}
                />
              </section>
            </>
          )}

          {(view === "library" || view === "favorites") && (
            <section className="page-section">
              <div className="page-intro">
                <div className="intro-icon"><SectionGlyph kind={view === "favorites" ? "liked" : "library"} size={29} /></div>
                <p className="eyebrow">{view === "favorites" ? "THE ONES YOU KEEP" : "ALL YOUR AUDIO IN ONE PLACE"}</p>
                <h1>{view === "favorites" ? "Liked tracks" : "Your library"}</h1>
                <p>{view === "favorites" ? "Your personal shortlist, saved on this device." : "Music stored on your home server, ready when you are."}</p>
                <div className="intro-meta"><span><Disc3 size={14} /> {filteredTracks.length} tracks</span><span className="meta-separator" /><span><ShieldCheck size={14} /> Private library</span></div>
              </div>
              <div className="library-toolbar">
                <button className="primary-button" onClick={() => filteredTracks.length && playTrack(filteredTracks[0])} disabled={!filteredTracks.length}><Play size={16} fill="currentColor" /> Play all</button>
                <button className="ghost-button" onClick={loadTracks}><RefreshCw size={15} className={loadingTracks ? "spin" : ""} /> Refresh</button>
              </div>
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
              />
            </section>
          )}

          {view === "youtube" && (
            <section className="page-section youtube-page">
              <div className="youtube-hero glass-mist-panel">
                <div className="youtube-fog youtube-fog-one" />
                <div className="youtube-fog youtube-fog-two" />
                <div className="youtube-hero-content">
                  <div className="youtube-kicker"><Youtube size={15} /> VIDEO DISCOVERY <span /> OFFICIAL PLAYER</div>
                  <h1>Find your next<br /><span>favorite sound.</span></h1>
                  <p>Search YouTube videos from your own home server and play them in the official YouTube player.</p>
                  <form className="youtube-search-form" onSubmit={(event) => { event.preventDefault(); handleYoutubeSearch(); }}>
                    <label className="youtube-search-field">
                      <Search size={18} />
                      <input
                        value={youtubeQuery}
                        onChange={(event) => setYoutubeQuery(event.target.value)}
                        placeholder="Search artists, tracks, live sessions…"
                        aria-label="Search YouTube videos"
                        minLength={2}
                        maxLength={100}
                      />
                    </label>
                    <button className="primary-button" type="submit" disabled={youtubeLoading || youtubeQuery.trim().length < 2}>
                      {youtubeLoading ? <RefreshCw className="spin" size={16} /> : <Search size={16} />}
                      {youtubeLoading ? "Searching" : "Search YouTube"}
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
                    <div className="youtube-url-caption"><span>ALREADY HAVE A LINK?</span><span>OPEN IN OFFICIAL PLAYER</span></div>
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
                        <Play size={14} fill="currentColor" /> Open video
                      </button>
                    </div>
                    {youtubeUrlError && <p className="youtube-url-error" role="alert">{youtubeUrlError}</p>}
                  </form>
                  <div className="youtube-privacy-line"><ShieldCheck size={14} /> The API key stays on your server. Search results are not saved.</div>
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
                      <div><strong>{youtubeError}</strong><span>To enable search, add a YouTube Data API v3 key as YOUTUBE_API_KEY in the server's .env file, then restart SelfMusic.</span></div>
                    </div>
                  )}
                  {youtubeLoading && <div className="youtube-empty"><RefreshCw className="spin" size={23} /><strong>Looking through YouTube</strong><span>Searching embeddable videos…</span></div>}
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
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="youtube-attribution"><Youtube size={14} /><span>Video results by YouTube</span><span className="attribution-dot" /><span>Playback provided by YouTube</span></div>
                </div>

                <aside className="youtube-player-panel glass-mist-panel">
                  <div className="youtube-panel-heading"><div><p className="eyebrow">NOW IN DISCOVERY</p><h2>Video player</h2></div><span className="youtube-live-label"><span /> READY</span></div>
                  {selectedYoutube ? (
                    <>
                      <div className="youtube-player-frame">
                        <iframe
                          key={selectedYoutube.videoId}
                          src={"https://www.youtube.com/embed/" + selectedYoutube.videoId + "?autoplay=1&playsinline=1"}
                          title={selectedYoutube.title}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          referrerPolicy="strict-origin-when-cross-origin"
                          allowFullScreen
                        />
                      </div>
                      <div className="youtube-selected-meta"><strong>{selectedYoutube.title}</strong><span>{selectedYoutube.channelTitle}</span></div>
                      <a className="youtube-watch-link" href={"https://www.youtube.com/watch?v=" + selectedYoutube.videoId} target="_blank" rel="noreferrer"><Youtube size={15} /> Watch on YouTube <ArrowUpRight size={15} /></a>
                    </>
                  ) : (
                    <div className="youtube-player-empty"><div className="youtube-player-art"><Youtube size={35} /></div><strong>Pick a video to play</strong><span>Your selection appears here inside the official YouTube player.</span></div>
                  )}
                  <div className="youtube-local-note"><Headphones size={16} /><span>For lock-screen and background listening, use audio files in your home library. YouTube playback stays in the visible video player.</span></div>
                </aside>
              </div>
            </section>
          )}

          {view === "import" && (
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

          {view === "settings" && (
            <section className="page-section settings-page">
              <div className="page-intro">
                <div className="intro-icon"><SectionGlyph kind="server" size={29} /></div>
                <p className="eyebrow">YOUR HOME INFRASTRUCTURE</p>
                <h1>Server settings</h1>
                <p>Keep the library private, and make it reachable when you leave home.</p>
              </div>

              <div className="settings-status-card">
                <div className="settings-status-icon"><span className="status-pip" /></div>
                <div className="settings-status-copy"><span className="settings-overline">SERVER STATUS</span><h3>Connected to your home server</h3><p>The player uses a secure session cookie for library and audio requests.</p></div>
                <span className="status-badge"><span /> Online</span>
              </div>

              <div className="settings-grid">
                <div className="settings-card">
                  <div className="settings-card-head"><span className="settings-icon"><FolderOpen size={19} /></span><span className="settings-overline">MUSIC COLLECTION</span></div>
                  <h3>Where your files live</h3>
                  <p>Put supported audio files into the folder configured by <code>MUSIC_DIR</code>. By default, that is <code>./music</code> in the project directory.</p>
                  <div className="format-list"><span>MP3</span><span>FLAC</span><span>M4A</span><span>AAC</span><span>WAV</span><span>OGG</span><span>OPUS</span></div>
                  <button className="settings-action" onClick={loadTracks}><RefreshCw size={15} className={loadingTracks ? "spin" : ""} /> Scan library <span>{tracks.length} tracks</span></button>
                </div>

                <div className="settings-card">
                  <div className="settings-card-head"><span className="settings-icon settings-icon-blue"><Globe2 size={19} /></span><span className="settings-overline">REMOTE ACCESS</span></div>
                  <h3>Listen outside your Wi-Fi</h3>
                  <p>Set up Tailscale on this computer and your phone. No router port forwarding and no shared auth key are needed for the normal native setup.</p>
                  <button className="settings-action" type="button" onClick={() => setRemoteWizardOpen(true)}><Smartphone size={15} /> Open setup wizard <ArrowUpRight size={15} /></button>
                  {networkAddresses.tailscale.length > 0 && <div className="info-note"><ShieldCheck size={16} /><span>Tailscale detected: {networkAddresses.tailscale[0]}</span></div>}
                </div>

                <div className="settings-card settings-card-wide appearance-settings-card">
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
                  <button className="text-button appearance-reset" type="button" onClick={() => setAppearance({ accent: "rose", accentColor: ACCENT_PRESETS[0].color, ...hexToHsv(ACCENT_PRESETS[0].color), glass: "liquid" })}>Reset appearance</button>
                </div>

                <div className="settings-card settings-card-wide">
                  <div className="settings-card-head"><span className="settings-icon"><LockKeyhole size={19} /></span><span className="settings-overline">SECURITY CHECKLIST</span></div>
                  <h3>Before you use it remotely</h3>
                  <div className="security-checklist">
                    <div><Check size={16} /><span>Set a unique password with at least 8 characters.</span></div>
                    <div><Check size={16} /><span>Set <code>SESSION_SECRET</code> in your local <code>.env</code> file.</span></div>
                    <div><Check size={16} /><span>Use HTTPS with a private access policy and never commit <code>.env</code>.</span></div>
                    <div><Check size={16} /><span>Keep the operating system and Node.js updated.</span></div>
                  </div>
                  <button className="settings-action" onClick={() => copyText("node -e \"console.log(require('node:crypto').randomBytes(32).toString('hex'))\"")}><Copy size={15} /> {copied ? "Copied" : "Copy secret-generation command"} {copied && <Check size={15} />}</button>
                  <p className="settings-footnote">Create and edit <code>.env</code> directly in the project folder with your preferred editor. Keep it private and never commit it to GitHub.</p>
                </div>
              </div>

              <div className="settings-footer"><span><ShieldCheck size={15} /> Self-hosted means you control the machine and its uptime.</span><button className="text-button" onClick={handleLogout}>Sign out <LogOut size={14} /></button></div>
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

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <button className={view === "home" ? "mobile-nav-item nav-active" : "mobile-nav-item"} onClick={() => setView("home")}><SectionGlyph kind="home" size={21} /><span>Home</span></button>
        <button className={view === "library" ? "mobile-nav-item nav-active" : "mobile-nav-item"} onClick={() => setView("library")}><SectionGlyph kind="library" size={21} /><span>Library</span></button>
        <button className={view === "import" ? "mobile-nav-item nav-active" : "mobile-nav-item"} onClick={() => setView("import")}><SectionGlyph kind="import" size={21} /><span>Import</span></button>
        <button className={view === "youtube" ? "mobile-nav-item nav-active" : "mobile-nav-item"} onClick={() => setView("youtube")}><SectionGlyph kind="youtube" size={21} /><span>YouTube</span></button>
        <button className={view === "settings" ? "mobile-nav-item nav-active" : "mobile-nav-item"} onClick={() => setView("settings")}><SectionGlyph kind="server" size={21} /><span>Server</span></button>
      </nav>

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
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(event) => {
          const nextTime = event.currentTarget.currentTime;
          const updateInterval = window.innerWidth <= 720 ? 0.6 : 0.25;
          if (nextTime < lastUiTimeRef.current || nextTime - lastUiTimeRef.current >= updateInterval) {
            lastUiTimeRef.current = nextTime;
            setCurrentTime(nextTime);
          }
        }}
        onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)
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

function TrackList({
  tracks,
  loading,
  error,
  currentTrackId,
  isPlaying,
  favorites,
  onPlay,
  onFavorite,
  onDelete,
  deletingTrackId,
  trackActionMessage,
  trackActionError,
  onRefresh,
  emptyTitle,
  emptyCopy,
  onSettings,
}) {
  if (loading && !tracks.length) {
    return <div className="empty-state"><RefreshCw size={23} className="spin" /><h3>Finding your music</h3><p>Scanning the library on your home server.</p></div>;
  }
  if (error && !tracks.length) {
    return <div className="empty-state empty-state-error"><CircleAlert size={24} /><h3>We couldn't load your library</h3><p>{error}</p><button className="ghost-button" onClick={onRefresh}><RefreshCw size={15} /> Try again</button></div>;
  }
  if (!tracks.length) {
    return <div className="empty-state">
      <div className="empty-disc"><Disc3 size={28} /></div>
      <h3>{emptyTitle}</h3><p>{emptyCopy}</p>
      <button className="ghost-button" onClick={onSettings}><FolderOpen size={15} /> Open server setup</button>
    </div>;
  }

  return (
    <>
    {trackActionMessage && (
      <div className={"track-action-feedback" + (trackActionError ? " track-action-feedback-error" : "")} role={trackActionError ? "alert" : "status"}>
        {trackActionError ? <CircleAlert size={16} /> : <Check size={16} />}
        <span>{trackActionMessage}</span>
      </div>
    )}
    <div className="track-table">
      <div className="track-table-head"><span>#</span><span>TITLE</span><span>ALBUM / FOLDER</span><span><Heart size={14} /></span><span aria-label="Delete track"><Trash2 size={13} /></span><span>TIME</span></div>
      {tracks.map((track, index) => (
        <TrackRow
          key={track.id}
          track={track}
          index={index}
          active={track.id === currentTrackId}
          playing={isPlaying}
          favorite={favorites.includes(track.id)}
          onPlay={onPlay}
          onFavorite={onFavorite}
          onDelete={onDelete}
          deleting={deletingTrackId === track.id}
        />
      ))}
    </div>
    </>
  );
}

function PlayerBar({
  audioRef,
  trackTint,
  track,
  isPlaying,
  currentTime,
  duration,
  volume,
  muted,
  shuffle,
  repeatMode,
  onToggle,
  onPrevious,
  onSwitchPrevious,
  onNext,
  onSeek,
  onVolume,
  onMute,
  onShuffle,
  onRepeat,
  onFavorite,
  isFavorite,
}) {
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const [expanded, setExpanded] = useState(false);
  const touchStartRef = useRef(null);

  useEffect(() => {
    if (!expanded) return undefined;
    const handleExpandedKeys = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setExpanded(false);
      } else if (event.key === "ArrowLeft" && !["INPUT", "TEXTAREA"].includes(event.target?.tagName)) {
        event.preventDefault();
        onSwitchPrevious();
      } else if (event.key === "ArrowRight" && !["INPUT", "TEXTAREA"].includes(event.target?.tagName)) {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", handleExpandedKeys);
    return () => window.removeEventListener("keydown", handleExpandedKeys);
  }, [expanded, onSwitchPrevious, onNext]);

  const handleExpandedTouchStart = (event) => {
    if (event.target.closest("button, input, a")) return;
    const touch = event.changedTouches?.[0];
    if (touch) touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleExpandedTouchEnd = (event) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || event.target.closest("button, input, a")) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    if (dx < 0) onNext();
    else onSwitchPrevious();
  };

  return (
    <>
      <footer className={"playerbar" + (!track ? " playerbar-idle" : "")}>
        <div className="now-playing">
          <div className="player-cover">{track ? <Cover track={track} /> : <div className="empty-cover"><AudioLines size={20} /></div>}</div>
          <div className="now-playing-meta">
            <strong>{track?.title || "Pick a track"}</strong>
            <span>{track?.artist || "Your music is right here"}</span>
          </div>
          <button className={"icon-button player-like" + (isFavorite ? " is-favorite" : "")} onClick={onFavorite} disabled={!track} aria-label="Like current track"><Heart size={17} fill={isFavorite ? "currentColor" : "none"} /></button>
        </div>

        <div className="player-center">
          <div className="player-controls">
            <button className={"player-control secondary-control" + (shuffle ? " control-on" : "")} onClick={onShuffle} title="Shuffle" aria-label="Toggle shuffle"><Shuffle size={17} /></button>
            <button className="player-control" onClick={onPrevious} disabled={!track} title="Previous track" aria-label="Previous track"><SkipBack size={19} fill="currentColor" /></button>
            <button className="main-play" onClick={onToggle} disabled={!track} title={isPlaying ? "Pause" : "Play"} aria-label={isPlaying ? "Pause" : "Play"}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
            <button className="player-control" onClick={onNext} disabled={!track} title="Next track" aria-label="Next track"><SkipForward size={19} fill="currentColor" /></button>
            <button className={"player-control secondary-control" + (repeatMode !== "off" ? " control-on" : "")} onClick={onRepeat} title={"Repeat " + repeatMode} aria-label="Change repeat mode"><Repeat2 size={17} /><span className="repeat-mode-dot">{repeatMode === "one" ? "1" : ""}</span></button>
          </div>
          <div className="timeline">
            <span>{formatTime(currentTime)}</span>
            <input
              aria-label="Track progress"
              className="range-input progress-range"
              type="range"
              min="0"
              max={duration || 1}
              step="0.1"
              value={Math.min(currentTime, duration || 1)}
              style={{ "--range-progress": progress + "%" }}
              onChange={(event) => onSeek(Number(event.target.value))}
              disabled={!track || !duration}
            />
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="player-extras">
          <button className="player-control volume-icon" onClick={onMute} aria-label={muted ? "Unmute" : "Mute"}>{muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
          <input
            aria-label="Volume"
            className="range-input volume-range"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={muted ? 0 : volume}
            style={{ "--range-progress": ((muted ? 0 : volume) * 100) + "%" }}
            onChange={(event) => onVolume(Number(event.target.value))}
          />
          <button className="player-control mobile-expand" onClick={() => setExpanded((value) => !value)} disabled={!track} aria-label={expanded ? "Close mobile player controls" : "Open full-screen player"}>{expanded ? <X size={18} /> : <AudioLines size={18} />}</button>
        </div>
      </footer>
      <div className={"mobile-player-expanded" + (expanded ? " mobile-player-expanded-open" : "")} style={{ "--track-rgb": trackTint }} onTouchStart={handleExpandedTouchStart} onTouchEnd={handleExpandedTouchEnd}>
        <div className="expanded-topbar">
          <span className="expanded-now-playing">NOW PLAYING</span>
          <button className="icon-button expanded-close" type="button" onClick={() => setExpanded(false)} aria-label="Close full-screen player"><X size={22} /></button>
        </div>
        <div className="expanded-cover">{track && <Cover track={track} large />}</div>
        <div className="expanded-meta"><strong>{track?.title || "Pick a track"}</strong><span>{track?.artist || "Your music is right here"}</span></div>
        <div className="expanded-progress"><span>{formatTime(currentTime)}</span><input className="range-input progress-range" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(currentTime, duration || 1)} style={{ "--range-progress": progress + "%" }} onChange={(event) => onSeek(Number(event.target.value))} disabled={!track || !duration} /><span>{formatTime(duration)}</span></div>
        <div className="expanded-controls">
          <button className={"player-control" + (shuffle ? " control-on" : "")} onClick={onShuffle} aria-label="Toggle shuffle"><Shuffle size={19} /></button>
          <button className="player-control" onClick={onPrevious} disabled={!track} aria-label="Previous track"><SkipBack size={23} fill="currentColor" /></button>
          <button className="main-play expanded-main-play" onClick={onToggle} disabled={!track} aria-label={isPlaying ? "Pause" : "Play"}>{isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
          <button className="player-control" onClick={onNext} disabled={!track} aria-label="Next track"><SkipForward size={23} fill="currentColor" /></button>
          <button className={"player-control" + (repeatMode !== "off" ? " control-on" : "")} onClick={onRepeat} aria-label="Change repeat mode"><Repeat2 size={19} /></button>
        </div>
        <div className="expanded-bottom"><button className={isFavorite ? "text-button is-favorite" : "text-button"} onClick={onFavorite}><Heart size={16} fill={isFavorite ? "currentColor" : "none"} /> {isFavorite ? "Liked" : "Like track"}</button><button className="text-button" onClick={onMute}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />} {muted ? "Unmute" : "Mute"}</button></div>
      </div>
    </>
  );
}

export default App;
