// Estimates the offset between this browser's clock and the server's clock,
// so a playback position computed from a server timestamp can be translated
// into "what should the video's currentTime be right now" correctly even
// though every client's Date.now() disagrees slightly and network latency
// varies per connection.
//
// Classic NTP-style approach: send a timestamp, get it echoed back with the
// server's own clock reading, and use the round-trip time to estimate how
// much of the delay was "on the way there" vs "on the way back" (assumed
// symmetric). Doing several samples and keeping the one with the smallest
// round trip filters out samples that got stuck behind a slow network blip.
export function createClockSync(socket) {
  let offsetMs = 0;
  let bestRoundTrip = Infinity;

  function handlePong({ clientSendTime, serverTime }) {
    const clientReceiveTime = Date.now();
    const roundTrip = clientReceiveTime - clientSendTime;
    if (roundTrip < bestRoundTrip) {
      bestRoundTrip = roundTrip;
      const estimatedServerTimeNow = serverTime + roundTrip / 2;
      offsetMs = estimatedServerTimeNow - clientReceiveTime;
    }
  }

  socket.on("clock:pong", handlePong);

  function calibrate(samples = 6, intervalMs = 150) {
    let sent = 0;
    const timer = setInterval(() => {
      socket.emit("clock:ping", Date.now());
      sent += 1;
      if (sent >= samples) clearInterval(timer);
    }, intervalMs);
  }

  return {
    calibrate,
    // "What time is it on the server, right now" from this client's point of view.
    serverNow: () => Date.now() + offsetMs,
    get offsetMs() {
      return offsetMs;
    },
    get roundTripMs() {
      return bestRoundTrip === Infinity ? null : bestRoundTrip;
    },
    dispose: () => socket.off("clock:pong", handlePong),
  };
}

// Given the last known authoritative playback state and the current
// (offset-corrected) server time, compute where playback should be *right
// now* — accounting for time elapsed since that state was broadcast.
export function projectPosition(state, serverNowMs) {
  if (!state) return 0;
  if (!state.isPlaying) return state.positionSeconds;
  const elapsedSeconds = (serverNowMs - state.updatedAt) / 1000;
  return Math.max(0, state.positionSeconds + elapsedSeconds);
}
