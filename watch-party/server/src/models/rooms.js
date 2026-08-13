import { db } from "../db.js";

export function createRoom({ id, code, name, videoUrl }) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO rooms (id, code, name, video_url, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, code, name, videoUrl ?? null, now);

  db.prepare(
    `INSERT INTO playback_state (room_id, is_playing, position_seconds, updated_at)
     VALUES (?, 0, 0, ?)`
  ).run(id, now);

  return getRoomByCode(code);
}

export function getRoomByCode(code) {
  return db.prepare(`SELECT * FROM rooms WHERE code = ?`).get(code);
}

export function getRoomById(id) {
  return db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(id);
}

export function setRoomVideo(roomId, videoUrl) {
  db.prepare(`UPDATE rooms SET video_url = ? WHERE id = ?`).run(videoUrl, roomId);
  const now = Date.now();
  db.prepare(
    `UPDATE playback_state SET is_playing = 0, position_seconds = 0, updated_at = ? WHERE room_id = ?`
  ).run(now, roomId);
}

export function getPlaybackState(roomId) {
  return db.prepare(`SELECT * FROM playback_state WHERE room_id = ?`).get(roomId);
}

export function savePlaybackState(roomId, { isPlaying, positionSeconds, updatedAt }) {
  db.prepare(
    `UPDATE playback_state SET is_playing = ?, position_seconds = ?, updated_at = ? WHERE room_id = ?`
  ).run(isPlaying ? 1 : 0, positionSeconds, updatedAt, roomId);
}

function mapMessage(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    senderName: row.sender_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

export function addMessage({ roomId, senderName, body }) {
  const createdAt = Date.now();
  const info = db
    .prepare(
      `INSERT INTO messages (room_id, sender_name, body, created_at) VALUES (?, ?, ?, ?)`
    )
    .run(roomId, senderName, body, createdAt);
  return { id: info.lastInsertRowid, roomId, senderName, body, createdAt };
}

export function getRecentMessages(roomId, limit = 50) {
  return db
    .prepare(
      `SELECT * FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(roomId, limit)
    .reverse()
    .map(mapMessage);
}

// Messages that landed after `sinceId` — used to catch a client up after it
// (re)connects, since a Socket.IO reconnect is a brand-new connection and
// misses any broadcasts sent while the previous one was down.
export function getMessagesSince(roomId, sinceId, limit = 200) {
  return db
    .prepare(
      `SELECT * FROM messages WHERE room_id = ? AND id > ? ORDER BY id ASC LIMIT ?`
    )
    .all(roomId, sinceId, limit)
    .map(mapMessage);
}
