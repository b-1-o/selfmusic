import React, { useEffect, useRef, useState } from "react";
import { AudioLines, Heart, Pause, Play, Repeat2, Shuffle, SkipBack, SkipForward, Volume2, VolumeX, X } from "lucide-react";
import Cover from "../Shared/Cover.jsx";
import formatTime from "../../utils/formatTime.js";

export default function PlayerBar({
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