import React, { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";

/**
 * Premium HTML5 player for DIRECT stream URLs (m3u8 / mp4).
 * Cannot wrap cross-origin third-party iframes — same-origin policy.
 *
 * Props:
 *   src            : string  (m3u8 or mp4 URL)
 *   poster         : string?
 *   subtitles      : [{ url, lang, label, default? }]
 *   autoPlay       : boolean
 *   onEnded        : fn
 *   className      : string?
 */
export default function CustomPlayer({
  src,
  poster,
  subtitles = [],
  autoPlay = true,
  onEnded,
  className = "",
}) {
  const videoRef = useRef(null);
  const wrapRef = useRef(null);
  const hlsRef = useRef(null);
  const hideTimer = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [levels, setLevels] = useState([]); // [{height, index}]
  const [currentLevel, setCurrentLevel] = useState(-1); // -1 = auto
  const [speed, setSpeed] = useState(1);
  const [showCtrl, setShowCtrl] = useState(true);
  const [isFs, setIsFs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeSub, setActiveSub] = useState(-1);

  // ── HLS attach ─────────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const isM3u8 = /\.m3u8(\?|$)/i.test(src);
    if (isM3u8 && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const lvls = hls.levels.map((l, i) => ({ height: l.height, index: i }));
        setLevels(lvls);
        if (autoPlay) video.play().catch(() => {});
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        setCurrentLevel(hls.autoLevelEnabled ? -1 : data.level);
      });
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }

    // Native (Safari m3u8 or mp4)
    video.src = src;
    if (autoPlay) video.play().catch(() => {});
    return () => {
      video.removeAttribute("src");
      video.load();
    };
  }, [src, autoPlay]);

  // ── Video events ───────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      setCurrent(v.currentTime);
      if (v.buffered.length)
        setBuffered(v.buffered.end(v.buffered.length - 1));
    };
    const onDur = () => setDuration(v.duration || 0);
    const onVol = () => {
      setMuted(v.muted);
      setVolume(v.volume);
    };
    const onEnd = () => onEnded?.();
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("volumechange", onVol);
    v.addEventListener("ended", onEnd);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("volumechange", onVol);
      v.removeEventListener("ended", onEnd);
    };
  }, [onEnded]);

  // ── Fullscreen state ───────────────────────────────────────────────────
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // ── Auto-hide controls ─────────────────────────────────────────────────
  const ping = useCallback(() => {
    setShowCtrl(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!videoRef.current?.paused) setShowCtrl(false);
    }, 3000);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  // ── Controls ───────────────────────────────────────────────────────────
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play() : v.pause();
  };
  const seek = (t) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, Math.min(duration, t));
  };
  const skip = (delta) => seek((videoRef.current?.currentTime || 0) + delta);
  const setVol = (val) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = val;
    v.muted = val === 0;
  };
  const toggleMute = () => {
    const v = videoRef.current;
    if (v) v.muted = !v.muted;
  };
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrapRef.current?.requestFullscreen?.();
  };
  const togglePip = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {}
  };
  const setQuality = (idx) => {
    if (!hlsRef.current) return;
    hlsRef.current.currentLevel = idx; // -1 = auto
    setCurrentLevel(idx);
    setShowSettings(false);
  };
  const setRate = (r) => {
    const v = videoRef.current;
    if (v) v.playbackRate = r;
    setSpeed(r);
    setShowSettings(false);
  };
  const pickSub = (i) => {
    setActiveSub(i);
    const v = videoRef.current;
    if (!v) return;
    [...v.textTracks].forEach((t, idx) => {
      t.mode = idx === i ? "showing" : "disabled";
    });
    setShowSettings(false);
  };

  // ── Hotkeys ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (!wrapRef.current?.contains(document.activeElement) && document.activeElement !== document.body)
        return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          ping();
          break;
        case "ArrowRight":
          e.preventDefault();
          skip(10);
          ping();
          break;
        case "ArrowLeft":
          e.preventDefault();
          skip(-10);
          ping();
          break;
        case "ArrowUp":
          e.preventDefault();
          setVol(Math.min(1, (videoRef.current?.volume || 0) + 0.1));
          ping();
          break;
        case "ArrowDown":
          e.preventDefault();
          setVol(Math.max(0, (videoRef.current?.volume || 0) - 0.1));
          ping();
          break;
        case "m":
          toggleMute();
          ping();
          break;
        case "f":
          toggleFs();
          break;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ping]);

  const fmt = (t) => {
    if (!isFinite(t)) return "0:00";
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    return h
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div
      ref={wrapRef}
      className={`cp-wrap ${className}`}
      onMouseMove={ping}
      onMouseLeave={() => !videoRef.current?.paused && setShowCtrl(false)}
      onDoubleClick={toggleFs}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "#000",
        overflow: "hidden",
        cursor: showCtrl ? "default" : "none",
      }}
    >
      <video
        ref={videoRef}
        poster={poster}
        playsInline
        crossOrigin="anonymous"
        onClick={togglePlay}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          background: "#000",
        }}
      >
        {subtitles.map((s, i) => (
          <track
            key={i}
            kind="subtitles"
            src={s.url}
            srcLang={s.lang}
            label={s.label}
            default={s.default}
          />
        ))}
      </video>

      {/* Big play button when paused */}
      {!playing && (
        <button
          onClick={togglePlay}
          aria-label="Play"
          style={{
            position: "absolute",
            inset: 0,
            margin: "auto",
            width: 88,
            height: 88,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.55)",
            border: "1px solid rgba(255,255,255,0.18)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            backdropFilter: "blur(8px)",
          }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </button>
      )}

      {/* Control bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "40px 16px 12px",
          background:
            "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%)",
          opacity: showCtrl ? 1 : 0,
          transition: "opacity 0.25s",
          pointerEvents: showCtrl ? "auto" : "none",
          color: "#fff",
          fontFamily: "inherit",
        }}
      >
        {/* Progress */}
        <div style={{ position: "relative", height: 18, marginBottom: 6 }}>
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 0,
              right: 0,
              height: 4,
              background: "rgba(255,255,255,0.18)",
              borderRadius: 2,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 0,
              width: `${(buffered / (duration || 1)) * 100}%`,
              height: 4,
              background: "rgba(255,255,255,0.35)",
              borderRadius: 2,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 0,
              width: `${(current / (duration || 1)) * 100}%`,
              height: 4,
              background: "var(--accent, #e50914)",
              borderRadius: 2,
            }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={current}
            onChange={(e) => seek(parseFloat(e.target.value))}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              opacity: 0,
              cursor: "pointer",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <CtrlBtn onClick={togglePlay} title={playing ? "Pause (k)" : "Play (k)"}>
            {playing ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" />
                <rect x="14" y="5" width="4" height="14" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </CtrlBtn>
          <CtrlBtn onClick={() => skip(-10)} title="Back 10s (←)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <polyline points="3 4 3 10 9 10" />
            </svg>
          </CtrlBtn>
          <CtrlBtn onClick={() => skip(10)} title="Forward 10s (→)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <polyline points="21 4 21 10 15 10" />
            </svg>
          </CtrlBtn>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <CtrlBtn onClick={toggleMute} title={muted ? "Unmute (m)" : "Mute (m)"}>
              {muted || volume === 0 ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              )}
            </CtrlBtn>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => setVol(parseFloat(e.target.value))}
              style={{ width: 80, accentColor: "var(--accent, #e50914)" }}
            />
          </div>

          <div style={{ fontSize: 13, opacity: 0.85, fontVariantNumeric: "tabular-nums" }}>
            {fmt(current)} / {fmt(duration)}
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ position: "relative" }}>
            <CtrlBtn onClick={() => setShowSettings((v) => !v)} title="Settings">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </CtrlBtn>
            {showSettings && (
              <div
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  right: 0,
                  minWidth: 200,
                  background: "rgba(15,15,20,0.95)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  padding: 10,
                  backdropFilter: "blur(12px)",
                  fontSize: 13,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <SettingsRow label="Quality">
                  <SettingsPill active={currentLevel === -1} onClick={() => setQuality(-1)}>
                    Auto
                  </SettingsPill>
                  {levels.map((l) => (
                    <SettingsPill
                      key={l.index}
                      active={currentLevel === l.index}
                      onClick={() => setQuality(l.index)}
                    >
                      {l.height ? `${l.height}p` : `L${l.index}`}
                    </SettingsPill>
                  ))}
                  {levels.length === 0 && <span style={{ opacity: 0.5 }}>—</span>}
                </SettingsRow>
                <SettingsRow label="Speed">
                  {[0.5, 1, 1.25, 1.5, 2].map((r) => (
                    <SettingsPill key={r} active={speed === r} onClick={() => setRate(r)}>
                      {r}x
                    </SettingsPill>
                  ))}
                </SettingsRow>
                {subtitles.length > 0 && (
                  <SettingsRow label="Subtitles">
                    <SettingsPill active={activeSub === -1} onClick={() => pickSub(-1)}>
                      Off
                    </SettingsPill>
                    {subtitles.map((s, i) => (
                      <SettingsPill key={i} active={activeSub === i} onClick={() => pickSub(i)}>
                        {s.label || s.lang}
                      </SettingsPill>
                    ))}
                  </SettingsRow>
                )}
              </div>
            )}
          </div>

          <CtrlBtn onClick={togglePip} title="Picture-in-Picture">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" />
            </svg>
          </CtrlBtn>
          <CtrlBtn onClick={toggleFs} title="Fullscreen (f)">
            {isFs ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
              </svg>
            )}
          </CtrlBtn>
        </div>
      </div>
    </div>
  );
}

function CtrlBtn({ children, ...rest }) {
  return (
    <button
      {...rest}
      style={{
        background: "transparent",
        border: "none",
        color: "#fff",
        cursor: "pointer",
        padding: 6,
        borderRadius: 6,
        display: "grid",
        placeItems: "center",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}

function SettingsRow({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{children}</div>
    </div>
  );
}

function SettingsPill({ active, children, ...rest }) {
  return (
    <button
      {...rest}
      style={{
        background: active ? "var(--accent, #e50914)" : "rgba(255,255,255,0.08)",
        border: "none",
        color: "#fff",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}
