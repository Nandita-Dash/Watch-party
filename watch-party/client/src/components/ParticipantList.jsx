import { useEffect, useState } from "react";
import { avatarClassFor, initialsFor } from "../lib/avatar.js";

function MicIcon() {
  return (
    <svg className="mic-indicator" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function ParticipantList({ socket, you, voicePeers = {}, youInVoice = false }) {
  const [participants, setParticipants] = useState([]);

  useEffect(() => {
    function onList(list) {
      setParticipants(list);
    }
    function onJoin(user) {
      setParticipants((prev) =>
        prev.some((p) => p.userId === user.userId) ? prev : [...prev, user]
      );
    }
    function onLeave(user) {
      setParticipants((prev) => prev.filter((p) => p.userId !== user.userId));
    }

    socket.on("presence:list", onList);
    socket.on("presence:join", onJoin);
    socket.on("presence:leave", onLeave);
    return () => {
      socket.off("presence:list", onList);
      socket.off("presence:join", onJoin);
      socket.off("presence:leave", onLeave);
    };
  }, [socket]);

  return (
    <div className="participants">
      <h3>In the room ({participants.length})</h3>
      {participants.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M5 20c.9-3.6 3.8-5.5 7-5.5s6.1 1.9 7 5.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <p>No one's here yet.</p>
        </div>
      ) : (
        <ul>
          {participants.map((p) => {
            const inVoice =
              p.name === you ? youInVoice : Object.values(voicePeers).some((v) => v.userId === p.userId);
            return (
              <li key={p.userId}>
                <span className={`avatar avatar-sm ${avatarClassFor(p.name)}`}>{initialsFor(p.name)}</span>
                <span className="presence-name">{p.name}</span>
                {inVoice && <MicIcon />}
                <span className="dot" />
                {p.name === you && <span className="you-tag">you</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
