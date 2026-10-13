import React from "react";
import { Check, Filter, Search, X } from "lucide-react";

const EMPTY_FILTERS = { artist: "", album: "", year: "", genre: "", duration: "all", sort: "artist", offlineOnly: false };

export function FilterButton({ filters, open, onToggle }) {
  const count = (filters.artist ? 1 : 0) + (filters.album ? 1 : 0) + (filters.year ? 1 : 0)
    + (filters.genre ? 1 : 0) + (filters.duration !== "all" ? 1 : 0)
    + (filters.offlineOnly ? 1 : 0) + (filters.sort !== "artist" ? 1 : 0);
  return (
    <button
      className={"ghost-button filter-toggle" + (open ? " filter-toggle-open" : "")}
      type="button"
      aria-expanded={open}
      aria-controls="library-filter-panel"
      onClick={onToggle}
    >
      <Filter size={15} />
      Filters
      {count > 0 && <span className="filter-count">{count}</span>}
    </button>
  );
}

export default function FilterPanel({ tracks, filters, setFilters, open, onClose, query, setQuery }) {
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const reset = () => setFilters({ ...EMPTY_FILTERS });
  const chips = [
    { key: "artist", label: "Artist", value: filters.artist, clear: () => update("artist", "") },
    { key: "album", label: "Album", value: filters.album, clear: () => update("album", "") },
    { key: "year", label: "Year", value: filters.year, clear: () => update("year", "") },
    { key: "genre", label: "Genre", value: filters.genre, clear: () => update("genre", "") },
    { key: "duration", label: "Length", value: filters.duration === "all" ? "" : ({ short: "Under 3 min", medium: "3–5 min", long: "Over 5 min" }[filters.duration] || filters.duration), clear: () => update("duration", "all") },
    { key: "offlineOnly", label: "Offline", value: filters.offlineOnly ? "Saved on this device" : "", clear: () => update("offlineOnly", false) },
    { key: "sort", label: "Sort", value: filters.sort === "artist" ? "" : ({ title: "Title", album: "Album", year: "Newest year", duration: "Duration", recent: "Recently added" }[filters.sort] || filters.sort), clear: () => update("sort", "artist") },
    { key: "query", label: "Search", value: query, clear: () => setQuery("") },
  ].filter((chip) => Boolean(chip.value));

  return (
    <>
      <div id="library-filter-panel" className={"library-filter-drawer" + (open ? " library-filter-drawer-open" : "")} aria-hidden={!open}>
        <div className="library-filter-panel-head">
          <div><strong>Refine your library</strong><span>Search and narrow down your collection.</span></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close filters"><X size={17} /></button>
        </div>
        <div className="library-filter-row">
          <label className="filter-search-field">Search
            <span className="filter-search-control"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Track, artist, album…" aria-label="Search library" /></span>
          </label>
          <label>Artist<select value={filters.artist} onChange={(event) => update("artist", event.target.value)}><option value="">All artists</option>{Array.from(new Set(tracks.map((track) => track.artist).filter(Boolean))).sort().map((artist) => <option key={artist} value={artist}>{artist}</option>)}</select></label>
          <label>Album<select value={filters.album} onChange={(event) => update("album", event.target.value)}><option value="">All albums</option>{Array.from(new Set(tracks.filter((track) => !filters.artist || track.artist === filters.artist).map((track) => track.album).filter(Boolean))).sort().map((album) => <option key={album} value={album}>{album}</option>)}</select></label>
          <label>Year<select value={filters.year} onChange={(event) => update("year", event.target.value)}><option value="">All years</option>{Array.from(new Set(tracks.map((track) => track.year).filter(Boolean))).sort((a, b) => Number(b) - Number(a)).map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
          <label>Genre<select value={filters.genre} onChange={(event) => update("genre", event.target.value)}><option value="">All genres</option>{Array.from(new Set(tracks.map((track) => track.genre).filter(Boolean))).sort().map((genre) => <option key={genre} value={genre}>{genre}</option>)}</select></label>
          <label>Length<select value={filters.duration} onChange={(event) => update("duration", event.target.value)}><option value="all">Any length</option><option value="short">Under 3 min</option><option value="medium">3–5 min</option><option value="long">Over 5 min</option></select></label>
          <label>Offline copy<select value={filters.offlineOnly ? "saved" : "any"} onChange={(event) => update("offlineOnly", event.target.value === "saved")}><option value="any">Any track</option><option value="saved">Saved on this device</option></select></label>
          <label>Sort<select value={filters.sort} onChange={(event) => update("sort", event.target.value)}><option value="artist">Artist</option><option value="title">Title</option><option value="album">Album</option><option value="year">Year</option><option value="duration">Duration</option><option value="recent">Recently added</option></select></label>
        </div>
        <div className="library-filter-panel-footer">
          <button className="text-button" type="button" onClick={reset}>Reset filters</button>
          <button className="primary-button" type="button" onClick={onClose}><Check size={15} /> Show results</button>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="library-active-filters" aria-label="Active filters">
          <span className="active-filters-label">FILTERED BY</span>
          {chips.map((chip) => (
            <button className="filter-chip" key={chip.key} type="button" onClick={chip.clear} aria-label={"Clear " + chip.label + " filter"}>
              <span>{chip.label}: {chip.value}</span><X size={12} />
            </button>
          ))}
          <button className="clear-all-filters" type="button" onClick={() => { reset(); setQuery(""); }}>Clear all</button>
        </div>
      )}
    </>
  );
}
