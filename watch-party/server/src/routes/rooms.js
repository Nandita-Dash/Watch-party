import { Router } from "express";
import { nanoid, customAlphabet } from "nanoid";
import {
  createRoom,
  getRoomByCode,
  getPlaybackState,
  getRecentMessages,
} from "../models/rooms.js";
import { issueGuestToken, requireAuth } from "../auth.js";
import { normalizeVideoUrl, normalizeDisplayName } from "../validate.js";

const roomCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
const router = Router();

// Create a room and immediately mint a guest token for the creator.
router.post("/", (req, res) => {
  const { name, videoUrl, displayName } = req.body || {};
  const guestName = normalizeDisplayName(displayName);
  if (!guestName) {
    return res.status(400).json({ error: "displayName is required" });
  }

  // videoUrl is optional, but if one was supplied it has to be a real web URL.
  const normalizedVideoUrl = videoUrl ? normalizeVideoUrl(videoUrl) : null;
  if (videoUrl && !normalizedVideoUrl) {
    return res.status(400).json({ error: "videoUrl must be an http(s) URL" });
  }

  const room = createRoom({
    id: nanoid(),
    code: roomCode(),
    name: (name || "Watch Party").trim().slice(0, 80),
    videoUrl: normalizedVideoUrl,
  });

  const userId = nanoid();
  const token = issueGuestToken({ userId, name: guestName, roomId: room.id });

  res.status(201).json({ room, token });
});

// Join an existing room by its short code.
router.post("/:code/join", (req, res) => {
  const { displayName } = req.body || {};
  const guestName = normalizeDisplayName(displayName);
  if (!guestName) {
    return res.status(400).json({ error: "displayName is required" });
  }

  const room = getRoomByCode(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: "Room not found" });

  const userId = nanoid();
  const token = issueGuestToken({ userId, name: guestName, roomId: room.id });

  res.json({ room, token });
});

// Fetch current room state (playback + chat history) — requires the guest token.
router.get("/:code", requireAuth, (req, res) => {
  const room = getRoomByCode(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (room.id !== req.user.roomId) {
    return res.status(403).json({ error: "Token does not belong to this room" });
  }

  res.json({
    room,
    playback: getPlaybackState(room.id),
    messages: getRecentMessages(room.id),
    you: { name: req.user.name, id: req.user.sub },
  });
});

export default router;
