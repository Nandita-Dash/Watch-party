import { useEffect, useRef, useState } from "react";
import { createClockSync, projectPosition } from "../lib/clockSync.js";
import { extractYouTubeId } from "../lib/youtube.js";
import { createYouTubePlayer } from "../lib/youtubePlayer.js";

const HARD_RESYNC_THRESHOLD_S = 0.9; // drift beyond this: snap immediately
const SOFT_RESYNC_THRESHOLD_S = 0.15; // drift beyond this: nudge playback rate
const CORRECTION_INTERVAL_MS = 300;

export default function VideoPlayer({ socket, initialVideoUrl, initialPlayback }) {
  const videoRef = useRef(null);
  const youtubeContainerRef = useRef(null);
  const playerRef = useRef(null); // uniform adapter — native <video> or YouTube, whichever is active
  const stateRef = useRef(initialPlayback); // authoritative { isPlaying, positionSeconds, updatedAt }
  const clockSyncRef = useRef(null);
  const suppressRef = useRef(false);
  const lastRemoteApplyAtRef = useRef(0);
  const hasSeededPosition = useRef(false);
  const emitActionRef = useRef(() => {});

  const [videoUrl, setVideoUrl] = useState(initialVideoUrl || "");
  const [loadInput, setLoadInput] = useState("");
  const [driftMs, setDriftMs] = useState(null);
  const [roundTripMs, setRoundTripMs] = useState(null);
  const [lastActionBy, setLastActionBy] = useState(null);

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
      setLastActionBy(payload.by || null);
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
      setLastActionBy(payload.by || null);
    }

    socket.on("playback:state", onPlaybackState);
    socket.on("video:changed", onVideoChanged);
    return () => {
      socket.off("playback:state", onPlaybackState);
      socket.off("video:changed", onVideoChanged);
    };
  }, [socket]);

  // --- Continuous drift correction loop ------------------------------------
  useEffect(() => {
    const timer = setInterval(() => {
      const player = playerRef.current;
      const clockSync = clockSyncRef.current;
      const state = stateRef.current;
      if (!player || !player.isReady() || !clockSync || !state || !videoUrl) return;

      const expected = projectPosition(state, clockSync.serverNow());
      const diff = expected - player.getCurrentTime();
      setDriftMs(Math.round(diff * 1000));
      setRoundTripMs(clockSync.roundTripMs);

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
  }, [videoUrl]);

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
    socket.emit("video:load", { videoUrl: loadInput.trim() });
    setLoadInput("");
  }

  return (
    <div className="player">
      {youtubeId ? (
        <div className="youtube-frame" ref={youtubeContainerRef} />
      ) : videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          onLoadedMetadata={seedPosition}
          onPlay={() => !suppressRef.current && emitAction("play")}
          onPause={() => !suppressRef.current && emitAction("pause")}
          onSeeked={() => !suppressRef.current && emitAction("seek")}
        />
      ) : (
        <div className="player-empty">
          No video loaded yet — paste a direct video URL or YouTube link below.
        </div>
      )}

      <form className="load-form" onSubmit={handleLoadVideo}>
        <input
          type="url"
          placeholder="Paste a direct .mp4 URL or a YouTube link…"
          value={loadInput}
          onChange={(e) => setLoadInput(e.target.value)}
        />
        <button type="submit">Load for everyone</button>
      </form>

      <div className="sync-readout">
        <span>drift: {driftMs === null ? "—" : `${driftMs} ms`}</span>
        <span>latency: {roundTripMs === null ? "—" : `${roundTripMs} ms`}</span>
        {lastActionBy && <span>last action by {lastActionBy}</span>}
      </div>
    </div>
  );
}
