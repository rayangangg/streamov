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
  
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;
  const onMarkWatchedRef = useRef(onMarkWatched);
  onMarkWatchedRef.current = onMarkWatched;

  const [resolvedPlayerUrl, setResolvedPlayerUrl] = useState(null);
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const [resolveError, setResolveError] = useState(null);
  const [collection, setCollection] = useState(null);
  const [webviewLoading, setWebviewLoading] = useState(false);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [pipOpen, setPipOpen] = useState(false);
  const pipUrlRef = useRef(null);
  const pipWebContentsIdRef = useRef(null);

  const isAnime = useMemo(
    () => isAnimeContent(item, details),
    [item.id, details],
  );
  const [downloaderFolder, setDownloaderFolder] = useState(
    () => storage.get("downloaderFolder") || "",
  );

  const {
    sessionTotal: blockedSession,
    alltimeTotal: blockedAlltime,
    showModal: showBlockedModal,
    setShowModal: setShowBlockedModal,
    getSessionDomains: getBlockedDomains,
  } = useBlockedStats(item.id);

  const [rating, setRating] = useState({ cert: null, minAge: null });
  const ageLimitSetting = useMemo(() => getAgeLimitSetting(storage), []);
  const ratingCountry = useMemo(() => getRatingCountry(storage), []);
  const restricted = isRestricted(rating.minAge, ageLimitSetting);
  const progressKey = `movie_${item.id}`;
  const pct = progress[progressKey] || 0;
  const isWatched = !!watched?.[progressKey];
  const hasProgress = pct > 0;

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

  const [watchedThreshold] = useState(() => storage.get("watchedThreshold") ?? 20);
  const autoMarkedRef = useRef(false);
  const lastKnownTimeRef = useRef(0);
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
        const trailer =
          videos.find((v) => v.type === "Trailer" && v.site === "YouTube") ||
          videos.find((v) => v.site === "YouTube");
        if (trailer) setTrailerKey(trailer.key);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [item.id, apiKey]);

  useEffect(() => {
    setCollection(null);
    if (!details?.belongs_to_collection?.id) return;
    let mounted = true;
    tmdbFetch(`/collection/${details.belongs_to_collection.id}`, apiKey)
      .then((data) => {
        if (!mounted) return;
        const parts = (data.parts || [])
          .map((p) => ({ ...p, media_type: "movie" }))
          .sort((a, b) => (a.release_date || "").localeCompare(b.release_date || ""));
        if (parts.length > 1) {
          setCollection({ name: data.name, parts });
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [details?.belongs_to_collection?.id, apiKey]);

  useEffect(() => {
    setM3u8Url(null);
    setInterceptedSubs([]);
    setShowSourceMenu(false);
    setAnilistData(null);
    setResolvedPlayerUrl(null);
    setResolvingUrl(false);
    setResolveError(null);
    setWebviewLoading(true);
  }, [item.id, playerSource, dubMode]);

  useEffect(() => {
    let mounted = true;
    if (isAnime) {
      fetchAnilistData(item.title || item.name, "ANIME", item.id).then((data) => {
        if (mounted && data) setAnilistData(data);
      });
      const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (!currentSrc?.tag) {
        const saved = storage.get("playerSource");
        const savedSrc = PLAYER_SOURCES.find((s) => s.id === saved);
        setPlayerSource(savedSrc?.tag ? saved : ANIME_DEFAULT_SOURCE);
      }
    } else {
      const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (currentSrc?.tag) {
        const saved = storage.get("playerSource");
        const savedSrc = PLAYER_SOURCES.find((s) => s.id === saved);
        setPlayerSource(!savedSrc?.tag ? saved : NON_ANIME_DEFAULT_SOURCE);
      }
    }
    return () => {
      mounted = false;
    };
  }, [item.id, isAnime]);

  useEffect(() => {
    if (!playing || !sourceIsAsync(playerSource)) return;
    if (resolvedPlayerUrl || resolvingUrl) return;
    setResolvingUrl(true);
    setResolveError(null);
    const startTime = storage.get("dlTime_" + progressKey) || 0;
    let mounted = true;
    window.electron
      .resolveAllManga({
        title,
        seasonNumber: 1,
        episodeNumber: 1,
        isMovie: true,
        translationType: dubMode,
      })
      .then((res) => {
        if (!mounted) return;
        if (res?.ok && res.url) {
          if (res.isDirectMp4 !== undefined) {
            window.electron
              .setPlayerVideo({
                url: res.url,
                referer: res.referer || "https://allmanga.to",
                startTime,
              })
              .then((r) => {
                if (!mounted) return;
                setResolvedPlayerUrl(r.playerUrl);
                setM3u8Url(res.url);
              })
              .catch(() => {
                if (mounted) setResolveError("Failed to start local player");
              });
          } else {
            setResolvedPlayerUrl(res.url);
          }
        } else {
          setResolveError(res?.error || "Movie not found on AllManga");
        }
      })
      .catch((e) => {
        if (mounted) setResolveError(e.message || "Error");
      })
      .finally(() => {
        if (mounted) setResolvingUrl(false);
      });
    return () => {
      mounted = false;
    };
  }, [playing, playerSource, dubMode, title, resolvedPlayerUrl, resolvingUrl, progressKey]);

  useEffect(() => {
    if (!playing || pipOpen) return;
    const frame = document.querySelector('[data-player-frame="true"]');
    if (!frame) return;
    const handleFrameMessage = (e) => {
      if (e.data && e.data.type === "PLAYER_PROGRESS") {
        const current = e.data.currentTime;
        const duration = e.data.duration;
        if (current && duration) {
          const calculatedPct = Math.floor((current / duration) * 100);
          saveProgressRef.current(progressKey, calculatedPct);
          storage.set("dlTime_" + progressKey, current);
          if (calculatedPct >= watchedThreshold && !autoMarkedRef.current && !isWatched) {
            autoMarkedRef.current = true;
            onMarkWatchedRef.current(progressKey);
          }
        }
      }
    };
    window.addEventListener("message", handleFrameMessage);
    return () => {
      window.removeEventListener("message", handleFrameMessage);
    };
  }, [playing, pipOpen, progressKey, isWatched, watchedThreshold]);

  useEffect(() => {
    if (!playing || progressViaFrames || pipOpen) return;
    const interval = setInterval(() => {
      if (!webviewRef.current) return;
      window.electron
        .getPlayerTime(item.id)
        .then((data) => {
          if (!data) return;
          const { currentTime: current, duration } = data;
          if (current && duration) {
            const nowTime = Date.now();
            if (current < lastKnownTimeRef.current - 15 && nowTime > seekBackCooldownRef.current) {
              seekBackCooldownRef.current = nowTime + 3000;
              lastKnownTimeRef.current = current;
              return;
            }
            if (current < lastKnownTimeRef.current - 2 && nowTime > seekBackCooldownRef.current) {
              window.electron.seekPlayer(item.id, lastKnownTimeRef.current);
              return;
            }
            lastKnownTimeRef.current = current;
            const calculatedPct = Math.floor((current / duration) * 100);
            saveProgressRef.current(progressKey, calculatedPct);
            storage.set("dlTime_" + progressKey, current);
            if (calculatedPct >= watchedThreshold && !autoMarkedRef.current && !isWatched) {
              autoMarkedRef.current = true;
              onMarkWatchedRef.current(progressKey);
            }
          }
        })
        .catch(() => {});
    }, 4000);
    return () => {
      clearInterval(interval);
    };
  }, [playing, progressViaFrames, pipOpen, item.id, progressKey, isWatched, watchedThreshold]);

  useEffect(() => {
    if (!playing) return;
    const onPipStatus = (e, status) => {
      setPipOpen(status.open);
      if (status.open && status.webContentsId) {
        pipWebContentsIdRef.current = status.webContentsId;
      } else {
        pipWebContentsIdRef.current = null;
      }
    };
    window.electron?.onPipStatus?.(onPipStatus);
    return () => {
      window.electron?.removePipStatusListener?.();
    };
  }, [playing]);

  const handleSetDownloaderFolder = (val) => {
    setDownloaderFolder(val);
    storage.set("downloaderFolder", val);
  };

  const movieDownload = downloads?.find(
    (dl) => dl.tmdbId === item.id && dl.mediaType === "movie",
  );

  const genres = d.genres || [];
  const backdrop = d.backdrop_path ? imgUrl(d.backdrop_path, "original") : null;
  const poster = d.poster_path ? imgUrl(d.poster_path, "w500") : null;

  return (
    <div className="media-page animation-fade-in">
      {backdrop && (
        <div className="media-backdrop-wrapper">
          <img src={backdrop} alt="" className="media-backdrop" loading="eager" />
          <div className="media-backdrop-overlay" />
        </div>
      )}

      <div className="media-content-container">
        <button className="media-back-btn" onClick={onBack} title="Go back">
          <BackIcon />
        </button>

        <div className="media-main-grid">
          <div className="media-poster-sidebar">
            {poster ? (
              <img src={poster} alt={title} className="media-poster shadow-2xl" loading="eager" />
            ) : (
              <div className="media-poster-placeholder shadow-2xl">No Poster</div>
            )}
          </div>

          <div className="media-info-main">
            <h1 className="media-title">{title}</h1>

            <div className="media-meta-row">
              {year && <span className="media-meta-item">{year}</span>}
              {d.runtime ? (
                <span className="media-meta-item">
                  {Math.floor(d.runtime / 60)}h {d.runtime % 60}m
                </span>
              ) : null}
              {rating.cert && (
                <span className="media-rating-badge" title={`Age rating source country: ${ratingCountry.toUpperCase()}`}>
                  {rating.cert}
                </span>
              )}
              {d.vote_average ? (
                <span className="media-meta-item text-yellow-500 font-semibold flex items-center gap-1">
                  <StarIcon /> {d.vote_average.toFixed(1)}
                </span>
              ) : null}
            </div>

            {genres.length > 0 && (
              <div className="media-genres-list">
                {genres.map((g) => (
                  <span key={g.id} className="media-genre-tag">
                    {g.name}
                  </span>
                ))}
              </div>
            )}

            <p className="media-overview">
              {anilistData ? cleanAnilistDescription(anilistData.description) : d.overview}
            </p>

            <div className="media-action-row">
              {restricted ? (
                <div className="media-restricted-notice">
                  <RatingLockIcon /> Locked - content exceeds your age limit setting ({ageLimitSetting}+)
                </div>
              ) : (
                <button
                  className={"media-play-btn" + (playing ? " media-play-btn--playing" : "")}
                  onClick={() => setPlaying(!playing)}
                >
                  <PlayIcon /> {playing ? "Close Player" : hasProgress ? "Continue Watching" : "Watch Now"}
                </button>
              )}

              <button
                className={"media-utility-btn" + (isSaved ? " media-utility-btn--active" : "")}
                onClick={() => onSave(item)}
                title={isSaved ? "Remove from watchlist" : "Add to watchlist"}
              >
                {isSaved ? <BookmarkFillIcon /> : <BookmarkIcon />}
              </button>

              {trailerKey && (
                <button className="media-utility-btn" onClick={() => setShowTrailer(true)} title="Watch Trailer">
                  <TrailerIcon />
                </button>
              )}

              {isWatched ? (
                <button className="media-utility-btn media-utility-btn--active" onClick={() => onMarkUnwatched(progressKey)} title="Mark as unwatched">
                  <WatchedIcon />
                </button>
              ) : (
                <button className="media-utility-btn" onClick={() => onMarkWatched(progressKey)} title="Mark as watched">
                  <WatchedIcon />
                </button>
              )}
            </div>

            {hasProgress && !isWatched && progressLabel && (
              <div className="media-progress-container mt-4">
                <div className="media-progress-bar-wrap">
                  <div className="media-progress-bar-fill" style={{ width: `${displayPct}%` }} />
                </div>
                <div className="media-progress-text mt-1">{progressLabel} remaining</div>
              </div>
            )}
          </div>
        </div>

        {playing && !restricted && (
          <div className="player-main-area relative" ref={playerWrapRef}>
            {sourceIsAsync(playerSource) && resolvingUrl && (
              <div className="player-loading-overlay player-loading-overlay--async">
                <div className="player-loading-spinner" />
                <div className="player-loading-text">Resolving premium secure mirror from AllManga...</div>
              </div>
            )}

            {sourceIsAsync(playerSource) && resolveError && (
              <div className="player-loading-overlay player-loading-overlay--error">
                <div className="player-error-icon">⚠</div>
                <div className="player-loading-text text-red-500">{resolveError}</div>
                <button
                  className="mt-4 px-4 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition"
                  onClick={() => {
                    setResolvedPlayerUrl(null);
                    setResolvingUrl(false);
                    setResolveError(null);
                    setPlaying(false);
                    setTimeout(() => setPlaying(true), 50);
                  }}
                >
                  Retry Resolution
                </button>
              </div>
            )}

            {webviewLoading && !(sourceIsAsync(playerSource) && !resolvedPlayerUrl) && (
              <div className="player-loading-overlay">
                <div className="player-loading-spinner" />
              </div>
            )}

            {/* Isolated Player Wrapper Matrix */}
            <div 
              className="relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl border border-zinc-800"
              style={{ position: "relative", width: "100%", overflow: "hidden" }}
            >
              <iframe
                ref={webviewRef}
                data-player-frame="true"
                src={
                  pipOpen
                    ? "about:blank"
                    : sourceIsAsync(playerSource)
                      ? resolvedPlayerUrl || "about:blank"
                      : getSourceUrl(playerSource, "movie", item.id, null, null)
                }
                title="Player"
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope"
                allowFullScreen
                referrerPolicy="origin"
                loading="eager"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  border: "none",
                  background: "black",
                  zIndex: 10,
                  visibility:
                    webviewLoading || (sourceIsAsync(playerSource) && !resolvedPlayerUrl)
                      ? "hidden"
                      : "visible",
                }}
              />

              {/* Premium Multi-Touch Click Interceptor Shield */}
              <div 
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "calc(100% - 55px)",
                  backgroundColor: "transparent",
                  zIndex: 20,
                  pointerEvents: "auto",
                  cursor: "pointer"
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onMouseUp={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              />
            </div>

            {/* Left-side overlay button group (Decoupled completely from layout shift matrix) */}
            <div className="player-overlay-group" style={{ position: "relative", zIndex: 30, display: "flex", gap: "8px", marginTop: "12px" }}>
              <button
                ref={sourceRef}
                className="player-overlay-btn"
                onClick={() => {
                  const rect = sourceRef.current?.getBoundingClientRect();
                  if (rect) setMenuPos({ top: rect.bottom + 6, left: rect.left });
                  setShowSourceMenu((v) => !v);
                }}
                title="Change source"
              >
                <SourceIcon />
                {PLAYER_SOURCES.find((s) => s.id === playerSource)?.label ?? "Source"}
              </button>

              {playerSource === "allmanga" && (
                <button
                  className="player-overlay-btn"
                  onClick={() => {
                    const next = dubMode === "sub" ? "dub" : "sub";
                    setDubMode(next);
                    storage.set("allmangaDubMode", next);
                    setM3u8Url(null);
                    setInterceptedSubs([]);
                    setResolvedPlayerUrl(null);
                    setResolvingUrl(false);
                    setResolveError(null);
                  }}
                  title="Toggle Sub/Dub"
                >
                  {dubMode === "sub" ? "SUB" : "DUB"}
                </button>
              )}

              <button
                className="player-overlay-btn"
                onClick={() => {
                  setShowSourceMenu(false);
                  setShowBlockedModal(true);
                }}
                title="Blocked ads & trackers"
              >
                <ShieldBlockIcon />
                {blockedSession > 0 && <span className="player-blocked-badge">{blockedSession}</span>}
              </button>

              <button
                className="player-overlay-btn"
                onClick={() => {
                  if (pipOpen) {
                    window.electron?.closePipWindow?.();
                    return;
                  }
                  const url = sourceIsAsync(playerSource)
                    ? resolvedPlayerUrl
                    : getSourceUrl(playerSource, "movie", item.id, null, null);
                  if (!url) return;
                  pipUrlRef.current = url;
                  window.electron?.openPipWindow?.(url, item.title);
                }}
                title={pipOpen ? "Close pop-out" : "Pop out player"}
                disabled={!pipOpen && (webviewLoading || !!(sourceIsAsync(playerSource) && !resolvedPlayerUrl))}
                style={pipOpen ? { color: "var(--red)" } : undefined}
              >
                <PopOutIcon />
              </button>

              <button
                className="player-overlay-btn"
                onClick={() => movieDownload ? onGoToDownloads?.(movieDownload.id) : (setShowSourceMenu(false), setShowDownload(true))}
                title={movieDownload ? (movieDownload.status === "downloading" ? "Downloading… - view in Downloads" : "Already downloaded - view in Downloads") : "Download"}
              >
                {movieDownload ? (
                  <span className="player-downloaded-icon" style={{ color: movieDownload.status === "downloading" ? "var(--red)" : "#4caf50" }}>
                    {movieDownload.status === "downloading" ? "↓" : "✓"}
                  </span>
                ) : (
                  <DownloadIcon />
                )}
                {!movieDownload && m3u8Url && <span className="player-overlay-dot" />}
                {!sourceSupportsProgress(playerSource) && (
                  <span className="player-no-progress-hint" title="No automatic progress tracking for this source">
                    ⚠ no tracking
                  </span>
                )}
              </button>
            </div>

            {showSourceMenu && menuPos && (
              <div
                className="source-dropdown source-dropdown--fixed"
                style={{ top: menuPos.top, left: menuPos.left, zIndex: 40 }}
                onClick={(e) => e.stopPropagation()}
              >
                {PLAYER_SOURCES.map((src) => (
                  <button
                    key={src.id}
                    className={"source-dropdown__item" + (playerSource === src.id ? " source-dropdown__item--active" : "")}
                    onClick={() => {
                      setShowSourceMenu(false);
                      if (src.id === playerSource) return;
                      setPlayerSource(src.id);
                      storage.set("playerSource", src.id);
                      setM3u8Url(null);
                      setInterceptedSubs([]);
                      setResolvedPlayerUrl(null);
                      setResolvingUrl(false);
                      setResolveError(null);
                    }}
                  >
                    <span>{src.label}</span>
                    {src.tag && <span className="source-dropdown__tag">{src.tag}</span>}
                    {src.note && <span className="source-dropdown__note">{src.note}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {collection && (
          <div className="media-collection-section mt-12 border-t border-zinc-800 pt-8">
            <h3 className="text-xl font-bold mb-4 text-zinc-200">{collection.name}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {collection.parts.map((part) => {
                const pk = `movie_${part.id}`;
                const partProgress = progress[pk] || 0;
                const partWatched = !!watched?.[pk];
                return (
                  <CollectionCard
                    key={part.id}
                    part={part}
                    isCurrent={part.id === item.id}
                    onSelect={onSelect}
                    progress={partProgress}
                    watched={partWatched}
                    onMarkWatched={() => onMarkWatched(pk)}
                    onMarkUnwatched={() => onMarkUnwatched(pk)}
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
          mediaId={item.id}
          sessionTotal={blockedSession}
          alltimeTotal={blockedAlltime}
          getDomains={getBlockedDomains}
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
    <div style={{ opacity: isCurrent ? 0.5 : 1, pointerEvents: isCurrent ? "none" : "auto" }}>
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