import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { Server } from "socket.io";
import roomsRouter from "./routes/rooms.js";
import { attachSocketServer } from "./socket/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 4000;

// Only set when the client is deployed to a *different* origin (e.g. a Vercel
// front-end talking to this API). In the default single-service deployment the
// client is served from this same process, so there's no cross-origin request
// to allow and CORS stays off entirely.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;

// The built React app, which this server serves in production. Overridable so
// the two halves can still be split across hosts if that's ever wanted.
const clientDist = process.env.CLIENT_DIST_DIR
  ? path.resolve(process.env.CLIENT_DIST_DIR)
  : path.join(__dirname, "..", "..", "client", "dist");
const hasClientBuild = fs.existsSync(path.join(clientDist, "index.html"));

const app = express();
if (CLIENT_ORIGIN) app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

if (hasClientBuild) app.use(express.static(clientDist));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "watch-party-server" }));
app.use("/api/rooms", roomsRouter);

// Unmatched API routes must 404 as JSON — without this the SPA fallback below
// would answer a mistyped endpoint with the HTML shell, and the client would
// fail on JSON.parse instead of showing the real error.
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Client-side routes (/room/:code) are not real files, so anything that isn't a
// static asset gets index.html and React Router takes over.
if (hasClientBuild) {
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

const httpServer = createServer(app);
const io = new Server(httpServer, CLIENT_ORIGIN ? { cors: { origin: CLIENT_ORIGIN } } : {});

attachSocketServer(io);

httpServer.listen(PORT, () => {
  console.log(`watch-party server listening on port ${PORT}`);
  console.log(
    hasClientBuild
      ? `serving client build from ${clientDist}`
      : "no client build found — API only (run `npm run build` in ../client to serve the app)"
  );
});
