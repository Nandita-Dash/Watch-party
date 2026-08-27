import { useEffect, useState } from "react";
import { avatarClassFor, initialsFor } from "../lib/avatar.js";

export default function ParticipantList({ socket, you }) {
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
      <ul>
        {participants.map((p) => (
          <li key={p.userId}>
            <span className={`avatar avatar-sm ${avatarClassFor(p.name)}`}>{initialsFor(p.name)}</span>
            <span className="presence-name">{p.name}</span>
            <span className="dot" />
            {p.name === you && <span className="you-tag">you</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
