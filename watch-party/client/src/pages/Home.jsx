import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createRoom, joinRoom } from "../lib/api.js";
import { saveToken } from "../lib/session.js";

// The official trailer from Marvel's own channel, embedded through YouTube's
// player rather than rehosted, so it plays under YouTube's embed licence.
const SAMPLE_VIDEO = "https://www.youtube.com/watch?v=TcMBFSGVi1c";

const SYNC_STEPS = [
  {
    title: "Clock offset",
    desc: "Each browser measures how far its clock is from the server's, keeping the fastest of several round trips.",
  },
  {
    title: "Projected position",
    desc: "The server stores only the last play, pause or seek and when it happened. Every client works out where playback should be now.",
  },
  {
    title: "Drift correction",
    desc: "Every 300 ms the player compares itself to that target. Small gaps are closed by nudging playback speed, large ones by seeking.",
  },
];

export default function Home() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefillJoinCode = searchParams.get("join") || "";
  const [mode, setMode] = useState(prefillJoinCode ? "join" : "create");
  const [displayName, setDisplayName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [videoUrl, setVideoUrl] = useState(SAMPLE_VIDEO);
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

  // One click, no form: a throwaway room with a trailer loaded, so someone
  // trying the app can see sync working before deciding to invite anyone.
  async function handleDemo() {
    setError(null);
    setBusy(true);
    try {
      const guest = `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
      const { room, token } = await createRoom({ name: "Demo room", displayName: guest, videoUrl: SAMPLE_VIDEO });
      saveToken(room.code, token);
      navigate(`/room/${room.code}`, { state: { demo: true } });
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
      <header className="home-nav">
        <div className="brand">
          <span className="mark">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 5v14l11-7-11-7z" fill="currentColor" />
            </svg>
          </span>
          <span>Watch Party</span>
        </div>
        <a className="nav-link" href="https://github.com/Nandita-Dash/Watch-party" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </header>

      <section className="hero">
        <div className="hero-content">
          <h1 className="hero-title">Watch videos in sync with friends</h1>
          <p className="hero-subtitle">
            Create a room, share the code, and everyone's player follows the same clock. Play, pause and seek reach
            every viewer, and small drift is corrected before anyone notices.
          </p>

          <h2 className="steps-heading">How it stays in sync</h2>
          <ol className="sync-steps">
            {SYNC_STEPS.map((step) => (
              <li key={step.title}>
                <h3>{step.title}</h3>
                <p>{step.desc}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="hero-panel">
          <h2>Start watching</h2>
          <p className="subtitle">Create a room or join one with a code.</p>

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

          <div className="demo">
            <button type="button" className="secondary-btn" onClick={handleDemo} disabled={busy}>
              Try a demo room
            </button>
            <p>No name needed. Opens a room with the Avengers: Endgame trailer.</p>
          </div>

          {error && <p className="error">{error}</p>}
        </div>
      </section>
    </div>
  );
}
