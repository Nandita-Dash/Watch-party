import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { io as connect } from "socket.io-client";

// Must be set before db.js is first imported, hence the dynamic imports below.
process.env.DB_PATH = ":memory:";
const { attachSocketServer, allow } = await import("../src/socket/index.js");
const { createRoom, getPlaybackState } = await import("../src/models/rooms.js");
const { issueGuestToken } = await import("../src/auth.js");

let httpServer;
let url;
let roomCounter = 0;

before(async () => {
  httpServer = createServer();
  attachSocketServer(new Server(httpServer));
  await new Promise((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${httpServer.address().port}`;
});

after(() => new Promise((resolve) => httpServer.close(resolve)));

function makeRoom() {
  roomCounter += 1;
  return createRoom({ id: `room-${roomCounter}`, code: `CODE${roomCounter}`, name: "Test", videoUrl: null });
}

// Connects a guest to the room and resolves once the server has sent the
// presence list, i.e. the connection handler has fully run.
async function join(t, room, name) {
  const token = issueGuestToken({ userId: `${name}-id`, name, roomId: room.id });
  const socket = connect(url, { auth: { token }, transports: ["websocket"], forceNew: true });
  t.after(() => socket.disconnect());
  const presence = await once(socket, "presence:list");
  return { socket, presence };
}

function once(socket, event, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

test("a connection without a valid token is rejected", async () => {
  const socket = connect(url, { auth: { token: "nope" }, transports: ["websocket"], forceNew: true });
  const err = await once(socket, "connect_error");
  socket.disconnect();
  assert.equal(err.message, "Invalid or expired token");
});

test("joining a room announces presence to existing members", async (t) => {
  const room = makeRoom();
  const alice = await join(t, room, "Alice");
  assert.deepEqual(alice.presence.map((p) => p.name), ["Alice"]);

  const joined = once(alice.socket, "presence:join");
  const bob = await join(t, room, "Bob");
  assert.deepEqual((await joined).name, "Bob");
  assert.deepEqual(bob.presence.map((p) => p.name).sort(), ["Alice", "Bob"]);
});

test("play, seek and pause propagate to everyone in the room", async (t) => {
  const room = makeRoom();
  const alice = await join(t, room, "Alice");
  const bob = await join(t, room, "Bob");

  // The server broadcasts to the whole room, sender included, so each step
  // waits for both sockets; that also stops one step's echo leaking into the next.
  const step = async (from, action) => {
    const states = Promise.all([once(alice.socket, "playback:state"), once(bob.socket, "playback:state")]);
    from.socket.emit("playback:action", action);
    const [forAlice, forBob] = await states;
    assert.deepEqual(forAlice, forBob);
    return forBob;
  };

  let state = await step(alice, { type: "play", positionSeconds: 5 });
  assert.equal(state.type, "play");
  assert.equal(state.isPlaying, true);
  assert.equal(state.positionSeconds, 5);
  assert.equal(state.by, "Alice");
  assert.equal(typeof state.updatedAt, "number");

  // A seek keeps the current play/pause state.
  state = await step(bob, { type: "seek", positionSeconds: 90 });
  assert.equal(state.isPlaying, true);
  assert.equal(state.positionSeconds, 90);
  assert.equal(state.by, "Bob");

  state = await step(alice, { type: "pause", positionSeconds: 91.5 });
  assert.equal(state.isPlaying, false);
  assert.equal(state.positionSeconds, 91.5);

  const stored = getPlaybackState(room.id);
  assert.equal(stored.is_playing, 0);
  assert.equal(stored.position_seconds, 91.5);
});

test("playback events stay inside their own room", async (t) => {
  const roomA = makeRoom();
  const roomB = makeRoom();
  const alice = await join(t, roomA, "Alice");
  const carol = await join(t, roomB, "Carol");

  let leaked = false;
  carol.socket.on("playback:state", () => (leaked = true));
  alice.socket.emit("playback:action", { type: "play", positionSeconds: 1 });
  await once(alice.socket, "playback:state");
  assert.equal(leaked, false);
});

test("unknown playback action types are ignored", async (t) => {
  const room = makeRoom();
  const alice = await join(t, room, "Alice");

  let received = false;
  alice.socket.on("playback:state", () => (received = true));
  alice.socket.emit("playback:action", { type: "rewind", positionSeconds: 3 });
  // Round-trip a ping so the ignored event has definitely been processed.
  alice.socket.emit("clock:ping", 0);
  await once(alice.socket, "clock:pong");
  assert.equal(received, false);
});

test("playback actions beyond the rate limit are dropped", async (t) => {
  const room = makeRoom();
  const alice = await join(t, room, "Alice");

  let count = 0;
  alice.socket.on("playback:state", () => (count += 1));
  for (let i = 0; i < 25; i++) {
    alice.socket.emit("playback:action", { type: "seek", positionSeconds: i });
  }
  alice.socket.emit("clock:ping", 0);
  await once(alice.socket, "clock:pong");
  assert.equal(count, 10);
});

test("clock:ping is echoed with the client time and the server time", async (t) => {
  const room = makeRoom();
  const alice = await join(t, room, "Alice");

  const before = Date.now();
  alice.socket.emit("clock:ping", 123);
  const pong = await once(alice.socket, "clock:pong");
  assert.equal(pong.clientSendTime, 123);
  assert.ok(pong.serverTime >= before && pong.serverTime <= Date.now());
});

test("allow() counts per event and resets after the window", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const socket = {};

  for (let i = 0; i < 5; i++) assert.equal(allow(socket, "chat:message"), true);
  assert.equal(allow(socket, "chat:message"), false);

  // Each event type has its own window.
  assert.equal(allow(socket, "playback:action"), true);

  t.mock.timers.tick(1000);
  assert.equal(allow(socket, "chat:message"), true);
});

test("allow() lets events without a rule through", () => {
  const socket = {};
  for (let i = 0; i < 100; i++) assert.equal(allow(socket, "clock:ping"), true);
});
