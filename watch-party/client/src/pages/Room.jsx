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
    return <div className="room-loading">Loading room…</div>;
  }

  return (
    <div className="room">
      <header className="room-header">
        <div>
          <h2>{data.room.name}</h2>
          <button className="code-pill" onClick={handleCopyInvite} title="Copy invite link">
            {code} {copied ? "· copied!" : "· copy invite"}
          </button>
        </div>
        <button className="leave-btn" onClick={handleLeave}>
          Leave
        </button>
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
        <aside className="room-sidebar">
          <ParticipantList socket={socket} you={data.you.name} />
          <Chat socket={socket} initialMessages={data.messages} you={data.you.name} />
        </aside>
      </div>
    </div>
  );
}
