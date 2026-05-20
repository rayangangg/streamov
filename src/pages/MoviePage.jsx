import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  memo,
  useCallback,
  useMemo,
} from "react";
import {
  tmdbFetch,
  imgUrl,
  PLAYER_SOURCES,
  getSourceUrl,
  sourceSupportsProgress,
  sourceProgressViaFrames,
  sourceIsAsync,
  fetchAnilistData,
  cleanAnilistDescription,
  isAnimeContent,
  ANIME_DEFAULT_SOURCE,
  NON_ANIME_DEFAULT_SOURCE,
  NEEDS_INTERCEPT,
} from "../utils/api";
import {
  PlayIcon,
  BookmarkIcon,
  BookmarkFillIcon,
  BackIcon,
  StarIcon,
  FilmIcon,
  DownloadIcon,
  WatchedIcon,
  TrailerIcon,
  RatingShieldIcon,
  RatingLockIcon,
  SourceIcon,
  ShieldBlockIcon,
  PopOutIcon,
} from "../components/Icons";
import DownloadModal from "../components/DownloadModal";
import TrailerModal from "../components/TrailerModal";
import BlockedStatsModal from "../components/BlockedStatsModal";
import { useBlockedStats } from "../utils/useBlockedStats";
import MediaCard from "../components/MediaCard";
import { storage } from "../utils/storage";
import {
  fetchMovieRating,
  isRestricted,
  getAgeLimitSetting,
  getRatingCountry,
} from "../utils/ageRating";

