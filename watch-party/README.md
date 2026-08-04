# Watch Party

Paste a video link, invite friends with a room code, and watch it together —
perfectly in sync, even across different networks and devices.

A full-stack real-time app built with **React, Node/Express, Socket.IO, and
SQLite**, built to demonstrate real-time systems design (not just CRUD):
synchronized playback across clients requires actively correcting for network
latency and clock disagreement between machines, which is the core engineering
problem this project solves.

## Why synchronized playback is harder than it looks

If every client just plays a video whenever it hears "play", they drift apart
within seconds — different buffering, different clock speeds, different
network latency to the server. This project fixes that with three things
working together:

1. **Clock offset estimation.** Each client periodically pings the server and
   measures the round trip. Using the classic NTP-style trick (assume the
   network delay is roughly symmetric), it estimates how far its own clock is
   off from the server's — see [`clockSync.js`](client/src/lib/clockSync.js).
2. **A single source of truth for "where playback should be."** The server
   stores only `{ isPlaying, positionSeconds, updatedAt }` — not a
   continuously ticking position. Clients derive "what time should the video
   be at *right now*" by projecting that state forward using their
   corrected clock (`projectPosition` in the same file).
3. **Continuous drift correction, not just reaction to events.** Every 300ms,
   each client compares its actual `video.currentTime` to the expected
   position: small drift (<150ms) is corrected smoothly by nudging
   `playbackRate` up or down a few percent (imperceptible to the ear/eye);
   large drift (>900ms, e.g. after a reconnect) triggers a hard seek. See the
   correction loop in [`VideoPlayer.jsx`](client/src/components/VideoPlayer.jsx).

## Stack

- **Client:** React 19 + Vite, Socket.IO client, React Router
- **Server:** Node.js + Express, Socket.IO server, JWT-based guest auth
- **Database:** SQLite via Node's built-in `node:sqlite` (zero native
  dependencies — no build tools required to run this project)

## Architecture

```
client (React)                    server (Express + Socket.IO)
├─ REST: create/join room    ───▶  /api/rooms  (issues short-lived guest JWT)
├─ WS:  playback:action      ───▶  authoritative playback state (SQLite)
├─ WS:  playback:state       ◀───  broadcast to everyone in the room
├─ WS:  chat:message         ◀──▶  persisted + broadcast
├─ WS:  presence:*           ◀───  in-memory per-room presence map
└─ WS:  clock:ping/pong      ◀──▶  per-client latency + offset measurement
```

Identity is lightweight by design: joining a room mints a short-lived signed
JWT tied to a display name and room ID — no signup flow, matching how real
watch-party products (Teleparty, watch2gether) work. The REST layer handles
room lifecycle (create/join/fetch state); Socket.IO handles everything that
needs to happen in real time.

## Running it locally

```bash
# terminal 1
cd server && npm install && npm run dev      # http://localhost:4000

# terminal 2
cd client && npm install && npm run dev      # http://localhost:5173
```

Open two browser tabs/windows, create a room in one, join with the room code
in the other, and load a direct video URL (any public `.mp4` link works, e.g.
`https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4`).

There's also a scripted two-client demo (`client/scripts/demo-flow.mjs`) that
exercises the full flow — room creation, join, presence, playback sync, and
chat — directly against the running server, useful for verifying the
real-time layer without opening a browser.

## What's deliberately out of scope (v1)

- YouTube/streaming-service embeds (would need each provider's player SDK —
  the sync engine itself is provider-agnostic and could drive one)
- Persistent accounts (guest identity only)
- Host-only playback controls (currently collaborative — anyone can
  play/pause/seek)

## Possible next steps

- Host-only controls with a "request control" flow for others
- Reconnect replay: catch a client up on missed chat while it was offline
- WebRTC voice chat alongside text chat
- YouTube IFrame API adapter using the same sync engine
