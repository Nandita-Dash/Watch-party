import { verifyToken } from "../auth.js";
import {
  getRoomById,
  savePlaybackState,
  getPlaybackState,
  setRoomVideo,
  addMessage,
  getMessagesSince,
} from "../models/rooms.js";
import { normalizeVideoUrl } from "../validate.js";

// roomId -> Map<socketId, { userId, name }>
const presenceByRoom = new Map();

// roomId -> Map<socketId, { userId, name }> — who currently has voice chat
// open. Separate from presenceByRoom because being in the room and being in
// voice are independent (voice is opt-in). The server never touches actual
// audio — it only relays WebRTC signaling messages between the two peers
// establishing a connection, same as a phone switchboard.
const voiceByRoom = new Map();

// Chat messages and playback actions each perform a *synchronous* SQLite write,
// which blocks the event loop for everyone connected — so one client spamming
// events degrades every other participant, not just itself. A fixed window per
// socket per event type is enough to contain that; the limits are far above
// what the UI can produce by hand. The voice:* limits exist for the same
// flooding concern even though they don't touch the DB.
const RATE_LIMITS = {
  "chat:message": { limit: 5, windowMs: 1000 },
  "playback:action": { limit: 10, windowMs: 1000 },
  "video:load": { limit: 3, windowMs: 10000 },
  "voice:join": { limit: 5, windowMs: 5000 },
  "voice:leave": { limit: 5, windowMs: 5000 },
  "voice:offer": { limit: 10, windowMs: 5000 },
  "voice:answer": { limit: 10, windowMs: 5000 },
  "voice:ice-candidate": { limit: 100, windowMs: 5000 },
};

export function allow(socket, event) {
  const rule = RATE_LIMITS[event];
  if (!rule) return true;

  const now = Date.now();
  const windows = (socket.rateWindows ??= {});
  const window = windows[event];

  if (!window || now - window.start >= rule.windowMs) {
    windows[event] = { start: now, count: 1 };
    return true;
  }
  if (window.count >= rule.limit) return false;
  window.count += 1;
  return true;
}

function roomChannel(roomId) {
  return `room:${roomId}`;
}

function listPresence(roomId) {
  const map = presenceByRoom.get(roomId);
  if (!map) return [];
  return [...map.values()];
}

function listVoice(roomId) {
  const map = voiceByRoom.get(roomId);
  if (!map) return [];
  return [...map.entries()].map(([socketId, info]) => ({ socketId, ...info }));
}

