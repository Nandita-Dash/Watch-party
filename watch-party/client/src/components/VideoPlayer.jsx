import { useEffect, useRef, useState } from "react";
import { createClockSync, projectPosition } from "../lib/clockSync.js";

const HARD_RESYNC_THRESHOLD_S = 0.9; // drift beyond this: snap immediately
const SOFT_RESYNC_THRESHOLD_S = 0.15; // drift beyond this: nudge playback rate
const CORRECTION_INTERVAL_MS = 300;

export default function VideoPlayer({ socket, initialVideoUrl, initialPlayback }) {
  const videoRef = useRef(null);
  const stateRef = useRef(initialPlayback); // authoritative { isPlaying, positionSeconds, updatedAt }
  const clockSyncRef = useRef(null);
  const suppressRef = useRef(false);
  const hasSeededPosition = useRef(false);

  const [videoUrl, setVideoUrl] = useState(initialVideoUrl || "");
  const [loadInput, setLoadInput] = useState("");
  const [driftMs, setDriftMs] = useState(null);
  const [roundTripMs, setRoundTripMs] = useState(null);
  const [lastActionBy, setLastActionBy] = useState(null);

  const applyRemote = (fn) => {
    suppressRef.current = true;
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

  // --- Server broadcasts ---------------------------------------------------
  useEffect(() => {
    function onPlaybackState(payload) {
      stateRef.current = payload;
      setLastActionBy(payload.by || null);
      const video = videoRef.current;
      if (!video || !clockSyncRef.current) return;
      const expected = projectPosition(payload, clockSyncRef.current.serverNow());
      applyRemote(() => {
        video.currentTime = expected;
        if (payload.isPlaying) video.play().catch(() => {});
        else video.pause();
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
      const video = videoRef.current;
      const clockSync = clockSyncRef.current;
      const state = stateRef.current;
      if (!video || !clockSync || !state || !videoUrl) return;
      if (video.readyState < 1) return; // no metadata yet

      const expected = projectPosition(state, clockSync.serverNow());
      const diff = expected - video.currentTime;
      setDriftMs(Math.round(diff * 1000));
      setRoundTripMs(clockSync.roundTripMs);

      if (state.isPlaying && video.paused) {
        applyRemote(() => video.play().catch(() => {}));
      } else if (!state.isPlaying && !video.paused) {
        applyRemote(() => video.pause());
      }

      if (Math.abs(diff) > HARD_RESYNC_THRESHOLD_S) {
        applyRemote(() => {
          video.currentTime = Math.max(0, expected);
        });
        video.playbackRate = 1;
      } else if (Math.abs(diff) > SOFT_RESYNC_THRESHOLD_S) {
        video.playbackRate = diff > 0 ? 1.08 : 0.92;
      } else {
        video.playbackRate = 1;
      }
    }, CORRECTION_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [videoUrl]);

  // Seed the correct starting position once the new source has metadata.
  function handleLoadedMetadata() {
    const video = videoRef.current;
    const clockSync = clockSyncRef.current;
    const state = stateRef.current;
    if (!video || !clockSync || !state || hasSeededPosition.current) return;
    hasSeededPosition.current = true;
    const expected = projectPosition(state, clockSync.serverNow());
    applyRemote(() => {
      video.currentTime = expected;
      if (state.isPlaying) video.play().catch(() => {});
    });
  }

  function emitAction(type) {
    const video = videoRef.current;
    if (!video) return;
    socket.emit("playback:action", { type, positionSeconds: video.currentTime });
  }

  function handleLoadVideo(e) {
    e.preventDefault();
    if (!loadInput.trim()) return;
    socket.emit("video:load", { videoUrl: loadInput.trim() });
    setLoadInput("");
  }

  return (
    <div className="player">
      {videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => !suppressRef.current && emitAction("play")}
          onPause={() => !suppressRef.current && emitAction("pause")}
          onSeeked={() => !suppressRef.current && emitAction("seek")}
        />
      ) : (
        <div className="player-empty">No video loaded yet — paste a direct video URL below.</div>
      )}

      <form className="load-form" onSubmit={handleLoadVideo}>
        <input
          type="url"
          placeholder="Paste a direct .mp4 video URL…"
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
