import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createRoom, joinRoom } from "../lib/api.js";
import { saveToken } from "../lib/session.js";

export default function Home() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefillJoinCode = searchParams.get("join") || "";
  const [mode, setMode] = useState(prefillJoinCode ? "join" : "create");
  const [displayName, setDisplayName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [videoUrl, setVideoUrl] = useState(
    "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
  );
  const [joinCode, setJoinCode] = useState(prefillJoinCode);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { room, token } = await createRoom({
        name: roomName || "Watch Party",
        displayName,
        videoUrl,
      });
      saveToken(room.code, token);
      navigate(`/room/${room.code}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const code = joinCode.trim().toUpperCase();
      const { room, token } = await joinRoom(code, { displayName });
      saveToken(room.code, token);
      navigate(`/room/${room.code}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="home">
      <div className="home-card">
        <h1>Watch Party</h1>
        <p className="subtitle">Watch something together, perfectly in sync, wherever you are.</p>

        <div className="tabs">
          <button className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>
            Start a room
          </button>
          <button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}>
            Join a room
          </button>
        </div>

        {mode === "create" ? (
          <form onSubmit={handleCreate}>
            <label>
              Your name
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </label>
            <label>
              Room name
              <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Friday Night" />
            </label>
            <label>
              Video URL (optional — can add later)
              <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create room"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoin}>
            <label>
              Your name
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </label>
            <label>
              Room code
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="e.g. VJGYQV"
                required
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "Joining…" : "Join room"}
            </button>
          </form>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
