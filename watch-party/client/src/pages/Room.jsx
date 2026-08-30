import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getRoom } from "../lib/api.js";
import { loadToken, clearToken } from "../lib/session.js";
import { connectSocket } from "../lib/socket.js";
import { useVoiceChat } from "../lib/useVoiceChat.js";
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
  // Purely presentational — VideoPlayer reports drift/latency here for the
  // header's sync indicator; the correction math lives entirely in VideoPlayer.
  const [syncInfo, setSyncInfo] = useState({ driftMs: null, roundTripMs: null, lastActionBy: null });
  const handleSyncChange = useCallback((update) => {
    setSyncInfo((prev) => ({ ...prev, ...update }));
  }, []);
  const voice = useVoiceChat(socket);

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

  useEffect(() => {
    if (!data) return undefined;
    const previousTitle = document.title;
    document.title = `${data.room.name} · Watch Party`;
    return () => {
      document.title = previousTitle;
    };
  }, [data]);

  function handleLeave() {
    voice.leaveVoice();
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
            <button
              className={`code-pill ${copied ? "copied-bounce" : ""}`}
              onClick={handleCopyInvite}
              title="Copy invite link"
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="2" />
              </svg>
              {code} {copied ? "· copied!" : "· copy invite"}
            </button>
          </div>
        </div>
        <div className="header-actions">
          <span
            className={`sync-pill ${
              syncInfo.driftMs === null ? "" : Math.abs(syncInfo.driftMs) <= 150 ? "good" : "bad"
            }`}
            title={`drift ${syncInfo.driftMs === null ? "—" : `${syncInfo.driftMs} ms`} · latency ${
              syncInfo.roundTripMs === null ? "—" : `${syncInfo.roundTripMs} ms`
            }${syncInfo.lastActionBy ? ` · last action by ${syncInfo.lastActionBy}` : ""}`}
          >
            <span className="sync-dot" />
            {syncInfo.driftMs === null ? "Syncing…" : Math.abs(syncInfo.driftMs) <= 150 ? "Synced" : "Drifting"}
          </span>

          {voice.error && (
            <span className="voice-error" title={voice.error}>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M12 9v4m0 4h.01M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          )}

          {!voice.joined ? (
            <button type="button" className="voice-btn join" onClick={voice.joinVoice} title="Join voice chat">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="M5 11a7 7 0 0 0 14 0M12 18v3"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              Voice
            </button>
          ) : (
            <div className="voice-controls">
              <button
                type="button"
                className={`voice-btn mic ${voice.muted ? "muted" : ""}`}
                onClick={voice.toggleMute}
                title={voice.muted ? "Unmute" : "Mute"}
              >
                {voice.muted ? (
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M9 9v2a3 3 0 0 0 4.6 2.5M15 6.5V5a3 3 0 0 0-5.9-.7M5 11a7 7 0 0 0 10.5 6.1M19 11a6.98 6.98 0 0 1-1.1 3.8M12 18v3M3 3l18 18"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
                    <path
                      d="M5 11a7 7 0 0 0 14 0M12 18v3"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </button>
              <button type="button" className="voice-btn leave" onClick={voice.leaveVoice} title="Leave voice chat">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}

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
          onSyncChange={handleSyncChange}
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
          <ParticipantList
            socket={socket}
            you={data.you.name}
            voicePeers={voice.voicePeers}
            youInVoice={voice.joined}
          />
          <Chat socket={socket} initialMessages={data.messages} you={data.you.name} />
        </aside>
      </div>
    </div>
  );
}
