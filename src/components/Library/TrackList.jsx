import React from "react";
import { AudioLines, Check, CircleAlert, Disc3, Download, FolderOpen, Heart, Play, RefreshCw, Trash2 } from "lucide-react";
import Cover from "../Shared/Cover.jsx";

const TrackRow = React.memo(function TrackRow({ track, index, active, playing, favorite, onPlay, onFavorite, onDelete, deleting, canManage = true, currentTime = 0, duration = 0, offlineSaved = false, offlineBusy = false, onOffline }) {
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
        <span className={"track-progress-inline" + (active ? " track-progress-inline-active" : "")} aria-label={active && duration > 0 ? "Playback progress " + Math.round((currentTime / duration) * 100) + "%" : undefined}>
          <span style={{ width: active && duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) + "%" : "0%" }} />
        </span>
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
        className={"icon-button track-offline" + (offlineSaved ? " is-offline" : "")}
        type="button"
        disabled={offlineBusy}
        aria-label={offlineSaved ? "Remove offline copy of " + track.title : "Save " + track.title + " for offline playback"}
        title={offlineSaved ? "Saved offline — click to remove" : "Save for offline playback"}
        onClick={() => onOffline(track)}
      >
        {offlineBusy ? <RefreshCw size={15} className="spin" /> : offlineSaved ? <Check size={16} /> : <Download size={15} />}
      </button>
      {canManage ? (
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
      ) : <span className="track-delete-placeholder" aria-hidden="true" />}
      <span className="track-duration">—:—</span>
    </div>
  );
});

export default function TrackList({
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
  onServerSetup,
  canManage = true,
  currentTime = 0,
  duration = 0,
  offlineTrackIds = [],
  offlineBusyIds = [],
  onOffline,
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
      {onServerSetup && <button className="ghost-button" onClick={onServerSetup}><FolderOpen size={15} /> Open server setup</button>}
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
      <div className="track-table-head"><span>#</span><span>TITLE</span><span>ALBUM / FOLDER</span><span><Heart size={14} /></span><span aria-label="Offline copy"><Download size={13} /></span><span aria-label="Delete track"><Trash2 size={13} /></span><span>TIME</span></div>
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
          canManage={canManage}
          currentTime={currentTime}
          duration={duration}
          offlineSaved={offlineTrackIds.includes(track.id)}
          offlineBusy={offlineBusyIds.includes(track.id)}
          onOffline={onOffline}
        />
      ))}
    </div>
    </>
  );
}

