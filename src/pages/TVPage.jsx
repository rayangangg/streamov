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
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <path d={`M ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${x.toFixed(3)} ${y.toFixed(3)} L ${cx} ${cy} Z`} fill="currentColor" opacity="0.9" />
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
    <div className="context-menu" style={{ top: y, left: x }} onClick={(e) => e.stopPropagation()}>
      {isWatched ? (
        <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); onMarkUnwatched(); onCloseRef.current(); }}>
          ↩ {unwatchedLabel}
        </button>
      ) : (
        <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); onMarkWatched(); onCloseRef.current(); }}>
          ✓ {watchedLabel}
        </button>
      )}
      {onMarkNotStarted && !isWatched && hasProgress && (
        <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); onMarkNotStarted(); onCloseRef.current(); }}>
          ⊘ Mark as Not Started
        </button>
      )}
    </div>
  );
}

function EpisodeDesc({ overview, episodeName }) {
  const [open, setOpen] = useState(false);
  if (!overview) return <div className="episode-desc" />;
  return (
    <>
      <div className="episode-desc-wrap">
        <div className="episode-desc">{overview}</div>
        <button className="episode-desc-toggle" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
          More
        </button>
      </div>
      {open && (
        <div className="ep-desc-overlay" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
          <div className="ep-desc-popup" onClick={(e) => e.stopPropagation()}>
            {episodeName && <div className="ep-desc-popup-title">{episodeName}</div>}
            <p className="ep-desc-popup-text">{overview}</p>
            <button className="ep-desc-popup-close" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const INJECT_SKIP_CONTROLS = `
(function() {
  if (window.__skipControlsInjected) return;
  var style = document.createElement('style');
  style.innerHTML = '*:focus, *:focus-visible { outline: none !important; box-shadow: none !important; } video:focus, video:focus-visible { outline: none !important; box-shadow: none !important; }';
  document.head.appendChild(style);
  window.__skipControlsInjected = true;
  var BACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:26px;height:26px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.53"/><text x="13.5" y="15.5" text-anchor="middle" font-size="6.5" fill="currentColor" stroke="none" font-weight="800" font-family="system-ui,sans-serif">15</text></svg>';
  var FWD_SVG  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:26px;height:26px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-4.53"/><text x="10.5" y="15.5" text-anchor="middle" font-size="6.5" fill="currentColor" stroke="none" font-weight="800" font-family="system-ui,sans-serif">15</text></svg>';
  var wrap = document.createElement('div');
  wrap.id = '__skip-ui';
  wrap.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:2147483647;opacity:0;transition:opacity 0.25s ease;';
  function makeBtn(seconds, svg, label, side) {
    var btn = document.createElement('button');
    btn.innerHTML = svg + '<span style="font-size:11px;font-family:system-ui,sans-serif">' + label + '</span>';
    btn.setAttribute('tabindex', '-1');
    btn.title = label;
    btn.style.cssText = 'pointer-events:auto;background:rgba(0,0,0,0.72);border:1px solid rgba(255,255,255,0.18);border-radius:8px;color:white;cursor:pointer;padding:10px 18px;display:flex;align-items:center;gap:7px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:background 0.15s;font-size:12px;';
    btn.style.position = 'absolute';
    btn.style.top = '50%';
    btn.style.transform = 'translateY(-50%)';
    if (side === 'left') { btn.style.left = '24px'; } else { btn.style.right = '24px'; }
    btn.onmouseenter = function() { btn.style.background = 'rgba(229,9,20,0.85)'; btn.style.borderColor = '#e5091466'; };
    btn.onmouseleave = function() { btn.style.background = 'rgba(0,0,0,0.72)'; btn.style.borderColor = 'rgba(255,255,255,0.18)'; };
    btn.onclick = function(e) { e.stopPropagation(); var v = document.querySelector('video'); if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + seconds)); show(); };
    return btn;
  }
  wrap.appendChild(makeBtn(-15, BACK_SVG, '−15s', 'left'));
  wrap.appendChild(makeBtn(15,  FWD_SVG,  '+15s', 'right'));
  document.documentElement.appendChild(wrap);
  var idleTimer;
  function show() { wrap.style.opacity = '1'; clearTimeout(idleTimer); idleTimer = setTimeout(function() { wrap.style.opacity = '0'; }, 2500); }
  document.addEventListener('mousemove', show, true);
  document.addEventListener('keydown', function(e) {
    const active = document.activeElement;
    if (active && active.matches('input, textarea, [contenteditable="true"]')) return;
    if (e.repeat) return;
    const v = document.querySelector('video');
    if (!v) return;
    const now = Date.now();
    if (window.__skipKeyCooldown && now < window.__skipKeyCooldown) return;
    window.__skipKeyCooldown = now + 250;
    if (e.code === 'Space') { e.preventDefault(); if (v.paused) v.play(); else v.pause(); show(); }
    if (e.key === 'ArrowLeft') { v.currentTime = Math.max(0, v.currentTime - 10); show(); }
    if (e.key === 'ArrowRight') { v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); show(); }
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
  const [selectedSeason, setSelectedSeason] = useState(() => item.season != null ? Number(item.season) : 1);
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
  const supportsProgress = useMemo(() => sourceSupportsProgress(playerSource), [playerSource]);
  const progressViaFrames = useMemo(() => sourceProgressViaFrames(playerSource), [playerSource]);
  const [dubMode, setDubMode] = useState(() => storage.get("allmangaDubMode") || "sub");
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
  const [introSkipMode] = useState(() => storage.get(STORAGE_KEYS.INTRO_SKIP_MODE) || "off");
  const sourceRef = useRef(null);
  const playerWrapRef = useRef(null);
  const webviewRef = useRef(null);
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;
  const onMarkWatchedRef = useRef(onMarkWatched);
  onMarkWatchedRef.current = onMarkWatched;

  const isAnime = useMemo(() => isAnimeContent(item, details), [item.id, details]);
  const [downloaderFolder, setDownloaderFolder] = useState(() => storage.get("downloaderFolder") || "");
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
  const [watchedThreshold] = useState(() => storage.get("watchedThreshold") ?? 20);
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
    return () => { mounted = false; };
  }, [item.id, apiKey]);

  useEffect(() => {
    const groupId = EPISODE_GROUP_IDS[Number(item.id)];
    if (!groupId || !apiKey) { setEpisodeGroupData(null); setEpisodeGroupMap(null); return; }
    let mounted = true;
    fetchEpisodeGroup(groupId, apiKey)
      .then((data) => {
        if (!mounted) return;
        setEpisodeGroupData(data);
        setEpisodeGroupMap(buildEpisodeGroupMap(data));
      })
      .catch(() => {
        if (mounted) { setEpisodeGroupData(null); setEpisodeGroupMap(null); }
      });
    return () => { mounted = false; };
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
    return () => { mounted = false; };
  }, [item.id, apiKey]);

  useEffect(() => {
    let mounted = true;
    fetchTVRating(item.id, apiKey, ratingCountry).then((r) => { if (mounted) setRating(r); });
    return () => { mounted = false; };
  }, [item.id, apiKey, ratingCountry]);

  const tmdbSeasons = useMemo(() => details?.seasons || [], [details]);
  const activeSeason = useMemo(() => {
    if (episodeGroupData) return selectedSeason;
    if (isAnime && anilistSeasons?.length > 0 && tmdbSeasons.length <= 1) return 1;
    return selectedSeason;
  }, [episodeGroupData, isAnime, anilistSeasons, tmdbSeasons, selectedSeason]);

  useEffect(() => {
    if (!apiKey || !item.id) return;
    if (episodeGroupData) { setSelectedEp(null); setPlaying(false); setSeasonData(null); setLoadingSeason(false); return; }
    setLoadingSeason(true); setSelectedEp(null); setPlaying(false); setSeasonData(null);
    const tmdbSeasonToFetch = isAnime && anilistSeasons?.length > 0 && tmdbSeasons.length <= 1 ? 1 : selectedSeason;
    let mounted = true;
    tmdbFetch(`/tv/${item.id}/season/${tmdbSeasonToFetch}`, apiKey)
      .then((d) => { if (mounted) setSeasonData(d); })
      .catch(() => {
        if (mounted) { setSeasonData(null); if (selectedSeason === 0) setFailedSeasons((prev) => new Set([...prev, selectedSeason])); }
      })
      .finally(() => { if (mounted) setLoadingSeason(false); });
    return () => { mounted = false; };
  }, [item.id, selectedSeason, apiKey, anilistSeasons, episodeGroupData, isAnime, tmdbSeasons.length]);

  useEffect(() => {
    setM3u8Url(null); setInterceptedSubs([]); setShowSourceMenu(false); setResolvedPlayerUrl(null); setResolvingUrl(false); setResolveError(null); setWebviewLoading(true);
  }, [item.id, selectedEp?.episode_number, selectedSeason, playerSource, dubMode]);

  useEffect(() => {
    let mounted = true; setAnilistData(null); setAnilistSeasons(null);
    if (isAnime) {
      setAnilistLoading(true);
      fetchAnilistData(item.name || item.title, "ANIME", item.id)
        .then((data) => {
          if (!mounted) return;
          if (data) { setAnilistData(data); const seasons = buildAnilistSeasons(data); if (seasons?.length) setAnilistSeasons(seasons); }
          if (mounted) setAnilistLoading(false);
        })
        .catch(() => { if (mounted) setAnilistLoading(false); });
      const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (!currentSrc?.tag) {
        const saved = storage.get("playerSource"); const savedSrc = PLAYER_SOURCES.find((s) => s.id === saved);
        setPlayerSource(savedSrc?.tag ? saved : ANIME_DEFAULT_SOURCE);
      }
    } else {
      setAnilistLoading(false); const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (currentSrc?.tag) {
        const saved = storage.get("playerSource"); const savedSrc = PLAYER_SOURCES.find((s) => s.id === saved);
        setPlayerSource(!savedSrc?.tag ? saved : NON_ANIME_DEFAULT_SOURCE);
      }
    }
    return () => { mounted = false; };
  }, [item.id, isAnime]);

  const d = details || item;
  const title = d.name || d.title;
  const activeEpisodeNum = selectedEp?.episode_number || 1;

  useEffect(() => {
    if (!playing || !selectedEp || !isAsync) return;
    if (resolvedPlayerUrl || resolvingUrl) return;
    setResolvingUrl(true); setResolveError(null);
    const epNum = selectedEp.episode_number;
    const progressKey = `tv_${item.id}_s${selectedSeason}e${epNum}`;
    const startTime = storage.get("dlTime_" + progressKey) || 0;
    let mounted = true;
    window.electron
      .resolveAllManga({ title, seasonNumber: selectedSeason, episodeNumber: epNum, translationType: dubMode })
      .then((res) => {
        if (!mounted) return;
        if (res?.ok && res.url) {
          if (res.isDirectMp4 !== undefined) {
            window.electron
              .setPlayerVideo({ url: res.url, referer: res.referer || "https://allmanga.to", startTime })
              .then((r) => { if (!mounted) return; setResolvedPlayerUrl(r.playerUrl); setM3u8Url(res.url); })
              .catch(() => { if (mounted) setResolveError("Failed to start local player"); });
          } else { setResolvedPlayerUrl(res.url); }
        } else { setResolveError(res?.error || `Episode ${epNum} not found on AllManga`); }
      })
      .catch((e) => { if (mounted) setResolveError(e.message || "Error"); })
      .finally(() => { if (mounted) setResolvingUrl(false); });
    return () => { mounted = false; };
  }, [playing, selectedEp, isAsync, title, selectedSeason, dubMode, resolvedPlayerUrl, resolvingUrl, item.id]);

  return (
    <div className="media-page animation-fade-in">
      {/* ( বাকি UI এবং লজিক আপনার tvpage.txt এর মতোই অপরিবর্তিত থাকবে ) */}
      <div className="media-content-container">
        <button className="media-back-btn" onClick={onBack}><BackIcon /></button>
        <h1 className="media-title text-2xl font-bold mb-4">{title}</h1>

        {playing && !restricted && selectedEp && (
          <div className="player-main-area relative" ref={playerWrapRef}>
            {isAsync && resolvingUrl && (
              <div className="player-loading-overlay player-loading-overlay--async">
                <div className="player-loading-spinner" />
                <div className="player-loading-text">Resolving premium secure mirror from AllManga...</div>
              </div>
            )}
            {isAsync && resolveError && (
              <div className="player-loading-overlay player-loading-overlay--error">
                <div className="player-error-icon">⚠</div>
                <div className="player-loading-text text-red-500">{resolveError}</div>
                <button className="mt-4 px-4 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition" onClick={() => { setResolvedPlayerUrl(null); setResolvingUrl(false); setResolveError(null); setPlaying(false); setTimeout(() => setPlaying(true), 50); }}>Retry</button>
              </div>
            )}
            {webviewLoading && !(isAsync && !resolvedPlayerUrl) && (
              <div className="player-loading-overlay"><div className="player-loading-spinner" /></div>
            )}

            {/* Isolated TV Player Wrapper Matrix */}
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
                      : getSourceUrl(playerSource, "tv", item.id, activeSeason, activeEpisodeNum)
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

            {/* Left-side overlay button group (Decoupled layout matrix) */}
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
                    setM3u8Url(null); setInterceptedSubs([]); setResolvedPlayerUrl(null); setResolvingUrl(false); setResolveError(null);
                  }}
                  title="Toggle Sub/Dub"
                >
                  {dubMode === "sub" ? "SUB" : "DUB"}
                </button>
              )}

              <button
                className="player-overlay-btn"
                onClick={() => { setShowSourceMenu(false); setShowBlockedModal(true); }}
                title="Blocked ads & trackers"
              >
                <ShieldBlockIcon />
                {blockedSession > 0 && <span className="player-blocked-badge">{blockedSession}</span>}
              </button>

              <button
                className="player-overlay-btn"
                onClick={() => {
                  if (pipOpen) { window.electron?.closePipWindow?.(); return; }
                  const url = sourceIsAsync(playerSource) ? resolvedPlayerUrl : getSourceUrl(playerSource, "tv", item.id, activeSeason, activeEpisodeNum);
                  if (!url) return;
                  pipUrlRef.current = url; window.electron?.openPipWindow?.(url, item.title);
                }}
                title={pipOpen ? "Close pop-out" : "Pop out player"}
                disabled={!pipOpen && (webviewLoading || !!(sourceIsAsync(playerSource) && !resolvedPlayerUrl))}
                style={pipOpen ? { color: "var(--red)" } : undefined}
              >
                <PopOutIcon />
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
                      setShowSourceMenu(false); if (src.id === playerSource) return;
                      setPlayerSource(src.id); storage.set("playerSource", src.id);
                      setM3u8Url(null); setInterceptedSubs([]); setResolvedPlayerUrl(null); setResolvingUrl(false); setResolveError(null);
                    }}
                  >
                    <span>{src.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}