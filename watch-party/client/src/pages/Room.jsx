import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getRoom } from "../lib/api.js";
import { loadToken, clearToken } from "../lib/session.js";
import { connectSocket } from "../lib/socket.js";
import VideoPlayer from "../components/VideoPlayer.jsx";
import Chat from "../components/Chat.jsx";
import ParticipantList from "../components/ParticipantList.jsx";

export default function Room() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [socket, setSocket] = useState(null);
  const [connError, setConnError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);
  // Which sidebar panel is showing. Only reachable below the two-column
  // breakpoint — wider layouts show both and ignore this.
  const [sidebarTab, setSidebarTab] = useState("chat");

  const token = useMemo(() => loadToken(code), [code]);

  useEffect(() => {
    if (!token) {
      navigate(`/?join=${code}`, { replace: true });
      return;
    }

    let cancelled = false;
    let createdSocket = null;

    getRoom(code, token)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        createdSocket = connectSocket(token);
        createdSocket.on("connect_error", (err) => setConnError(err.message));
        createdSocket.on("connect", () => setConnected(true));
        createdSocket.on("disconnect", () => setConnected(false));
        setConnected(createdSocket.connected);
        setSocket(createdSocket);
      })
      .catch((err) => {
        if (!cancelled) setConnError(err.message);
      });

    return () => {
      cancelled = true;
      createdSocket?.disconnect();
    };
  }, [code, token, navigate]);

  function handleLeave() {
    clearToken(code);
    socket?.disconnect();
    navigate("/");
  }

  function handleCopyInvite() {
    navigator.clipboard.writeText(`${window.location.origin}/room/${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (connError) {
    return (
      <div className="room-error">
        <p>{connError}</p>
        <button onClick={() => navigate("/")}>Back home</button>
      </div>
    );
  }

  if (!data || !socket) {
    return (
      <div className="room-loading">
        <div className="spinner" />
        <span>Loading room…</span>
      </div>
    );
  }

  return (
    <div className="room">
      <header className="room-header">
        <div className="room-title">
          <div className="room-title-row">
            <span className={`conn-dot ${connected ? "" : "offline"}`} title={connected ? "Connected" : "Reconnecting…"} />
            <h2>{data.room.name}</h2>
          </div>
          <button className="code-pill" onClick={handleCopyInvite} title="Copy invite link">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="2" />
            </svg>
            {code} {copied ? "· copied!" : "· copy invite"}
          </button>
        </div>
        <div className="header-actions">
          <button className="leave-btn" onClick={handleLeave}>
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Leave
          </button>
        </div>
      </header>

      <div className="room-body">
        <VideoPlayer
          socket={socket}
          initialVideoUrl={data.room.video_url}
          initialPlayback={{
            isPlaying: !!data.playback.is_playing,
            positionSeconds: data.playback.position_seconds,
            updatedAt: data.playback.updated_at,
          }}
        />
        <aside className="room-sidebar" data-tab={sidebarTab}>
          <div className="sidebar-tabs">
            <button
              className={sidebarTab === "chat" ? "active" : ""}
              aria-pressed={sidebarTab === "chat"}
              onClick={() => setSidebarTab("chat")}
            >
              Chat
            </button>
            <button
              className={sidebarTab === "people" ? "active" : ""}
              aria-pressed={sidebarTab === "people"}
              onClick={() => setSidebarTab("people")}
            >
              People
            </button>
          </div>
          <ParticipantList socket={socket} you={data.you.name} />
          <Chat socket={socket} initialMessages={data.messages} you={data.you.name} />
        </aside>
      </div>
    </div>
  );
}
