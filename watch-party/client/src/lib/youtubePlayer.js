import { loadYouTubeApi } from "./youtube.js";

const SEEK_JUMP_THRESHOLD_S = 1.5; // bigger than any normal poll-tick drift
const POLL_INTERVAL_MS = 500;

// Wraps a YouTube IFrame Player behind the same small interface VideoPlayer
// uses for the native <video> element, so the drift-correction/clock-sync
// logic doesn't need to know which kind of player it's driving.
//
// Two things the IFrame API doesn't give us for free, that a native <video>
// element does:
//  - A "seeked" event. We poll position instead and treat a jump bigger
//    than normal playback progression as a user scrub.
//  - Fine-grained playbackRate. YouTube only accepts a handful of
//    video-specific rates (no ~1.08x/0.92x nudge), so this adapter reports
//    `supportsRateNudge: false` and VideoPlayer falls back to hard seeks
//    only for drift correction on this source type.
export function createYouTubePlayer({
  container,
  videoId,
  wasRecentlyApplied,
  onUserPlay,
  onUserPause,
  onUserSeek,
  onReady,
}) {
  let player = null;
  let destroyed = false;
  let currentlyPlaying = false;
  let expectedTime = 0;

  loadYouTubeApi().then((YT) => {
    if (destroyed) return;
    player = new YT.Player(container, {
      videoId,
      width: "100%",
      height: "100%",
      playerVars: { autoplay: 0, controls: 1, playsinline: 1, rel: 0 },
      events: {
        onReady: () => onReady(),
        onStateChange: (e) => {
          currentlyPlaying = e.data === YT.PlayerState.PLAYING;
          if (wasRecentlyApplied()) return;
          if (e.data === YT.PlayerState.PLAYING) onUserPlay();
          else if (e.data === YT.PlayerState.PAUSED) onUserPause();
        },
      },
    });
  });

  const pollTimer = setInterval(() => {
    if (!player?.getCurrentTime) return;
    const now = player.getCurrentTime();
    if (!wasRecentlyApplied() && Math.abs(now - expectedTime) > SEEK_JUMP_THRESHOLD_S) {
      onUserSeek();
    }
    expectedTime = currentlyPlaying ? now + POLL_INTERVAL_MS / 1000 : now;
  }, POLL_INTERVAL_MS);

  return {
    getCurrentTime: () => player?.getCurrentTime?.() ?? 0,
    seekTo: (seconds) => player?.seekTo?.(seconds, true),
    play: () => player?.playVideo?.(),
    pause: () => player?.pauseVideo?.(),
    isPaused: () => !currentlyPlaying,
    setPlaybackRate: () => {}, // see supportsRateNudge note above
    supportsRateNudge: false,
    isReady: () => !!player?.getCurrentTime,
    destroy: () => {
      destroyed = true;
      clearInterval(pollTimer);
      player?.destroy?.();
    },
  };
}