export default function MoviePage({
  item,
  apiKey,
  onSave,
  isSaved,
  onHistory,
  progress,
  saveProgress,
  onBack,
  onSettings,
  onDownloadStarted,
  watched,
  onMarkWatched,
  onMarkUnwatched,
  downloads,
  onGoToDownloads,
  onSelect,
}) {
  const [details, setDetails] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [trailerKey, setTrailerKey] = useState(null);
  const [showTrailer, setShowTrailer] = useState(false);
  const [m3u8Url, setM3u8Url] = useState(null);
  const [interceptedSubs, setInterceptedSubs] = useState([]);
  const [playerSource, setPlayerSource] = useState(
    () => {
      const saved = storage.get("playerSource");
      return saved && !["vidsrc", "2embed", "allmanga"].includes(saved)
        ? saved
        : NON_ANIME_DEFAULT_SOURCE;
    },
  );
  const progressViaFrames = useMemo(
    () => sourceProgressViaFrames(playerSource),
    [playerSource],
  );
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [dubMode, setDubMode] = useState(
    () => storage.get("allmangaDubMode") || "sub",
  );
  const [anilistData, setAnilistData] = useState(null);
  const [menuPos, setMenuPos] = useState(null);
  const sourceRef = useRef(null);
  const playerWrapRef = useRef(null);
  const webviewRef = useRef(null);
  // Always-current refs for interval callbacks, avoids stale closures without restarting the interval
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;
  const onMarkWatchedRef = useRef(onMarkWatched);
  onMarkWatchedRef.current = onMarkWatched;
  // AllManga async URL resolution
  const [resolvedPlayerUrl, setResolvedPlayerUrl] = useState(null);
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const [resolveError, setResolveError] = useState(null);
  const [collection, setCollection] = useState(null);
  // { name, parts }
  // Webview loading overlay
  const [webviewLoading, setWebviewLoading] = useState(false);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  // pipOpen=true: main webview shows about:blank, pop-out window has the real player
  const [pipOpen, setPipOpen] = useState(false);
  const pipUrlRef = useRef(null); // URL to restore when pop-out closes
  const pipWebContentsIdRef = useRef(null);
  // cached WebContents ID of the pop-out window

  // Derived: detect anime before any effects so effects can use it
  const isAnime = useMemo(
    () => isAnimeContent(item, details),
    [item.id, details],
  );
  const [downloaderFolder, setDownloaderFolder] = useState(
    () => storage.get("downloaderFolder") || "",
  );
  // Blocked request stats
  const {
    sessionTotal: blockedSession,
    alltimeTotal: blockedAlltime,
    showModal: showBlockedModal,
    setShowModal: setShowBlockedModal,
    getSessionDomains: getBlockedDomains,
  } = useBlockedStats(item.id);
  // Age rating
  const [rating, setRating] = useState({ cert: null, minAge: null });
  const ageLimitSetting = useMemo(() => getAgeLimitSetting(storage), []);
  const ratingCountry = useMemo(() => getRatingCountry(storage), []);
  const restricted = isRestricted(rating.minAge, ageLimitSetting);
  const progressKey = `movie_${item.id}`;
  const pct = progress[progressKey] || 0;
  const isWatched = !!watched?.[progressKey];
  const hasProgress = pct > 0;
  // ── Derived display values (must be declared before any callbacks that use them) ──
  const d = details || item;
  const title = d.title || d.name;
  const year = (d.release_date || "").slice(0, 4);
  const mediaName = `${title}${year ? " (" + year + ")" : ""}`;

  const { watchedSecs, totalSecs, displayPct, progressLabel } = useMemo(() => {
    const watchedSecs = storage.get("dlTime_" + progressKey) || 0;
    const totalSecs = d?.runtime ? d.runtime * 60 : 0;
    const derivedPct =
      watchedSecs > 0 && totalSecs > 0
        ? Math.floor((watchedSecs / totalSecs) * 100)
        : 0;
    const displayPct = pct > 0 ? pct : derivedPct;
    const fmt = (s) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      return h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
        : `${m}:${String(sec).padStart(2, "0")}`;
    };
    const progressLabel =
      watchedSecs > 0 && totalSecs > 0
        ? `${fmt(watchedSecs)} / ${fmt(totalSecs)}`
        : watchedSecs > 0
          ? fmt(watchedSecs)
          : displayPct > 0
            ? `${displayPct}%`
            : null;
    return { watchedSecs, totalSecs, displayPct, progressLabel };
  }, [progressKey, pct, d?.runtime]);

  // Read threshold from settings (default 20s), stable across renders
  const [watchedThreshold] = useState(
    () => storage.get("watchedThreshold") ?? 20,
  );
  // Ref to prevent double-marking
  const autoMarkedRef = useRef(false);
  // Tracks last known playback position, used to detect resolution-change resets
  const lastKnownTimeRef = useRef(0);
  // Timestamp until which we ignore reset detection (post-seekback cooldown)
  const seekBackCooldownRef = useRef(0);
  useEffect(() => {
    let mounted = true;
    tmdbFetch(`/movie/${item.id}`, apiKey)
      .then((d) => {
        if (mounted) setDetails(d);
      })
      .catch(() => {
        if (mounted) setDetails(item);
      });
    return () => {
      mounted = false;
    };
  }, [item.id, apiKey]);
  useEffect(() => {
    let mounted = true;
    fetchMovieRating(item.id, apiKey, ratingCountry).then((r) => {
      if (mounted) setRating(r);
    });
    return () => {
      mounted = false;
    };
  }, [item.id, apiKey, ratingCountry]);
  useEffect(() => {
    let mounted = true;
    tmdbFetch(`/movie/${item.id}/videos`, apiKey)
      .then((data) => {
        if (!mounted) return;
        const videos = data.results || [];
        const trailer = videos.find((v) => v.type === "Trailer" && v.site === "YouTube") || videos.find((v) => v.site === "YouTube");
        if (trailer) setTrailerKey(trailer.key);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [item.id, apiKey]);
  // Fetch movie collection (sequels/prequels)
  useEffect(() => {
    setCollection(null);
    if (!details?.belongs_to_collection?.id) return;
    let mounted = true;
    tmdbFetch(`/collection/${details.belongs_to_collection.id}`, apiKey)
      .then((data) => {
        if (!mounted) return;
        const parts = (data.parts || [])
          .map((p) => ({ ...p, media_type: "movie" }))
          .sort((a, b) => (a.release_date || "").localeCompare(b.release_date || ""), );
        if (parts.length > 1) {
          setCollection({ name: data.name, parts });
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [details?.belongs_to_collection?.id, apiKey]);
  // Reset m3u8 URL, subtitle URL and source menu whenever the movie or source changes
  useEffect(() => {
    setM3u8Url(null);
    setInterceptedSubs([]);
    setShowSourceMenu(false);
    setAnilistData(null);
    setResolvedPlayerUrl(null);
    setResolvingUrl(false);
    setResolveError(null);
    setWebviewLoading(true); // instantly blank the player on every source/item switch
  }, [item.id, playerSource, dubMode]);
  // Fetch AniList data + auto-set source for anime/non-anime
  useEffect(() => {
    let mounted = true;
    if (isAnime) {
      fetchAnilistData(item.title || item.name, "ANIME", item.id).then(
        (data) => {
          if (mounted && data) setAnilistData(data);
        },
      ); // Switch to anime source if current source is not an anime source
      const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (!currentSrc?.tag) {
        const saved = storage.get("playerSource");
        const savedSrc = PLAYER_SOURCES.find((s) => s.id === saved);
        setPlayerSource(savedSrc?.tag ? saved : ANIME_DEFAULT_SOURCE);
      }
    } else { // Switch back to non-anime source if current source is anime-only
      const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (currentSrc?.tag) {
        const saved = storage.get("playerSource");
        const savedSrc = PLAYER_SOURCES.find((s) => !s.tag && s.id === saved);
        setPlayerSource(savedSrc ? saved : NON_ANIME_DEFAULT_SOURCE);
      }
    } return () => {
      mounted = false;
    };
  }, [item.id, isAnime]);
  // Async URL resolution for AllManga
  useEffect(() => {
    if (playerSource !== "allmanga" || !playing || !details) return;
    let mounted = true;
    setResolvingUrl(true);
    setResolveError(null);
    const titleToUse = anilistData?.title?.romaji || details.title || details.name;
    const releaseYear = (details.release_date || "").slice(0, 4);
    getSourceUrl("allmanga", details.id, "movie", titleToUse, releaseYear, dubMode)
      .then((url) => {
        if (!mounted) return;
        if (url) {
          setResolvedPlayerUrl(url);
        } else {
          setResolveError("Could not find this movie on AllManga.");
        }
      })
      .catch((err) => {
        if (mounted) setResolveError(err?.message || "Failed to resolve AllManga URL.");
      })
      .finally(() => {
        if (mounted) setResolvingUrl(false);
      });
    return () => {
      mounted = false;
    };
  }, [playerSource, playing, details, anilistData, dubMode]);

  // Handle Electron Webview IPC Events for Frame-based progress tracking
  useLayoutEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !playing || !progressViaFrames) return;
    const handleIPC = (e) => {
      if (e.channel === "player-timeupdate") {
        const [currentTime, duration] = e.args;
        if (typeof currentTime === "number" && typeof duration === "number" && duration > 0) {
          const currentPct = Math.floor((currentTime / duration) * 100); // Cooldown-based resolution reset detection
          const now = Date.now();
          if (currentTime < lastKnownTimeRef.current - 15 && now > seekBackCooldownRef.current) { // stream probably reset due to resolution toggle, restore time
            wv.executeJavaScript(`
              (function() {
                var v = document.querySelector('video');
                if (v) v.currentTime = ${lastKnownTimeRef.current};
              })();
            `).catch(() => {});
            seekBackCooldownRef.current = now + 4000; // 4s protection window
          } else {
            lastKnownTimeRef.current = currentTime;
          }
          storage.set("dlTime_" + progressKey, currentTime);
          if (currentPct >= 0 && currentPct <= 100) {
            saveProgressRef.current(progressKey, currentPct); // Automark as watched if configured threshold reached
            if (watchedThreshold > 0 && currentTime >= duration - watchedThreshold && !autoMarkedRef.current) {
              autoMarkedRef.current = true;
              onMarkWatchedRef.current(progressKey);
            }
          }
        }
      }
    };
    wv.addEventListener("ipc-message", handleIPC);
    return () => {
      wv.removeEventListener("ipc-message", handleIPC);
    };
  }, [playing, progressViaFrames, progressKey, watchedThreshold]);

  // Inject keyboard/UI shortcuts when webview completes loading
  const handleDomReady = useCallback(() => {
    setWebviewLoading(false);
    const wv = webviewRef.current;
    if (!wv) return; // Inject custom skip Controls styling and keystrokes
    wv.executeJavaScript(INJECT_SKIP_CONTROLS).catch(() => {});
  }, []);

  // Sync Pop-out window state changes from Main Process
  useEffect(() => {
    if (!playing) return;
    const handlePipState = (e, status, webContentsId) => {
      setPipOpen(status);
      if (status && webContentsId) {
        pipWebContentsIdRef.current = webContentsId;
      } else {
        pipWebContentsIdRef.current = null;
      }
    };
    window.electron?.onPipStateChanged?.(handlePipState);
    return () => {
      window.electron?.removePipStateListener?.();
    };
  }, [playing]);

  const handleSetDownloaderFolder = useCallback((folder) => {
    setDownloaderFolder(folder);
    storage.set("downloaderFolder", folder);
  }, []);

  // Direct download interception trigger
  const handleOpenDownload = useCallback(() => {
    if (NEEDS_INTERCEPT(playerSource)) {
      if (m3u8Url) {
        setShowDownload(true);
      } else {
        alert("Please start playing the video first to capture the stream link for download!");
      }
    } else {
      setShowDownload(true);
    }
  }, [playerSource, m3u8Url]);

  const playerUrl = useMemo(() => {
    if (playerSource === "allmanga") return resolvedPlayerUrl;
    return getSourceUrl(playerSource, item.id, "movie");
  }, [playerSource, item.id, resolvedPlayerUrl]);

  // Listen to background M3U8/Subtitle link extraction hooks via Electron APIs
  useEffect(() => {
    if (!playing || !NEEDS_INTERCEPT(playerSource)) return;
    const unsubscribe = window.electron.onM3u8Intercepted((data) => {
      if (data.url) setM3u8Url(data.url);
      if (data.subtitles) setInterceptedSubs(data.subtitles);
    });
    return () => unsubscribe();
  }, [playing, playerSource]);

  const togglePlay = useCallback(() => {
    if (restricted) return;
    setPlaying((p) => {
      const next = !p;
      if (!next) { // clearing tracking refs on close
        setM3u8Url(null);
        setInterceptedSubs([]);
        setResolvedPlayerUrl(null);
        setResolvingUrl(false);
        setResolveError(null);
        autoMarkedRef.current = false;
        lastKnownTimeRef.current = 0;
        seekBackCooldownRef.current = 0;
        if (pipOpen && pipWebContentsIdRef.current) {
          window.electron?.closePipWindow?.(pipWebContentsIdRef.current);
          setPipOpen(false);
          pipWebContentsIdRef.current = null;
        }
      } else {
        onHistory?.({ ...item, media_type: "movie" });
      }
      return next;
    });
  }, [restricted, onHistory, item, pipOpen]);

  const triggerPopOut = useCallback(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    try {
      const currentUrl = wv.getURL();
      if (!currentUrl || currentUrl === "about:blank") return;
      pipUrlRef.current = currentUrl;
      window.electron.openPipWindow(currentUrl, item.id);
    } catch (e) {}
  }, [item.id]);

  const handleSourceSelect = useCallback((srcId) => {
    setPlayerSource(srcId);
    storage.set("playerSource", srcId);
    setShowSourceMenu(false);
  }, []);

  if (!details) {
    return (
      <div className="page-loading">
        <div className="spinner" />
      </div>
    );
  }

  const genres = (d.genres || []).map((g) => g.name).join(", ");
  const backdrop = imgUrl(d.backdrop_path, "original");
  const poster = imgUrl(d.poster_path, "w500");

  return (
    <div className="media-page movie-page">
      <div className="hero-bg" style={{ backgroundImage: backdrop ? `url(${backdrop})` : "none" }}>
        <div className="hero-overlay" />
      </div>

      <div className="page-header">
        <button className="icon-btn back-btn" onClick={onBack} title="Back">
          <BackIcon />
        </button>
        <div className="header-actions">
          <button className="icon-btn" onClick={() => setShowBlockedModal(true)} title="Blocked Trackers">
            <ShieldBlockIcon />
            {blockedSession > 0 && <span className="badge red-badge">{blockedSession}</span>}
          </button>
          <button className="icon-btn" onClick={() => onSave(item)} title={isSaved ? "Remove Bookmark" : "Bookmark"}>
            {isSaved ? <BookmarkFillIcon /> : <BookmarkIcon />}
          </button>
        </div>
      </div>

      <div className="page-content">
        {playing ? (
          <div ref={playerWrapRef} className={`player-wrapper ${playerFullscreen ? "fullscreen" : ""}`}>
            {resolvingUrl ? (
              <div className="player-loader">
                <div className="spinner" />
                <p>Resolving AllManga Stream URL…</p>
              </div>
            ) : resolveError ? (
              <div className="player-loader error-box">
                <p>{resolveError}</p>
                <button className="btn" onClick={() => setPlaying(false)}>Close Player</button>
              </div>
            ) : playerUrl ? (
              <div style={{ width: "100%", height: "100%", position: "relative" }}>
                {webviewLoading && (
                  <div className="player-loader webview-overlay-loader">
                    <div className="spinner" />
                  </div>
                )}
                <webview
                  ref={webviewRef}
                  src={pipOpen ? "about:blank" : playerUrl}
                  style={{ width: "100%", height: "100%", background: "#000" }}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  partition="persist:player"
                  onDOMReady={handleDomReady}
                  nodeintegration="false"
                  webpreferences="contextIsolation=true, trustSRI=true"
                />
                {pipOpen && (
                  <div className="pip-placeholder-overlay">
                    <PopOutIcon />
                    <p>Playing in Pop-Out Window</p>
                    <button className="btn" onClick={() => {
                      if (pipWebContentsIdRef.current) {
                        window.electron?.closePipWindow?.(pipWebContentsIdRef.current);
                      }
                    }}>
                      Bring Player Back
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="player-loader">
                <p>No stream URL available for this source.</p>
              </div>
            )}
            <div className="player-controls-bar">
              <div className="left-controls">
                <button className="btn close-p-btn" onClick={togglePlay}>Close Player</button>
                <div className="source-selector-wrap" ref={sourceRef}>
                  <button className="btn source-toggle-btn" onClick={() => setShowSourceMenu(!showSourceMenu)}>
                    <SourceIcon />
                    <span>Source: {PLAYER_SOURCES.find((s) => s.id === playerSource)?.name || playerSource}</span>
                  </button>
                  {showSourceMenu && (
                    <div className="source-dropdown-menu">
                      {PLAYER_SOURCES.filter((s) => !s.tag || isAnime).map((src) => (
                        <button
                          key={src.id}
                          className={`source-item ${playerSource === src.id ? "active" : ""}`}
                          onClick={() => handleSourceSelect(src.id)}
                        >
                          {src.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {playerSource === "allmanga" && (
                  <div className="dub-toggle-group">
                    <button className={`btn toggle-sub-btn ${dubMode === "sub" ? "active" : ""}`} onClick={() => setDubMode("sub")}>Sub</button>
                    <button className={`btn toggle-dub-btn ${dubMode === "dub" ? "active" : ""}`} onClick={() => setDubMode("dub")}>Dub</button>
                  </div>
                )}
              </div>
              <div className="right-controls">
                {!pipOpen && playerUrl && !resolvingUrl && !resolveError && (
                  <button className="icon-btn pip-trigger-btn" onClick={triggerPopOut} title="Pop-out Player">
                    <PopOutIcon />
                  </button>
                )}
                {NEEDS_INTERCEPT(playerSource) && (
                  <div className={`stream-capture-badge ${m3u8Url ? "success" : "searching"}`}>
                    {m3u8Url ? "✓ Link Captured" : "Capturing Stream Link…"}
                  </div>
                )}
                <button className="btn download-trigger-btn" onClick={handleOpenDownload}>
                  <DownloadIcon /> Download
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="media-details-layout">
            <div className="poster-column">
              {poster ? <img src={poster} alt={title} className="main-poster" /> : <div className="no-poster"><FilmIcon /></div>}
            </div>
            <div className="info-column">
              <h1 className="media-title">{title}</h1>
              <div className="metadata-row">
                {year && <span className="meta-item year-tag">{year}</span>}
                {d.runtime ? <span className="meta-item duration-tag">{d.runtime} min</span> : null}
                {d.vote_average ? (
                  <span className="meta-item rating-tag">
                    <StarIcon /> {d.vote_average.toFixed(1)}
                  </span>
                ) : null}
                {rating.cert && <span className="meta-item certification-badge">{rating.cert}</span>}
              </div>

              {restricted ? (
                <div className="age-lock-notice-box">
                  <RatingLockIcon />
                  <div>
                    <h4>Content Locked ({rating.cert})</h4>
                    <p>This movie exceeds your age restriction filter profile limit.</p>
                  </div>
                </div>
              ) : (
                <div className="action-row">
                  <button className="btn primary-play-btn" onClick={togglePlay}>
                    <PlayIcon /> {hasProgress ? "Resume Movie" : "Play Movie"}
                  </button>
                  <button className="btn secondary-dl-btn" onClick={handleOpenDownload}>
                    <DownloadIcon /> Download Option
                  </button>
                  {isWatched ? (
                    <button className="icon-btn watched-toggle-btn active" onClick={() => onMarkUnwatched(progressKey)} title="Mark as Unwatched">
                      <WatchedIcon />
                    </button>
                  ) : (
                    <button className="icon-btn watched-toggle-btn" onClick={() => onMarkWatched(progressKey)} title="Mark as Watched">
                      <WatchedIcon />
                    </button>
                  )}
                </div>
              )}

              {hasProgress && (
                <div className="resume-progress-container">
                  <div className="progress-bar-bg">
                    <div className="progress-bar-fill" style={{ width: `${displayPct}%` }} />
                  </div>
                  <span className="progress-percentage-lbl">
                    {progressLabel ? `Progress: ${progressLabel}` : `${displayPct}% watched`}
                  </span>
                </div>
              )}

              {genres && (
                <div className="genres-container">
                  <h5>Genres</h5>
                  <p>{genres}</p>
                </div>
              )}

              {d.overview && (
                <div className="overview-container">
                  <h5>Synopsis</h5>
                  <p className="synopsis-text">{d.overview}</p>
                </div>
              )}

              {anilistData && anilistData.description && (
                <div className="anime-description-container">
                  <h5>AniList Synopsis</h5>
                  <p className="synopsis-text" dangerouslySetInnerHTML={{ __html: cleanAnilistDescription(anilistData.description) }} />
                </div>
              )}
            </div>
          </div>
        )}

        {collection && collection.parts && collection.parts.length > 0 && (
          <div className="collection-section">
            <h3 className="section-title">{collection.name}</h3>
            <div className="collection-grid cards-grid">
              {collection.parts.map((part) => {
                const partKey = `movie_${part.id}`;
                return (
                  <CollectionCard
                    key={part.id}
                    part={part}
                    isCurrent={part.id === item.id}
                    onSelect={onSelect}
                    progress={progress[partKey] || 0}
                    watched={!!watched?.[partKey]}
                    onMarkWatched={() => onMarkWatched(partKey)}
                    onMarkUnwatched={() => onMarkUnwatched(partKey)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {showTrailer && trailerKey && (
        <TrailerModal videoKey={trailerKey} onClose={() => setShowTrailer(false)} />
      )}

      {showBlockedModal && (
        <BlockedStatsModal
          sessionTotal={blockedSession}
          alltimeTotal={blockedAlltime}
          getDomains={getBlockDomains}
          onClose={() => setShowBlockedModal(false)}
        />
      )}

      {showDownload && (
        <DownloadModal
          onClose={() => setShowDownload(false)}
          m3u8Url={m3u8Url}
          subtitles={interceptedSubs}
          mediaName={mediaName}
          downloaderFolder={downloaderFolder}
          setDownloaderFolder={handleSetDownloaderFolder}
          onOpenSettings={onSettings}
          onDownloadStarted={onDownloadStarted}
          mediaId={item.id}
          mediaType="movie"
          posterPath={d.poster_path}
          tmdbId={item.id}
        />
      )}
    </div>
  );
}

// ── CollectionCard ─────────────────────────────────────────────────────────
// Isolated memo'd wrapper so the onClick for each collection part is stable
// and doesn't cause MediaCard to re-render on every progress tick.
const CollectionCard = memo(function CollectionCard({
  part,
  isCurrent,
  onSelect,
  progress,
  watched,
  onMarkWatched,
  onMarkUnwatched,
}) {
  const handleClick = useCallback(() => onSelect(part), [onSelect, part]);
  return (
    <div
      style={{
        opacity: isCurrent ? 0.5 : 1,
        pointerEvents: isCurrent ? "none" : "auto",
      }}
    >
      <MediaCard
        item={part}
        onClick={handleClick}
        progress={progress}
        watched={watched}
        onMarkWatched={onMarkWatched}
        onMarkUnwatched={onMarkUnwatched}
      />
    </div>
  );
});