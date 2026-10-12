import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  ArrowUpRight,
  Check,
  CircleAlert,
  Cloud,
  Copy,
  Disc3,
  FolderOpen,
  Globe2,
  Headphones,
  Heart,
  Home,
  Library,
  ListMusic,
  LockKeyhole,
  LogOut,
  Pause,
  Play,
  RefreshCw,
  Repeat2,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
  Youtube,
} from "lucide-react";

const FAVORITES_KEY = "selfmusic:favorites:v1";
const LAST_TRACK_KEY = "selfmusic:last-track:v1";

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

function TrackRow({ track, index, active, playing, favorite, onPlay, onFavorite }) {
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
      <span className="track-duration">—:—</span>
    </div>
  );
}

function LoginScreen({ configured, checking, onLogin, error, serverUnavailable }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="login-shell">
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
            <p>SelfMusic runs on your computer. Create a <strong>.env</strong> file from <strong>.env.example</strong>, set a password with at least 12 characters, then restart the server.</p>
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
  const [query, setQuery] = useState("");
  const searchInputRef = useRef(null);
  const [youtubeQuery, setYoutubeQuery] = useState("");
  const [youtubeResults, setYoutubeResults] = useState([]);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeError, setYoutubeError] = useState("");
  const [selectedYoutube, setSelectedYoutube] = useState(null);
  const [view, setView] = useState("home");
  const [favorites, setFavorites] = useState(() => readLocalJson(FAVORITES_KEY, []));
  const [currentTrackId, setCurrentTrackId] = useState(() => localStorage.getItem(LAST_TRACK_KEY) || "");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState("off");
  const [copied, setCopied] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const currentTrack = tracks.find((track) => track.id === currentTrackId) || null;

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
    fetch("/api/auth/session")
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
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setLoginError(await readMessage(response));
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
      audio.src = track.streamUrl;
      audio.load();
    }
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
            { src: currentTrack.artworkUrl, sizes: "512x512" },
            { src: "/icon.svg", sizes: "any" },
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
      />
    );
  }

  const pageTitle = view === "home" ? "Listen now" : view === "library" ? "Your library" : view === "favorites" ? "Liked tracks" : view === "youtube" ? "Explore YouTube" : "Server settings";

  return (
    <div className="app-shell">
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
              <Home size={18} /> <span>Home</span>
            </button>
            <button className={view === "library" ? "nav-item nav-active" : "nav-item"} onClick={() => { setView("library"); setMobileMenuOpen(false); }}>
              <Library size={18} /> <span>Library</span><span className="nav-count">{tracks.length}</span>
            </button>
            <button className={view === "favorites" ? "nav-item nav-active" : "nav-item"} onClick={() => { setView("favorites"); setMobileMenuOpen(false); }}>
              <Heart size={18} /> <span>Liked tracks</span>
            </button>
            <button className={view === "youtube" ? "nav-item nav-active" : "nav-item"} onClick={() => { setView("youtube"); setMobileMenuOpen(false); }}>
              <Youtube size={18} /> <span>Explore YouTube</span>
            </button>
          </nav>
        </div>

        <div className="sidebar-library">
          <div className="library-heading"><span>Your collection</span><span className="live-dot" /></div>
          <button className="collection-card" onClick={() => setView("library")}>
            <div className="collection-art"><Disc3 size={24} /></div>
            <span><strong>Home library</strong><small>{tracks.length} {tracks.length === 1 ? "track" : "tracks"}</small></span>
          </button>
          {!tracks.length && <p className="sidebar-hint">Add audio files to your server's music folder to begin.</p>}
        </div>

        <div className="sidebar-bottom">
          <div className="connection-status"><span className="status-pip" /><span>Home server connected</span></div>
          <button className={view === "settings" ? "nav-item nav-active" : "nav-item"} onClick={() => { setView("settings"); setMobileMenuOpen(false); }}>
            <Settings size={18} /><span>Server settings</span>
          </button>
          <button className="nav-item logout-item" onClick={handleLogout}><LogOut size={18} /><span>Sign out</span></button>
          <div className="sidebar-version">SELFMUSIC <span>v0.1.0</span></div>
        </div>
      </aside>

      {mobileMenuOpen && <button className="sidebar-scrim" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation" />}

      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu"><Library size={20} /></button>
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

        <div className="content-wrap">
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
                <div className="stat-card"><span className="stat-icon"><Library size={18} /></span><div><strong>{tracks.length.toLocaleString()}</strong><span>Tracks in library</span></div></div>
                <div className="stat-card"><span className="stat-icon stat-icon-warm"><Heart size={18} /></span><div><strong>{favorites.length.toLocaleString()}</strong><span>Liked tracks</span></div></div>
                <div className="stat-card"><span className="stat-icon stat-icon-cool"><Cloud size={18} /></span><div><strong>Personal</strong><span>Your server, your rules</span></div></div>
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
                <div className="intro-icon">{view === "favorites" ? <Heart size={22} /> : <Library size={22} />}</div>
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

          {view === "settings" && (
            <section className="page-section settings-page">
              <div className="page-intro">
                <div className="intro-icon"><Server size={22} /></div>
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
                  <p>Use an HTTPS tunnel and add an access policy. Do not expose this server directly to the public internet or forward its port on your router.</p>
                  <a className="settings-action settings-link" href="https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/" target="_blank" rel="noreferrer">Cloudflare Tunnel guide <ArrowUpRight size={15} /></a>
                  <div className="info-note"><ShieldCheck size={16} /><span>The tunnel must stay running, and your home computer must stay on.</span></div>
                </div>

                <div className="settings-card settings-card-wide">
                  <div className="settings-card-head"><span className="settings-icon"><LockKeyhole size={19} /></span><span className="settings-overline">SECURITY CHECKLIST</span></div>
                  <h3>Before you use it remotely</h3>
                  <div className="security-checklist">
                    <div><Check size={16} /><span>Set a unique password with at least 12 characters.</span></div>
                    <div><Check size={16} /><span>Set <code>SESSION_SECRET</code> in your local <code>.env</code> file.</span></div>
                    <div><Check size={16} /><span>Use HTTPS with a private access policy and never commit <code>.env</code>.</span></div>
                    <div><Check size={16} /><span>Keep the operating system and Node.js updated.</span></div>
                  </div>
                  <button className="settings-action" onClick={() => copyText("cp .env.example .env")}><Copy size={15} /> {copied ? "Copied" : "Copy Linux/macOS setup command"} {copied && <Check size={15} />}</button>
                  <p className="settings-footnote">On Windows, duplicate <code>.env.example</code> as <code>.env</code> in File Explorer, then edit it in Notepad.</p>
                </div>
              </div>

              <div className="settings-footer"><span><ShieldCheck size={15} /> Self-hosted means you control the machine and its uptime.</span><button className="text-button" onClick={handleLogout}>Sign out <LogOut size={14} /></button></div>
            </section>
          )}
        </div>
      </main>

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <button className={view === "home" ? "mobile-nav-item nav-active" : "mobile-nav-item"} onClick={() => setView("home")}><Home size={19} /><span>Home</span></button>
        <button className={view === "library" ? "mobile-nav-item nav-active" : "mobile-nav-item"} onClick={() => setView("library")}><Library size={19} /><span>Library</span></button>
        <button className={view === "youtube" ? "mobile-nav-item nav-active" : "mobile-nav-item"} onClick={() => setView("youtube")}><Youtube size={19} /><span>YouTube</span></button>
        <button className={view === "settings" ? "mobile-nav-item nav-active" : "mobile-nav-item"} onClick={() => setView("settings")}><Settings size={19} /><span>Server</span></button>
      </nav>

      <PlayerBar
        audioRef={audioRef}
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
        onNext={playNext}
        onSeek={(value) => { if (audioRef.current) audioRef.current.currentTime = value; setCurrentTime(value); }}
        onVolume={(value) => { setVolume(value); setMuted(false); }}
        onMute={() => setMuted((value) => !value)}
        onShuffle={() => setShuffle((value) => !value)}
        onRepeat={() => setRepeatMode((mode) => mode === "off" ? "all" : mode === "all" ? "one" : "off")}
        onFavorite={() => currentTrack && toggleFavorite(currentTrack.id)}
        isFavorite={Boolean(currentTrack && favorites.includes(currentTrack.id))}
      />
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          setCurrentTime(audio.currentTime);
          if (Number.isFinite(audio.duration)) setDuration(audio.duration);
        }}
        onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
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
    <div className="track-table">
      <div className="track-table-head"><span>#</span><span>TITLE</span><span>ALBUM / FOLDER</span><span><Heart size={14} /></span><span>TIME</span></div>
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
        />
      ))}
    </div>
  );
}

function PlayerBar({
  audioRef,
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
          <button className="player-control mobile-expand" onClick={() => setExpanded((value) => !value)} aria-label="Show mobile player controls">{expanded ? <X size={18} /> : <AudioLines size={18} />}</button>
        </div>
      </footer>
      <div className={"mobile-player-expanded" + (expanded ? " mobile-player-expanded-open" : "")}>
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