export function attachSocketServer(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Missing token"));
      const payload = verifyToken(token);
      const room = getRoomById(payload.roomId);
      if (!room) return next(new Error("Room no longer exists"));
      socket.user = { id: payload.sub, name: payload.name, roomId: payload.roomId };
      next();
    } catch (err) {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const { roomId, id: userId, name } = socket.user;
    const channel = roomChannel(roomId);
    socket.join(channel);

    if (!presenceByRoom.has(roomId)) presenceByRoom.set(roomId, new Map());
    presenceByRoom.get(roomId).set(socket.id, { userId, name });

    socket.emit("presence:list", listPresence(roomId));
    socket.to(channel).emit("presence:join", { userId, name });

    // --- Clock offset measurement -----------------------------------
    // Client sends its local send-time; server echoes it back alongside
    // its own clock reading. The client uses several round trips of this
    // to estimate (a) one-way network latency and (b) the offset between
    // its clock and the server's, so playback position can be corrected
    // for both instead of assuming clocks/latency are zero.
    socket.on("clock:ping", (clientSendTime) => {
      socket.emit("clock:pong", { clientSendTime, serverTime: Date.now() });
    });

    // --- Playback sync -------------------------------------------------
    socket.on("playback:action", ({ type, positionSeconds }) => {
      if (!["play", "pause", "seek"].includes(type)) return;
      if (!allow(socket, "playback:action")) return;
      const updatedAt = Date.now();
      const isPlaying = type === "pause" ? false : type === "play" ? true : undefined;

      const current = getPlaybackState(roomId);
      const nextState = {
        isPlaying: isPlaying === undefined ? !!current.is_playing : isPlaying,
        positionSeconds:
          typeof positionSeconds === "number" ? positionSeconds : current.position_seconds,
        updatedAt,
      };
      savePlaybackState(roomId, nextState);

      io.to(channel).emit("playback:state", {
        type,
        isPlaying: nextState.isPlaying,
        positionSeconds: nextState.positionSeconds,
        updatedAt: nextState.updatedAt,
        by: name,
      });
    });

    socket.on("video:load", ({ videoUrl }) => {
      if (!allow(socket, "video:load")) return;
      // Rejected rather than sanitized: this URL lands in every participant's
      // player, so a bad one shouldn't reach them in any form.
      const normalized = normalizeVideoUrl(videoUrl);
      if (!normalized) {
        socket.emit("video:rejected", { error: "That doesn't look like a valid video URL." });
        return;
      }
      setRoomVideo(roomId, normalized);
      const state = getPlaybackState(roomId);
      io.to(channel).emit("video:changed", {
        videoUrl: normalized,
        by: name,
        playback: {
          isPlaying: !!state.is_playing,
          positionSeconds: state.position_seconds,
          updatedAt: state.updated_at,
        },
      });
    });

    // --- Chat ------------------------------------------------------------
    socket.on("chat:message", ({ body }) => {
      const trimmed = (typeof body === "string" ? body : "").trim().slice(0, 1000);
      if (!trimmed) return;
      if (!allow(socket, "chat:message")) return;
      const message = addMessage({ roomId, senderName: name, body: trimmed });
      io.to(channel).emit("chat:message", message);
    });

    // Reconnect replay: the client reports the newest message id it already
    // has (from REST history or earlier live messages) and gets back
    // anything that landed while it was disconnected — a Socket.IO
    // reconnect is a brand-new connection, so broadcasts sent during the
    // gap are otherwise lost to that client.
    socket.on("chat:sync", (lastMessageId) => {
      const since = Number.isInteger(lastMessageId) ? lastMessageId : 0;
      const missed = getMessagesSince(roomId, since);
      if (missed.length) socket.emit("chat:missed", missed);
    });

    // --- Voice chat signaling (mesh WebRTC) -------------------------------
    // Joining is opt-in and independent of room presence. The joiner always
    // initiates: it gets the current roster and sends an offer to each
    // existing member, while existing members just wait for that offer —
    // this one-directional rule is what avoids two peers glaring at each
    // other with simultaneous offers in a mesh topology.
    socket.on("voice:join", () => {
      if (!allow(socket, "voice:join")) return;
      if (!voiceByRoom.has(roomId)) voiceByRoom.set(roomId, new Map());
      const voiceMap = voiceByRoom.get(roomId);
      if (voiceMap.has(socket.id)) return;
      socket.emit("voice:roster", listVoice(roomId));
      voiceMap.set(socket.id, { userId, name });
      socket.to(channel).emit("voice:peer-joined", { socketId: socket.id, userId, name });
    });

    socket.on("voice:leave", () => {
      if (!allow(socket, "voice:leave")) return;
      const voiceMap = voiceByRoom.get(roomId);
      if (!voiceMap?.has(socket.id)) return;
      voiceMap.delete(socket.id);
      if (voiceMap.size === 0) voiceByRoom.delete(roomId);
      socket.to(channel).emit("voice:peer-left", { socketId: socket.id });
    });

    // Pure relay, targeted at one peer by socket id — never broadcast to the
    // room. The server never inspects the SDP/ICE payloads themselves.
    for (const event of ["voice:offer", "voice:answer", "voice:ice-candidate"]) {
      socket.on(event, ({ to, ...payload } = {}) => {
        if (!allow(socket, event)) return;
        if (typeof to !== "string") return;
        io.to(to).emit(event, { ...payload, from: socket.id });
      });
    }

    socket.on("disconnect", () => {
      const map = presenceByRoom.get(roomId);
      if (map) {
        map.delete(socket.id);
        if (map.size === 0) presenceByRoom.delete(roomId);
      }
      socket.to(channel).emit("presence:leave", { userId, name });

      const voiceMap = voiceByRoom.get(roomId);
      if (voiceMap?.has(socket.id)) {
        voiceMap.delete(socket.id);
        if (voiceMap.size === 0) voiceByRoom.delete(roomId);
        socket.to(channel).emit("voice:peer-left", { socketId: socket.id });
      }
    });
  });
}
