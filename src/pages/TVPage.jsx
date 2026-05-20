import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
  memo,
} from "react";
import {
  EPISODE_GROUP_IDS,
  applyEpisodeMapping,
  buildEpisodeGroupMap,
} from "../utils/episodeMappings";
import {
  tmdbFetch,
  imgUrl,
  PLAYER_SOURCES,
  getSourceUrl,
  sourceSupportsProgress,
  sourceProgressViaFrames,
  sourceIsAsync,
  fetchAnilistData,
  fetchEpisodeGroup,
  buildAnilistSeasons,
  cleanAnilistDescription,
  isAnimeContent,
  ANIME_DEFAULT_SOURCE,
  NON_ANIME_DEFAULT_SOURCE,
  NEEDS_INTERCEPT,
} from "../utils/api";
import {
  BookmarkIcon,
  BookmarkFillIcon,
  BackIcon,
  StarIcon,
  PlayIcon,
  TVIcon,
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
import { storage, STORAGE_KEYS } from "../utils/storage";
import { fetchAniSkipTimings } from "../utils/aniSkip";
import {
  fetchTVRating,
  isRestricted,
  getAgeLimitSetting,
  getRatingCountry,
} from "../utils/ageRating";

// ── Partial-circle progress icon (cached per pct tier) ───────────────────────
// Uses a single SVG arc.
function _makePartialCircle(pct) {
  const r = 5;
  const cx = 7;
  const cy = 7;
  const angle = (pct / 100) * 2 * Math.PI - Math.PI / 2;
  const x = cx + r * Math.cos(angle);
  const y = cy + r * Math.sin(angle);
  const large = pct > 50 ? 1 : 0;
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        marginRight: 4,
        flexShrink: 0,
      }}
    >
      {/* Background ring */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.25"
      />
      {/* Filled arc */}
      <path
        d={`M ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${x.toFixed(3)} ${y.toFixed(3)} L ${cx} ${cy} Z`}
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  );
}
const _CIRCLE_25 = _makePartialCircle(25);
const _CIRCLE_50 = _makePartialCircle(50);
const _CIRCLE_75 = _makePartialCircle(75);
const _CIRCLE_MAP = { 25: _CIRCLE_25, 50: _CIRCLE_50, 75: _CIRCLE_75 };
function PartialCircleIcon({ pct }) {
  return _CIRCLE_MAP[pct] ?? null;
}

// Generic context menu (used for both episode and season actions)
function ContextMenu({
  x,
  y,
  isWatched,
  hasProgress,
  watchedLabel,
  unwatchedLabel,
  onMarkWatched,
  onMarkUnwatched,
  onMarkNotStarted,
  onClose,
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const close = () => onCloseRef.current();
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, []);
  return (
    <div
      className="context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      {isWatched ? (
        <button
          className="context-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            onMarkUnwatched();
            onCloseRef.current();
          }}
        >
          ↩ {unwatchedLabel}
        </button>
      ) : (
        <button
          className="context-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            onMarkWatched();
            onCloseRef.current();
          }}
        >
          ✓ {watchedLabel}
        </button>
      )}
      {onMarkNotStarted && !isWatched && hasProgress && (
        <button
          className="context-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            onMarkNotStarted();
            onCloseRef.current();
          }}
        >
          ⊘ Mark as Not Started
        </button>
      )}
    </div>
  );
}

