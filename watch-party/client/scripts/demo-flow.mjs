import { io } from "socket.io-client";

const API = "http://localhost:4000";
const log = (who, ...args) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${who}:`, ...args);

async function post(path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  console.log("=== 1. Nandita creates a room ===");
  const created = await post("/api/rooms", {
    name: "Demo Room",
    displayName: "Nandita",
    videoUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  });
  console.log(created);
  const { room, token: tokenA } = created;

  console.log("\n=== 2. Rahul joins the same room via its code ===");
  const joined = await post(`/api/rooms/${room.code}/join`, { displayName: "Rahul" });
  console.log(joined);
  const { token: tokenB } = joined;

  console.log("\n=== 3. Both connect over Socket.IO ===");
  const a = io(API, { auth: { token: tokenA } });
  const b = io(API, { auth: { token: tokenB } });

  b.on("presence:join", (u) => log("Rahul's socket saw", `${u.name} join presence`));
  a.on("presence:list", (list) => log("Nandita's socket", "presence list:", list.map((p) => p.name)));
  b.on("presence:list", (list) => log("Rahul's socket", "presence list:", list.map((p) => p.name)));

  b.on("playback:state", (s) => log("Rahul receives playback:state", s));
  a.on("playback:state", (s) => log("Nandita receives playback:state", s));

  b.on("chat:message", (m) => log("Rahul receives chat:message", `${m.senderName}: ${m.body}`));
  a.on("chat:message", (m) => log("Nandita receives chat:message", `${m.senderName}: ${m.body}`));

  a.on("clock:pong", (p) => log("Nandita's clock ping round-trip", p));

  await new Promise((r) => a.on("connect", r));
  await new Promise((r) => b.on("connect", r));
  console.log("\n=== 4. Both sockets connected ===");

  await new Promise((r) => setTimeout(r, 300));

  console.log("\n=== 5. Nandita measures clock offset (one ping) ===");
  a.emit("clock:ping", Date.now());
  await new Promise((r) => setTimeout(r, 200));

  console.log("\n=== 6. Nandita presses play at position 12.5s -> should broadcast to Rahul ===");
  a.emit("playback:action", { type: "play", positionSeconds: 12.5 });
  await new Promise((r) => setTimeout(r, 300));

  console.log("\n=== 7. Rahul sends a chat message -> should broadcast to Nandita ===");
  b.emit("chat:message", { body: "synced up, nice!" });
  await new Promise((r) => setTimeout(r, 300));

  console.log("\n=== 8. Nandita pauses at 15.0s -> should broadcast to Rahul ===");
  a.emit("playback:action", { type: "pause", positionSeconds: 15.0 });
  await new Promise((r) => setTimeout(r, 300));

  console.log("\n=== 9. Confirm room state now shows chat history via REST ===");
  const state = await fetch(`${API}/api/rooms/${room.code}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  }).then((r) => r.json());
  console.log(state);

  a.disconnect();
  b.disconnect();
  console.log("\n=== Done ===");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
