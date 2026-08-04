import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import roomsRouter from "./routes/rooms.js";
import { attachSocketServer } from "./socket/index.js";

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "watch-party-server" }));
app.use("/api/rooms", roomsRouter);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

attachSocketServer(io);

httpServer.listen(PORT, () => {
  console.log(`watch-party server listening on http://localhost:${PORT}`);
});