// Expandable episode description
function EpisodeDesc({ overview, episodeName }) {
  const [open, setOpen] = useState(false);
  if (!overview) return <div className="episode-desc" />;

  return (
    <>
      <div className="episode-desc-wrap">
        <div className="episode-desc">{overview}</div>
        <button
          className="episode-desc-toggle"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          More
        </button>
      </div>

      {open && (
        <div
          className="ep-desc-overlay"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
        >
          <div className="ep-desc-popup" onClick={(e) => e.stopPropagation()}>
            {episodeName && (
              <div className="ep-desc-popup-title">{episodeName}</div>
            )}
            <p className="ep-desc-popup-text">{overview}</p>
            <button
              className="ep-desc-popup-close"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Injected into the webview DOM
const INJECT_SKIP_CONTROLS = `
(function() {
  if (window.__skipControlsInjected) return;
  var style = document.createElement('style');
  style.innerHTML =
    '*:focus, *:focus-visible {' +
    'outline: none !important;' +
    'box-shadow: none !important;' +
    '}' +
    'video:focus, video:focus-visible {' +
    'outline: none !important;' +
    'box-shadow: none !important;' +
    '}';
  document.head.appendChild(style);
  window.__skipControlsInjected = true;

  var BACK_SVG = '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"width:26px;height:26px\"><polyline points=\"1 4 1 10 7 10\"/><path d=\"M3.51 15a9 9 0 1 0 .49-4.53\"/><text x=\"13.5\" y=\"15.5\" text-anchor=\"middle\" font-size=\"6.5\" fill=\"currentColor\" stroke=\"none\" font-weight=\"800\" font-family=\"system-ui,sans-serif\">15</text></svg>';
  var FWD_SVG  = '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"width:26px;height:26px\"><polyline points=\"23 4 23 10 17 10\"/><path d=\"M20.49 15a9 9 0 1 1-.49-4.53\"/><text x=\"10.5\" y=\"15.5\" text-anchor=\"middle\" font-size=\"6.5\" fill=\"currentColor\" stroke=\"none\" font-weight=\"800\" font-family=\"system-ui,sans-serif\">15</text></svg>';
  var wrap = document.createElement('div');
  wrap.id = '__skip-ui';
  wrap.style.cssText = [
    'position:fixed',
    'top:0','left:0','right:0','bottom:0',
    'pointer-events:none',
    'z-index:2147483647',
    'opacity:0',
    'transition:opacity 0.25s ease',
  ].join(';');
  function makeBtn(seconds, svg, label, side) {
    var btn = document.createElement('button');
    btn.innerHTML = svg + '<span style="font-size:11px;font-family:system-ui,sans-serif">' + label + '</span>';
    btn.setAttribute('tabindex', '-1');
    btn.title = label;
    btn.style.cssText = [
      'pointer-events:auto',
      'background:rgba(0,0,0,0.72)',
      'border:1px solid rgba(255,255,255,0.18)',
      'border-radius:8px',
      'color:white',
      'cursor:pointer',
      'padding:10px 18px',
      'display:flex',
      'align-items:center',
      'gap:7px',
      'backdrop-filter:blur(6px)',
      '-webkit-backdrop-filter:blur(6px)',
      'transition:background 0.15s',
      'font-size:12px',
    ].join(';');
    btn.style.position = 'absolute';
    btn.style.top = '50%';
    btn.style.transform = 'translateY(-50%)';

    if (side === 'left') {
      btn.style.left = '24px';
    } else {
      btn.style.right = '24px';
    }
    btn.onmouseenter = function() { btn.style.background = 'rgba(229,9,20,0.85)'; btn.style.borderColor = '#e5091466'; };
    btn.onmouseleave = function() { btn.style.background = 'rgba(0,0,0,0.72)'; btn.style.borderColor = 'rgba(255,255,255,0.18)'; };
    btn.onclick = function(e) {
      e.stopPropagation();
      var v = document.querySelector('video');
      if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + seconds));
      show();
    };
    return btn;
  }

  wrap.appendChild(makeBtn(-15, BACK_SVG, '−15s', 'left'));
  wrap.appendChild(makeBtn(15,  FWD_SVG,  '+15s', 'right'));
  document.documentElement.appendChild(wrap);

  var idleTimer;
  function show() {
    wrap.style.opacity = '1';
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function() { wrap.style.opacity = '0'; }, 2500);
  }
  document.addEventListener('mousemove', show, true);
  document.addEventListener('keydown', function(e) {
    const active = document.activeElement;

    if (
      active &&
      active.matches('input, textarea, [contenteditable="true"]')
    ) {
      return;
    }

    if (e.repeat) return;

    const v = document.querySelector('video');
    if (!v) return;

    const now = Date.now();
    if (window.__skipKeyCooldown && now < window.__skipKeyCooldown) return;
    window.__skipKeyCooldown = now + 250;

    if (e.code === 'Space') {
      e.preventDefault();
      if (v.paused) v.play();
      else v.pause();
      show();
    }

    if (e.key === 'ArrowLeft') {
      v.currentTime = Math.max(0, v.currentTime - 10);
      show();
    }

    if (e.key === 'ArrowRight') {
      v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
      show();
    }
  }, true);
})();
`;

export default function TVPage({
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
}) {
  const [details, setDetails] = useState(null);
  const [seasonData, setSeasonData] = useState(null);
  const [failedSeasons, setFailedSeasons] = useState(() => new Set());
  const [selectedSeason, setSelectedSeason] = useState(() =>
    item.season != null ? Number(item.season) : 1,
  );
  const [selectedEp, setSelectedEp] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingSeason, setLoadingSeason] = useState(false);
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
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const isAsync = useMemo(() => sourceIsAsync(playerSource), [playerSource]);
  const supportsProgress = useMemo(
    () => sourceSupportsProgress(playerSource),
    [playerSource],
  );
  const progressViaFrames = useMemo(
    () => sourceProgressViaFrames(playerSource),
    [playerSource],
  );
  const [dubMode, setDubMode] = useState(
    () => storage.get("allmangaDubMode") || "sub",
  );
  const [resolvedPlayerUrl, setResolvedPlayerUrl] = useState(null);
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const [resolveError, setResolveError] = useState(null);
  const [anilistData, setAnilistData] = useState(null);
  const [anilistSeasons, setAnilistSeasons] = useState(null);
  const [anilistLoading, setAnilistLoading] = useState(false);
  const [episodeGroupData, setEpisodeGroupData] = useState(null);
  const [episodeGroupMap, setEpisodeGroupMap] = useState(null);
  const [webviewLoading, setWebviewLoading] = useState(false);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [pipOpen, setPipOpen] = useState(false);
  const pipUrlRef = useRef(null);
  const pipWebContentsIdRef = useRef(null);
  const [menuPos, setMenuPos] = useState(null);
  const [skipTimings, setSkipTimings] = useState(null);
  const [skipPrompt, setSkipPrompt] = useState(null);
  const [introSkipMode] = useState(
    () => storage.get(STORAGE_KEYS.INTRO_SKIP_MODE) || "off",
  );
  const sourceRef = useRef(null);
  const playerWrapRef = useRef(null);
  const webviewRef = useRef(null);
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;
  const onMarkWatchedRef = useRef(onMarkWatched);
  onMarkWatchedRef.current = onMarkWatched;

  const isAnime = useMemo(
    () => isAnimeContent(item, details),
    [item.id, details],
  );
  const [downloaderFolder, setDownloaderFolder] = useState(
    () => storage.get("downloaderFolder") || "",
  );
  const [epMenu, setEpMenu] = useState(null);
  const blockedResetKey = `${item.id}_s${selectedSeason}_e${selectedEp?.episode_number ?? 0}`;
  const {
    sessionTotal: blockedSession,
    alltimeTotal: blockedAlltime,
    showModal: showBlockedModal,
    setShowModal: setShowBlockedModal,
    getSessionDomains: getBlockedDomains,
  } = useBlockedStats(blockedResetKey);
  const [rating, setRating] = useState({ cert: null, minAge: null });
  const ageLimitSetting = useMemo(() => getAgeLimitSetting(storage), []);
  const ratingCountry = useMemo(() => getRatingCountry(storage), []);
  const restricted = isRestricted(rating.minAge, ageLimitSetting);
  const [seasonMenu, setSeasonMenu] = useState(null);
  const [watchedThreshold] = useState(
    () => storage.get("watchedThreshold") ?? 20,
  );
  const autoMarkedRef = useRef(false);
  const lastKnownTimeRef = useRef(0);
  const durationRef = useRef(0);
  const seekBackCooldownRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    tmdbFetch(`/tv/${item.id}`, apiKey)
      .then((d) => {
        if (!mounted) return;
        setDetails(d);
        if (item.season == null) {
          const first = d.seasons?.find((s) => s.season_number > 0) || d.seasons?.[0];
          if (first) setSelectedSeason(first.season_number);
        }
      })
      .catch(() => {
        if (mounted) setDetails(item);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [item.id, apiKey]);

  useEffect(() => {
    const groupId = EPISODE_GROUP_IDS[Number(item.id)];
    if (!groupId || !apiKey) {
      setEpisodeGroupData(null);
      setEpisodeGroupMap(null);
      return;
    }
    let mounted = true;
    fetchEpisodeGroup(groupId, apiKey)
      .then((data) => {
        if (!mounted) return;
        setEpisodeGroupData(data);
        setEpisodeGroupMap(buildEpisodeGroupMap(data));
      })
      .catch(() => {
        if (mounted) {
          setEpisodeGroupData(null);
          setEpisodeGroupMap(null);
        }
      });
    return () => {
      mounted = false;
    };
  }, [item.id, apiKey]);

  useEffect(() => {
    let mounted = true;
    tmdbFetch(`/tv/${item.id}/videos`, apiKey)
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

  useEffect(() => {
    let mounted = true;
    fetchTVRating(item.id, apiKey, ratingCountry).then((r) => {
      if (mounted) setRating(r);
    });
    return () => {
      mounted = false;
    };
  }, [item.id, apiKey, ratingCountry]);

  const tmdbSeasons = useMemo(() => {
    if (!details?.seasons) return [];
    return details.seasons.filter((s) => s.season_number > 0);
  }, [details?.seasons]);

  useEffect(() => {
    if (!apiKey || !item.id) return;
    if (episodeGroupData) {
      setSelectedEp(null);
      setPlaying(false);
      setSeasonData(null);
      setLoadingSeason(false);
      return;
    }
    setLoadingSeason(true);
    setSelectedEp(null);
    setPlaying(false);
    setSeasonData(null);
    const tmdbSeasonToFetch = isAnime && anilistSeasons?.length > 0 && tmdbSeasons.length <= 1 ? 1 : selectedSeason;
    let mounted = true;
    tmdbFetch(`/tv/${item.id}/season/${tmdbSeasonToFetch}`, apiKey)
      .then((d) => {
        if (mounted) setSeasonData(d);
      })
      .catch(() => {
        if (mounted) {
          setSeasonData(null);
          if (tmdbSeasonToFetch !== 1) {
            setFailedSeasons((prev) => {
              const next = new Set(prev);
              next.add(tmdbSeasonToFetch);
              return next;
            });
          }
        }
      })
      .finally(() => {
        if (mounted) setLoadingSeason(false);
      });
    return () => {
      mounted = false;
    };
  }, [item.id, selectedSeason, apiKey, episodeGroupData, isAnime, anilistSeasons, tmdbSeasons.length]);

  useEffect(() => {
    setM3u8Url(null);
    setInterceptedSubs([]);
    setShowSourceMenu(false);
    setResolvedPlayerUrl(null);
    setResolvingUrl(false);
    setResolveError(null);
    if (selectedEp) {
      setWebviewLoading(true);
    }
  }, [item.id, selectedSeason, selectedEp, playerSource, dubMode]);

  useEffect(() => {
    let mounted = true;
    if (isAnime) {
      setAnilistLoading(true);
      fetchAnilistData(item.title || item.name, "TV", item.id)
        .then((data) => {
          if (!mounted) return;
          setAnilistData(data);
          if (data) {
            const virtualSeasons = buildAnilistSeasons(data, tmdbSeasons);
            setAnilistSeasons(virtualSeasons);
            if (item.season == null && virtualSeasons.length > 0) {
              setSelectedSeason(virtualSeasons[0].seasonNum);
            }
          } else {
            setAnilistSeasons(null);
          }
        })
        .catch(() => {
          if (mounted) setAnilistSeasons(null);
        })
        .finally(() => {
          if (mounted) setAnilistLoading(false);
        });

      const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (!currentSrc?.tag) {
        const saved = storage.get("playerSource");
        const savedSrc = PLAYER_SOURCES.find((s) => s.id === saved);
        setPlayerSource(savedSrc?.tag ? saved : ANIME_DEFAULT_SOURCE);
      }
    } else {
      setAnilistData(null);
      setAnilistSeasons(null);
      setAnilistLoading(false);
      const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (currentSrc?.tag) {
        const saved = storage.get("playerSource");
        const savedSrc = PLAYER_SOURCES.find((s) => !s.tag && s.id === saved);
        setPlayerSource(savedSrc ? saved : NON_ANIME_DEFAULT_SOURCE);
      }
    }
    return () => {
      mounted = false;
    };
  }, [item.id, isAnime, tmdbSeasons]);

  const currentVirtualSeason = useMemo(() => {
    if (!isAnime || !anilistSeasons) return null;
    return anilistSeasons.find((s) => s.seasonNum === selectedSeason) || null;
  }, [isAnime, anilistSeasons, selectedSeason]);

  const finalEpisodes = useMemo(() => {
    if (episodeGroupMap) {
      return episodeGroupMap[selectedSeason] || [];
    }
    if (currentVirtualSeason) {
      return currentVirtualSeason.episodes;
    }
    return seasonData?.episodes || [];
  }, [seasonData, currentVirtualSeason, episodeGroupMap, selectedSeason]);

  useEffect(() => {
    if (playerSource !== "allmanga" || !playing || !selectedEp || !details) return;
    let mounted = true;
    setResolvingUrl(true);
    setResolveError(null);
    const titleToUse = anilistData?.title?.romaji || details.name || details.title;
    const epNum = selectedEp.episode_number;
    const releaseYear = (details.first_air_date || "").slice(0, 4);

    getSourceUrl("allmanga", details.id, "tv", titleToUse, releaseYear, dubMode, selectedSeason, epNum, currentVirtualSeason)
      .then((url) => {
        if (!mounted) return;
        if (url) {
          setResolvedPlayerUrl(url);
        } else {
          setResolveError(`Could not find Episode ${epNum} on AllManga.`);
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
  }, [playerSource, playing, selectedEp, details, anilistData, dubMode, selectedSeason, currentVirtualSeason]);

  useEffect(() => {
    if (!selectedEp || !anilistData?.id) {
      setSkipTimings(null);
      return;
    }
    let mounted = true;
    const virtualEpNum = currentVirtualSeason
      ? currentVirtualSeason.startAbsoluteNum + (selectedEp.episode_number - 1)
      : selectedEp.episode_number;

    fetchAniSkipTimings(anilistData.id, virtualEpNum)
      .then((timings) => {
        if (mounted) setSkipTimings(timings);
      })
      .catch(() => {
        if (mounted) setSkipTimings(null);
      });
    return () => {
      mounted = false;
    };
  }, [selectedEp, anilistData, currentVirtualSeason]);

  useLayoutEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !playing || !selectedEp || !progressViaFrames) return;
    const pk = `tv_${item.id}_s${selectedSeason}_e${selectedEp.episode_number}`;

    const handleIPC = (e) => {
      if (e.channel === "player-timeupdate") {
        const [currentTime, duration] = e.args;
        if (typeof currentTime === "number" && typeof duration === "number" && duration > 0) {
          durationRef.current = duration;
          const currentPct = Math.floor((currentTime / duration) * 100);
          const now = Date.now();
          if (currentTime < lastKnownTimeRef.current - 15 && now > seekBackCooldownRef.current) {
            wv.executeJavaScript(`
              (function() {
                var v = document.querySelector('video');
                if (v) v.currentTime = ${lastKnownTimeRef.current};
              })();
            `).catch(() => {});
            seekBackCooldownRef.current = now + 4000;
          } else {
            lastKnownTimeRef.current = currentTime;
          }

          if (skipTimings) {
            let insideIntro = false;
            if (skipTimings.intro && currentTime >= skipTimings.intro.startTime && currentTime <= skipTimings.intro.endTime) {
              insideIntro = true;
              if (introSkipMode === "auto") {
                wv.executeJavaScript(`(function(){ var v=document.querySelector('video'); if(v) v.currentTime=${skipTimings.intro.endTime}; })();`).catch(() => {});
              } else if (introSkipMode === "btn") {
                setSkipPrompt("intro");
              }
            }
            let insideOutro = false;
            if (skipTimings.outro && currentTime >= skipTimings.outro.startTime && currentTime <= skipTimings.outro.endTime) {
              insideOutro = true;
              setSkipPrompt("outro");
            }
            if (!insideIntro && !insideOutro) {
              setSkipPrompt(null);
            }
          }

          storage.set("dlTime_" + pk, currentTime);
          if (currentPct >= 0 && currentPct <= 100) {
            saveProgressRef.current(pk, currentPct);
            if (watchedThreshold > 0 && currentTime >= duration - watchedThreshold && !autoMarkedRef.current) {
              autoMarkedRef.current = true;
              onMarkWatchedRef.current(pk);
            }
          }
        }
      }
    };
    wv.addEventListener("ipc-message", handleIPC);
    return () => {
      wv.removeEventListener("ipc-message", handleIPC);
    };
  }, [playing, selectedEp, progressViaFrames, item.id, selectedSeason, skipTimings, introSkipMode, watchedThreshold]);

  const handleDomReady = useCallback(() => {
    setWebviewLoading(false);
    const wv = webviewRef.current;
    if (!wv) return;
    wv.executeJavaScript(INJECT_SKIP_CONTROLS).catch(() => {});
  }, []);

  const handleSkipPromptClick = useCallback(() => {
    const wv = webviewRef.current;
    if (!wv || !skipTimings || !skipPrompt) return;
    const targetTime = skipPrompt === "intro" ? skipTimings.intro?.endTime : skipTimings.outro?.endTime;
    if (typeof targetTime === "number") {
      wv.executeJavaScript(`(function(){ var v=document.querySelector('video'); if(v) v.currentTime=${targetTime}; })();`)
        .then(() => setSkipPrompt(null))
        .catch(() => {});
    }
  }, [skipTimings, skipPrompt]);

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
    if (!selectedEp) return null;
    if (playerSource === "allmanga") return resolvedPlayerUrl;
    const epNum = selectedEp.episode_number;
    const tmdbSeasonToUse = isAnime && anilistSeasons?.length > 0 && tmdbSeasons.length <= 1 ? 1 : selectedSeason;
    return getSourceUrl(playerSource, item.id, "tv", tmdbSeasonToUse, epNum);
  }, [playerSource, item.id, selectedSeason, selectedEp, resolvedPlayerUrl, isAnime, anilistSeasons, tmdbSeasons.length]);

  useEffect(() => {
    if (!playing || !NEEDS_INTERCEPT(playerSource)) return;
    const unsubscribe = window.electron.onM3u8Intercepted((data) => {
      if (data.url) setM3u8Url(data.url);
      if (data.subtitles) setInterceptedSubs(data.subtitles);
    });
    return () => unsubscribe();
  }, [playing, playerSource]);

  const startEpisode = useCallback((ep) => {
    if (restricted) return;
    setM3u8Url(null);
    setInterceptedSubs([]);
    setResolvedPlayerUrl(null);
    setResolvingUrl(false);
    setResolveError(null);
    setSkipPrompt(null);
    autoMarkedRef.current = false;
    lastKnownTimeRef.current = 0;
    durationRef.current = 0;
    seekBackCooldownRef.current = 0;
    setSelectedEp(ep);
    setPlaying(true);
    onHistory?.({
      ...item,
      media_type: "tv",
      season: selectedSeason,
      episode: ep.episode_number,
    });
  }, [restricted, onHistory, item, selectedSeason]);

  const handleSourceSelect = useCallback((srcId) => {
    setPlayerSource(srcId);
    storage.set("playerSource", srcId);
    setShowSourceMenu(false);
  }, []);

  const triggerPopOut = useCallback(() => {
    const wv = webviewRef.current;
    if (!wv || !selectedEp) return;
    try {
      const currentUrl = wv.getURL();
      if (!currentUrl || currentUrl === "about:blank") return;
      pipUrlRef.current = currentUrl;
      const combinedId = `${item.id}_s${selectedSeason}e${selectedEp.episode_number}`;
      window.electron.openPipWindow(currentUrl, combinedId);
    } catch (e) {}
  }, [item.id, selectedSeason, selectedEp]);

  const closePlayer = useCallback(() => {
    setPlaying(false);
    setSelectedEp(null);
    setM3u8Url(null);
    setInterceptedSubs([]);
    setResolvedPlayerUrl(null);
    setResolvingUrl(false);
    setResolveError(null);
    setSkipPrompt(null);
    autoMarkedRef.current = false;
    lastKnownTimeRef.current = 0;
    durationRef.current = 0;
    seekBackCooldownRef.current = 0;
    if (pipOpen && pipWebContentsIdRef.current) {
      window.electron?.closePipWindow?.(pipWebContentsIdRef.current);
      setPipOpen(false);
      pipWebContentsIdRef.current = null;
    }
  }, [pipOpen]);

  const onMarkSeasonWatched = useCallback((seasonNum, eps) => {
    eps.forEach((ep) => {
      const pk = `tv_${item.id}_s${seasonNum}_e${ep.episode_number}`;
      onMarkWatched(pk);
    });
  }, [item.id, onMarkWatched]);

  const onMarkSeasonUnwatched = useCallback((seasonNum, eps) => {
    eps.forEach((ep) => {
      const pk = `tv_${item.id}_s${seasonNum}_e${ep.episode_number}`;
      onMarkUnwatched(pk);
      storage.remove("dlTime_" + pk);
      saveProgress(pk, 0);
    });
  }, [item.id, onMarkUnwatched, saveProgress]);

  if (loading || (!details && !episodeGroupData)) {
    return (
      <div className="page-loading">
        <div className="spinner" />
      </div>
    );
  }

  const d = details || item;
  const title = d.name || d.title;
  const year = (d.first_air_date || "").slice(0, 4);
  const mediaName = selectedEp
    ? `${title} - S${String(selectedSeason).padStart(2, "0")}E${String(selectedEp.episode_number).padStart(2, "0")}`
    : title;
  const backdrop = imgUrl(d.backdrop_path, "original");

  const availableSeasons = episodeGroupData
    ? episodeGroupData.groups.map((g) => ({ seasonNum: g.order + 1, name: g.name }))
    : isAnime && anilistSeasons?.length > 0
      ? anilistSeasons.map((s) => ({ seasonNum: s.seasonNum, name: s.title }))
      : tmdbSeasons.map((s) => ({ seasonNum: s.season_number, name: s.name }));

  return (
    <div className="media-page tv-page">
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
        {playing && selectedEp ? (
          <div ref={playerWrapRef} className={`player-wrapper ${playerFullscreen ? "fullscreen" : ""}`}>
            {resolvingUrl ? (
              <div className="player-loader">
                <div className="spinner" />
                <p>Resolving AllManga Stream URL…</p>
              </div>
            ) : resolveError ? (
              <div className="player-loader error-box">
                <p>{resolveError}</p>
                <button className="btn" onClick={closePlayer}>Close Player</button>
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
                {skipPrompt && (
                  <button className="aniskip-prompt-btn" onClick={handleSkipPromptClick}>
                    Skip {skipPrompt === "intro" ? "Intro" : "Outro"} →
                  </button>
                )}
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
                <button className="btn close-p-btn" onClick={closePlayer}>Close Player</button>
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
                <span className="player-now-playing-title">
                  S{selectedSeason}E{selectedEp.episode_number}: {selectedEp.name}
                </span>
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
              {d.poster_path ? (
                <img src={imgUrl(d.poster_path, "w500")} alt={title} className="main-poster" />
              ) : (
                <div className="no-poster"><TVIcon /></div>
              )}
            </div>
            <div className="info-column">
              <h1 className="media-title">{title}</h1>
              <div className="metadata-row">
                {year && <span className="meta-item year-tag">{year}</span>}
                {availableSeasons.length > 0 && (
                  <span className="meta-item seasons-count-tag">
                    {availableSeasons.length} {availableSeasons.length === 1 ? "Season" : "Seasons"}
                  </span>
                )}
                {d.vote_average ? (
                  <span className="meta-item rating-tag">
                    <StarIcon /> {d.vote_average.toFixed(1)}
                  </span>
                ) : null}
                {rating.cert && <span className="meta-item certification-badge">{rating.cert}</span>}
                {anilistLoading && <span className="meta-item loading-mini-tag">AniList Syncing…</span>}
              </div>

              {restricted && (
                <div className="age-lock-notice-box">
                  <RatingLockIcon />
                  <div>
                    <h4>Content Locked ({rating.cert})</h4>
                    <p>This show exceeds your age restriction filter profile limit.</p>
                  </div>
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

        {!restricted && !playing && (
          <div className="tv-episodes-section">
            <div className="seasons-nav-container">
              <div className="seasons-tabs-scroller">
                {availableSeasons.map((s) => {
                  const isFailed = failedSeasons.has(s.seasonNum);
                  if (isFailed) return null;
                  return (
                    <button
                      key={s.seasonNum}
                      className={`season-tab-btn ${selectedSeason === s.seasonNum ? "active" : ""}`}
                      onClick={() => {
                        setSelectedSeason(s.seasonNum);
                        setSeasonData(null);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setSeasonMenu({ x: e.clientX, y: e.clientY, seasonNum: s.seasonNum });
                      }}
                    >
                      {s.name || `Season ${s.seasonNum}`}
                    </button>
                  );
                })}
              </div>
            </div>

            {loadingSeason ? (
              <div className="season-loading-box">
                <div className="spinner" />
              </div>
            ) : finalEpisodes.length > 0 ? (
              <div className="episodes-list-layout">
                {finalEpisodes.map((ep) => {
                  const pk = `tv_${item.id}_s${selectedSeason}_e${ep.episode_number}`;
                  const epPct = progress[pk] || 0;
                  const epWatched = !!watched?.[pk];
                  const epHasProgress = epPct > 0;
                  const epDownload = downloads?.find((d) => d.mediaId === item.id && d.mediaType === "tv" && d.meta?.season === selectedSeason && d.meta?.episode === ep.episode_number);

                  let progressIcon = null;
                  if (epPct > 0 && epPct < 95) {
                    const tier = epPct >= 75 ? 75 : epPct >= 50 ? 50 : 25;
                    progressIcon = <PartialCircleIcon pct={tier} />;
                  }

                  return (
                    <div
                      key={ep.id || ep.episode_number}
                      className={`episode-row-card ${epWatched ? "watched" : ""} ${epHasProgress ? "has-progress" : ""}`}
                      onClick={() => startEpisode(ep)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setEpMenu({ x: e.clientX, y: e.clientY, pk, ep });
                      }}
                    >
                      <div className="episode-number-badge">
                        {progressIcon}
                        <span>Ep {ep.episode_number}</span>
                      </div>
                      <div className="episode-thumbnail-wrap">
                        {ep.still_path ? (
                          <img src={imgUrl(ep.still_path, "w300")} alt="" loading="lazy" />
                        ) : (
                          <div className="no-thumb"><PlayIcon /></div>
                        )}
                        {epDownload && (
                          <span
                            className="ep-downloaded-badge"
                            title={
                              epDownload.status === "downloading"
                                ? "Downloading… - click to view in Downloads"
                                : "Downloaded - click to view in Downloads"
                            }
                            style={{
                              borderColor:
                                epDownload.status === "downloading"
                                  ? "rgba(229,9,20,0.5)"
                                  : "rgba(72,199,116,0.5)",
                              color:
                                epDownload.status === "downloading"
                                  ? "var(--red)"
                                  : "#4caf50",
                              background:
                                epDownload.status === "downloading"
                                  ? "rgba(229,9,20,0.12)"
                                  : "rgba(72,199,116,0.18)",
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onGoToDownloads?.(epDownload.id);
                            }}
                          >
                            ↓
                          </span>
                        )}
                      </div>
                      <div className="episode-name">{ep.name}</div>
                      <EpisodeDesc overview={ep.overview} episodeName={ep.name} />
                      {!epWatched && epPct > 0 && (
                        <div className="episode-progress-bar">
                          <div
                            className="episode-progress-fill"
                            style={{ width: `${Math.min(epPct, 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="no-episodes-box">
                <p>No episodes found for this season.</p>
              </div>
            )}
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

      {showDownload && selectedEp && (
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
          mediaType="tv"
          posterPath={d.poster_path}
          tmdbId={item.id}
          seasonNumber={selectedSeason}
          episodeNumber={selectedEp.episode_number}
        />
      )}

      {epMenu && (
        <ContextMenu
          x={epMenu.x}
          y={epMenu.y}
          isWatched={!!watched?.[epMenu.pk]}
          hasProgress={(progress[epMenu.pk] || 0) > 0}
          watchedLabel="Mark Episode as Watched"
          unwatchedLabel="Mark Episode as Unwatched"
          onMarkWatched={() => onMarkWatched(epMenu.pk)}
          onMarkUnwatched={() => {
            onMarkUnwatched(epMenu.pk);
            storage.remove("dlTime_" + epMenu.pk);
            saveProgress(epMenu.pk, 0);
          }}
          onMarkNotStarted={() => {
            storage.remove("dlTime_" + epMenu.pk);
            saveProgress(epMenu.pk, 0);
          }}
          onClose={() => setEpMenu(null)}
        />
      )}

      {seasonMenu && (
        <ContextMenu
          x={seasonMenu.x}
          y={seasonMenu.y}
          isWatched={false}
          hasProgress={false}
          watchedLabel="Mark Entire Season as Watched"
          unwatchedLabel="Mark Entire Season as Unwatched"
          onMarkWatched={() => onMarkSeasonWatched(seasonMenu.seasonNum, finalEpisodes)}
          onMarkUnwatched={() => onMarkSeasonUnwatched(seasonMenu.seasonNum, finalEpisodes)}
          onClose={() => setSeasonMenu(null)}
        />
      )}
    </div>
  );
}