import { test } from "node:test";
import assert from "node:assert/strict";
import { createClockSync, projectPosition } from "../src/lib/clockSync.js";

// Just enough of a Socket.IO client to drive createClockSync: it records what
// was emitted and lets a test deliver a "clock:pong" by hand.
function fakeSocket() {
  const handlers = new Map();
  const emitted = [];
  return {
    emitted,
    on: (event, fn) => handlers.set(event, fn),
    off: (event) => handlers.delete(event),
    emit: (event, payload) => emitted.push({ event, payload }),
    deliver: (event, payload) => handlers.get(event)?.(payload),
    has: (event) => handlers.has(event),
  };
}

test("projectPosition returns 0 when there is no state yet", () => {
  assert.equal(projectPosition(null, 1000), 0);
});

test("projectPosition holds still while paused", () => {
  const state = { isPlaying: false, positionSeconds: 42, updatedAt: 1_000 };
  assert.equal(projectPosition(state, 61_000), 42);
});

test("projectPosition advances by elapsed server time while playing", () => {
  const state = { isPlaying: true, positionSeconds: 10, updatedAt: 1_000 };
  assert.equal(projectPosition(state, 3_500), 12.5);
});

test("projectPosition never goes below zero", () => {
  // A client clock still converging can briefly make serverNow look earlier
  // than updatedAt; that must not yield a negative currentTime.
  const state = { isPlaying: true, positionSeconds: 0.2, updatedAt: 5_000 };
  assert.equal(projectPosition(state, 4_000), 0);
});

test("offset is estimated from one pong, assuming symmetric latency", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 10_000 });
  const socket = fakeSocket();
  const sync = createClockSync(socket);

  // Sent at 10_000, answered at 10_100 local; the server read 50_040 mid-flight.
  t.mock.timers.tick(100);
  socket.deliver("clock:pong", { clientSendTime: 10_000, serverTime: 50_040 });

  // Server-now ≈ 50_040 + 100/2 = 50_090, local-now = 10_100.
  assert.equal(sync.roundTripMs, 100);
  assert.equal(sync.offsetMs, 39_990);
  assert.equal(sync.serverNow(), 50_090);
});

test("the sample with the smallest round trip wins", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const socket = fakeSocket();
  const sync = createClockSync(socket);

  t.mock.timers.tick(40);
  socket.deliver("clock:pong", { clientSendTime: 0, serverTime: 1_020 }); // rtt 40
  const goodOffset = sync.offsetMs;

  // A slow sample with a wildly different implied offset must be ignored.
  t.mock.timers.tick(400);
  socket.deliver("clock:pong", { clientSendTime: 40, serverTime: 9_999 }); // rtt 400

  assert.equal(sync.roundTripMs, 40);
  assert.equal(sync.offsetMs, goodOffset);
});

test("roundTripMs is null before any pong arrives", () => {
  const sync = createClockSync(fakeSocket());
  assert.equal(sync.roundTripMs, null);
  assert.equal(sync.offsetMs, 0);
});

test("calibrate sends the requested number of pings, then stops", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 0 });
  const socket = fakeSocket();
  createClockSync(socket).calibrate(3, 150);

  for (let i = 0; i < 10; i++) t.mock.timers.tick(150);
  const pings = socket.emitted.filter((e) => e.event === "clock:ping");
  assert.deepEqual(
    pings.map((p) => p.payload),
    [150, 300, 450]
  );
});

test("dispose stops listening for pongs", () => {
  const socket = fakeSocket();
  const sync = createClockSync(socket);
  assert.ok(socket.has("clock:pong"));
  sync.dispose();
  assert.ok(!socket.has("clock:pong"));
});
