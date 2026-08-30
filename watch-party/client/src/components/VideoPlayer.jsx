import { useEffect, useRef, useState } from "react";
import { createClockSync, projectPosition } from "../lib/clockSync.js";
import { extractYouTubeId } from "../lib/youtube.js";
import { createYouTubePlayer } from "../lib/youtubePlayer.js";

const HARD_RESYNC_THRESHOLD_S = 0.9; // drift beyond this: snap immediately
const SOFT_RESYNC_THRESHOLD_S = 0.15; // drift beyond this: nudge playback rate
const CORRECTION_INTERVAL_MS = 300;
const CONTROLS_HIDE_MS = 2000;

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function VideoPlayer({ socket, initialVideoUrl, initialPlayback, onSyncChange }) {
  const videoRef = useRef(null);
  const videoShellRef = useRef(null);
  const youtubeContainerRef = useRef(null);
  const playerRef = useRef(null); // uniform adapter — native <video> or YouTube, whichever is active
  const stateRef = useRef(initialPlayback); // authoritative { isPlaying, positionSeconds, updatedAt }
  const clockSyncRef = useRef(null);
  const suppressRef = useRef(false);
  const lastRemoteApplyAtRef = useRef(0);
  const hasSeededPosition = useRef(false);
  const emitActionRef = useRef(() => {});
  const hideTimerRef = useRef(null);

  const [videoUrl, setVideoUrl] = useState(initialVideoUrl || "");
  const [loadInput, setLoadInput] = useState("");
  const [loadError, setLoadError] = useState(null);

  // Custom-controls UI state — presentational only, never read by the sync logic.
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dragTime, setDragTime] = useState(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [frameGlow, setFrameGlow] = useState(null); // "r, g, b" — presentational only, best-effort

  const youtubeId = extractYouTubeId(videoUrl);

  const applyRemote = (fn) => {
    suppressRef.current = true;
    lastRemoteApplyAtRef.current = Date.now();
    fn();
    setTimeout(() => {
      suppressRef.current = false;
    }, 80);
  };

  // --- Clock calibration -------------------------------------------------
  useEffect(() => {
    const clockSync = createClockSync(socket);
    clockSyncRef.current = clockSync;
    clockSync.calibrate();
    const recalibrate = setInterval(() => clockSync.calibrate(4, 120), 15000);
    return () => {
      clearInterval(recalibrate);
      clockSync.dispose();
    };
  }, [socket]);

  // --- Player lifecycle: build the adapter for whichever source is active ----
  useEffect(() => {
    hasSeededPosition.current = false;
    playerRef.current = null;
    if (!videoUrl) return undefined;

    if (youtubeId) {
      let cancelled = false;
      const adapter = createYouTubePlayer({
        container: youtubeContainerRef.current,
        videoId: youtubeId,
        wasRecentlyApplied: () => Date.now() - lastRemoteApplyAtRef.current < 1000,
        onUserPlay: () => emitActionRef.current("play"),
        onUserPause: () => emitActionRef.current("pause"),
        onUserSeek: () => emitActionRef.current("seek"),
        onReady: () => {
          if (cancelled) return;
          playerRef.current = adapter;
          seedPosition();
        },
      });
      return () => {
        cancelled = true;
        adapter.destroy();
        if (playerRef.current === adapter) playerRef.current = null;
      };
    }

    // Native <video>: it's rendered in the same pass as this effect runs,
    // so the ref is already attached.
    const el = videoRef.current;
    if (!el) return undefined;
    playerRef.current = {
      getCurrentTime: () => el.currentTime,
      seekTo: (seconds) => {
        el.currentTime = seconds;
      },
      play: () => el.play().catch(() => {}),
      pause: () => el.pause(),
      isPaused: () => el.paused,
      setPlaybackRate: (rate) => {
        el.playbackRate = rate;
      },
      supportsRateNudge: true,
      isReady: () => el.readyState >= 1,
    };
    return () => {
      playerRef.current = null;
    };
  }, [videoUrl, youtubeId]);

  // --- Server broadcasts ---------------------------------------------------
  useEffect(() => {
    function onPlaybackState(payload) {
      stateRef.current = payload;
      onSyncChange?.({ lastActionBy: payload.by || null });
      const player = playerRef.current;
      const clockSync = clockSyncRef.current;
      if (!player || !player.isReady() || !clockSync) return;
      const expected = projectPosition(payload, clockSync.serverNow());
      applyRemote(() => {
        player.seekTo(expected);
        if (payload.isPlaying) player.play();
        else player.pause();
      });
    }

    function onVideoChanged(payload) {
      setVideoUrl(payload.videoUrl);
      stateRef.current = payload.playback;
      hasSeededPosition.current = false;
      onSyncChange?.({ lastActionBy: payload.by || null });
      setLoadError(null);
    }

    // Only the sender gets this — the server refused the URL, so without
    // surfacing it the "Load for everyone" button would appear to do nothing.
    function onVideoRejected({ error }) {
      setLoadError(error || "That video URL couldn't be loaded.");
    }

    socket.on("playback:state", onPlaybackState);
    socket.on("video:changed", onVideoChanged);
    socket.on("video:rejected", onVideoRejected);
    return () => {
      socket.off("playback:state", onPlaybackState);
      socket.off("video:changed", onVideoChanged);
      socket.off("video:rejected", onVideoRejected);
    };
  }, [socket, onSyncChange]);

  // --- Continuous drift correction loop ------------------------------------
  useEffect(() => {
    const timer = setInterval(() => {
      const player = playerRef.current;
      const clockSync = clockSyncRef.current;
      const state = stateRef.current;
      if (!player || !player.isReady() || !clockSync || !state || !videoUrl) return;

      const expected = projectPosition(state, clockSync.serverNow());
      const diff = expected - player.getCurrentTime();
      const nextDriftMs = Math.round(diff * 1000);
      // Presentational only — the header's sync indicator reads this; it has
      // no bearing on the correction math below.
      onSyncChange?.({ driftMs: nextDriftMs, roundTripMs: clockSync.roundTripMs });

      if (state.isPlaying && player.isPaused()) {
        applyRemote(() => player.play());
      } else if (!state.isPlaying && !player.isPaused()) {
        applyRemote(() => player.pause());
      }

      if (Math.abs(diff) > HARD_RESYNC_THRESHOLD_S) {
        applyRemote(() => player.seekTo(Math.max(0, expected)));
        player.setPlaybackRate(1);
      } else if (player.supportsRateNudge && Math.abs(diff) > SOFT_RESYNC_THRESHOLD_S) {
        player.setPlaybackRate(diff > 0 ? 1.08 : 0.92);
      } else {
        player.setPlaybackRate(1);
      }
    }, CORRECTION_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [videoUrl, onSyncChange]);

  // Seed the correct starting position once the active player is ready.
  function seedPosition() {
    const player = playerRef.current;
    const clockSync = clockSyncRef.current;
    const state = stateRef.current;
    if (!player || !clockSync || !state || hasSeededPosition.current) return;
    hasSeededPosition.current = true;
    const expected = projectPosition(state, clockSync.serverNow());
    applyRemote(() => {
      player.seekTo(Math.max(0, expected));
      if (state.isPlaying) player.play();
    });
  }

  function emitAction(type) {
    const player = playerRef.current;
    if (!player) return;
    socket.emit("playback:action", { type, positionSeconds: player.getCurrentTime() });
  }
  emitActionRef.current = emitAction;

  function handleLoadVideo(e) {
    e.preventDefault();
    if (!loadInput.trim()) return;
    setLoadError(null);
    socket.emit("video:load", { videoUrl: loadInput.trim() });
    setLoadInput("");
  }

  // --- Custom controls: native <video> only — YouTube keeps its own chrome ---
  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }

  function handleScrubInput(e) {
    setDragTime(Number(e.target.value));
  }

  function commitScrub(e) {
    const el = videoRef.current;
    const value = Number(e.target.value);
    if (el) el.currentTime = value;
    setDragTime(null);
  }

  function toggleMute() {
    const el = videoRef.current;
    if (!el) return;
    const next = !el.muted;
    el.muted = next;
    setMuted(next);
  }

  function handleVolumeChange(e) {
    const v = Number(e.target.value);
    const el = videoRef.current;
    if (el) {
      el.volume = v;
      el.muted = v === 0;
    }
    setVolume(v);
    setMuted(v === 0);
  }

  function toggleFullscreen() {
    const el = videoShellRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      el.requestFullscreen?.();
    }
  }

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === videoShellRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Best-effort ambient glow: sample the current frame's average color once a
  // second while playing. Cross-origin video without permissive CORS headers
  // taints the canvas and throws on readback — that's expected for most
  // pasted URLs, so it just falls back to the static violet glow (the CSS
  // default for --frame-glow) rather than surfacing an error.
  useEffect(() => {
    if (!videoUrl || youtubeId) {
      setFrameGlow(null);
      return undefined;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 9;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let cancelled = false;

    const sample = () => {
      if (cancelled) return;
      const el = videoRef.current;
      if (!el || el.paused || el.readyState < 2) return;
      try {
        ctx.drawImage(el, 0, 0, 16, 9);
        const { data } = ctx.getImageData(0, 0, 16, 9);
        let r = 0;
        let g = 0;
        let b = 0;
        const pixels = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
        setFrameGlow(`${Math.round(r / pixels)}, ${Math.round(g / pixels)}, ${Math.round(b / pixels)}`);
      } catch {
        setFrameGlow(null); // tainted canvas (CORS) — fall back silently
        cancelled = true;
      }
    };

    const timer = setInterval(sample, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [videoUrl, youtubeId]);

  // Auto-hide the control bar while playing and idle; always show when paused.
  useEffect(() => {
    if (!isPlaying) {
      setControlsVisible(true);
      clearTimeout(hideTimerRef.current);
      return undefined;
    }
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
    return () => clearTimeout(hideTimerRef.current);
  }, [isPlaying]);

  function bumpControls() {
    setControlsVisible(true);
    clearTimeout(hideTimerRef.current);
    if (isPlaying) {
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
    }
  }

  const shownTime = dragTime ?? currentTime;
  const scrubFillPct = duration > 0 ? (shownTime / duration) * 100 : 0;

  return (
    <div className="player" style={frameGlow ? { "--frame-glow": frameGlow } : undefined}>
      {/* The stage is what the responsive layout sizes — it hands the frame
          whatever height is left over and keeps it 16:9. */}
      <div className="player-stage">
        {youtubeId ? (
          <div className="youtube-frame" ref={youtubeContainerRef} />
        ) : videoUrl ? (
          <div
            className={`video-shell ${controlsVisible ? "" : "controls-hidden"}`}
            ref={videoShellRef}
            onMouseMove={bumpControls}
            onMouseLeave={() => isPlaying && setControlsVisible(false)}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              playsInline
              onClick={togglePlay}
              onLoadedMetadata={(e) => {
                setDuration(e.currentTarget.duration || 0);
                seedPosition();
              }}
              onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onPlay={() => {
                setIsPlaying(true);
                if (!suppressRef.current) emitAction("play");
              }}
              onPause={() => {
                setIsPlaying(false);
                if (!suppressRef.current) emitAction("pause");
              }}
              onSeeked={() => !suppressRef.current && emitAction("seek")}
            />

            <div className="video-controls">
              <input
                type="range"
                className="scrub"
                min={0}
                max={duration || 0}
                step={0.01}
                value={shownTime}
                style={{ "--fill": `${scrubFillPct}%` }}
                onInput={handleScrubInput}
                onChange={commitScrub}
                aria-label="Seek"
              />
              <div className="video-controls-row">
                <button type="button" className="ctrl-btn" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
                  {isPlaying ? (
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
                      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7 4.5v15l13-7.5-13-7.5z" fill="currentColor" />
                    </svg>
                  )}
                </button>

                <span className="time-label">
                  {formatTime(shownTime)} / {formatTime(duration)}
                </span>

                <div className="spacer" />

                <button type="button" className="ctrl-btn" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
                  {muted || volume === 0 ? (
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
                      <path d="M19 9l-4 4M15 9l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
                      <path
                        d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </button>
                <input
                  type="range"
                  className="volume"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={handleVolumeChange}
                  aria-label="Volume"
                />

                <button
                  type="button"
                  className="ctrl-btn"
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                >
                  {isFullscreen ? (
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M9 4v3a2 2 0 0 1-2 2H4M15 4v3a2 2 0 0 0 2 2h3M9 20v-3a2 2 0 0 0-2-2H4M15 20v-3a2 2 0 0 1 2-2h3"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="player-empty">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="5" width="15" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
              <path d="M22 8.5v7l-5-2.7v-1.6l5-2.7z" fill="currentColor" />
            </svg>
            <span>No video loaded yet — paste a direct video URL or YouTube link below.</span>
          </div>
        )}
      </div>

      <form className="load-form" onSubmit={handleLoadVideo}>
        <input
          type="url"
          placeholder="Paste a direct .mp4 URL or a YouTube link…"
          value={loadInput}
          onChange={(e) => setLoadInput(e.target.value)}
        />
        <button type="submit">Load for everyone</button>
      </form>

      {loadError && <p className="error">{loadError}</p>}
    </div>
  );
}
