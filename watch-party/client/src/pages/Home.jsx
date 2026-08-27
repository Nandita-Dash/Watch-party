import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createRoom, joinRoom } from "../lib/api.js";
import { saveToken } from "../lib/session.js";
import { useReveal } from "../lib/useReveal.js";

const FEATURES = [
  {
    title: "Frame-accurate sync",
    desc: "Clock-calibrated playback keeps everyone within milliseconds, automatically.",
    icon: (
      <path
        d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-17v5l3.5 2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Live chat & presence",
    desc: "See who's in the room and talk through the moment as it happens.",
    icon: (
      <path
        d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4 8.9 8.9 0 0 1-3.1-.6L3 21l1.8-5A8.4 8.4 0 1 1 21 11.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Zero friction",
    desc: "No installs, no accounts. Share a code, everyone's watching in seconds.",
    icon: (
      <path
        d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
];

function Feature({ title, desc, icon }) {
  const [ref, visible] = useReveal(0.3);
  return (
    <div ref={ref} className={`feature ${visible ? "in-view" : ""}`}>
      <span className="feature-icon">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          {icon}
        </svg>
      </span>
      <div>
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
    </div>
  );
}

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
      <div className="home-glow home-glow-1" />
      <div className="home-glow home-glow-2" />

      <header className="home-nav">
        <div className="brand">
          <span className="mark">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 5v14l11-7-11-7z" fill="currentColor" />
            </svg>
          </span>
          <span>Watch Party</span>
        </div>
      </header>

      <section className="hero">
        <div className="hero-content">
          <span className="eyebrow">Live · Synced · Together</span>
          <h1 className="hero-title">
            Watch anything, <span className="gradient-text">together</span>.
          </h1>
          <p className="hero-subtitle">
            Frame-accurate playback sync, live chat, and zero friction — just share a link and press play.
          </p>

          <div className="hero-features">
            {FEATURES.map((f) => (
              <Feature key={f.title} {...f} />
            ))}
          </div>
        </div>

        <div className="hero-panel">
          <h2>Get started</h2>
          <p className="subtitle">Create a room or jump into one with a code.</p>

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
      </section>
    </div>
  );
}
