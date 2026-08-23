# Watch Party — working notes

Real-time synchronized video watching. React (Vite) client, Express + Socket.IO
server, SQLite via Node's built-in `node:sqlite`. Two independent npm packages
under `watch-party/` — no workspaces, no root `package.json`.

## Running locally

```bash
cd watch-party/server && npm install && npm run dev   # API on :4000
cd watch-party/client && npm install && npm run dev   # client on :5173
```

**No `.env` file is needed.** The client falls back to `http://localhost:4000`
in dev automatically. Creating one is only necessary to point at a non-local API.

## Deployment invariants — please don't undo these

The app is deployed as a **single Render web service**: the client is built and
Express serves the resulting `dist/` alongside the API, so both share one origin.
A few things look odd locally but are load-bearing in production.

**`client/src/lib/api.js`** — the API base is deliberately empty in production:

```js
const API_BASE =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:4000" : "");
```

An empty base means same-origin. Reintroducing a `localhost` fallback for
production, or switching `??` to `||`, breaks the deployed site **silently** —
local dev keeps working, so it won't show up until it's live.

**`client/src/lib/socket.js`** — passes `io(API_ORIGIN || undefined, …)`. The
`|| undefined` matters; `io("")` is not a reliable same-origin signal.

**Server route order** (`server/src/index.js`) — `express.static` → `/api/*` →
JSON 404 for unmatched `/api` → `app.get("*")` serving `index.html`. The SPA
fallback must stay last or it swallows API routes. `/api` and `/socket.io` are
reserved paths; don't add client routes under them.

**One instance only.** Presence is a process-local `Map` in
`server/src/socket/index.js` with no Redis adapter, and Socket.IO defaults to
polling-then-upgrade. A second replica would split rooms — participants on
different instances wouldn't see each other or receive each other's play/pause.

**Node ≥ 22.12.** The database uses `node:sqlite`, which needs ≥ 22.5, and Vite 8
needs ≥ 22.12. Pinned in `watch-party/.node-version` and `render.yaml`.

**`render.yaml` build uses `npm ci --include=dev` for the client.** Render sets
`NODE_ENV=production`, which makes npm skip devDependencies — and Vite is one.
Without the flag the build fails with `vite: command not found`.

## Where the sync logic lives

- `client/src/lib/clockSync.js` — NTP-style clock offset estimation and
  `projectPosition`, which derives "where playback should be right now".
- `client/src/components/VideoPlayer.jsx` — the 300ms drift-correction loop.
  Runs entirely client-side and deliberately makes **no** server calls; keep it
  that way, since a server round trip per tick would not scale.
- `server/src/socket/index.js` — the server stores only
  `{ isPlaying, positionSeconds, updatedAt }`, never a ticking number.

Chat and playback actions each perform a **synchronous** SQLite write that blocks
the event loop for every connected client. That's why they're rate limited per
socket. Adding new socket events that write to the DB should follow the same
pattern via `allow()`.

## Verifying changes

Unit tests don't exist yet. To check a change properly, build for production and
exercise it with two clients:

```bash
cd watch-party/client && npm ci && npm run build
cd ../server && npm ci && NODE_ENV=production JWT_SECRET=dev npm start
# whole app on http://localhost:4000
```

Open a normal window and an incognito window — tokens live in `sessionStorage`,
so tabs in the same window share an identity. Create a room in one, join with the
code in the other, and confirm play/pause/seek propagate and the drift readout
under the player shows real numbers rather than `—`.

There's also `client/scripts/demo-flow.mjs`, a scripted two-client check against
a running server.

## Repo layout note

`Puneeth-RV/Watch-party` is a fork of `Nandita-Dash/Watch-party`. Upstream is
what Render deploys from, and GitHub doesn't run scheduled workflows in forks, so
`.github/workflows/keep-awake.yml` and its `PING_URL` repository variable only
take effect upstream. Changes land via PR rather than pushes to `main`.
