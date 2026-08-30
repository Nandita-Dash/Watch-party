import { useCallback, useEffect, useRef, useState } from "react";

// Public STUN only — no TURN server. Peer-to-peer audio works for the large
// majority of home/typical networks; a client behind a strict/symmetric NAT
// or a locked-down corporate firewall won't be able to connect. Fixing that
// needs a TURN relay, which is separate paid infrastructure and out of scope
// here.
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

// Mesh WebRTC: every participant connects directly to every other
// participant. Signaling rides the existing room socket (voice:* events);
// actual audio never touches the server. Fine for watch-party-sized rooms —
// it doesn't scale gracefully much past 6-8 simultaneous voice participants.
export function useVoiceChat(socket) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(null);
  const [voicePeers, setVoicePeers] = useState({}); // socketId -> { userId, name }

  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map()); // socketId -> RTCPeerConnection
  const audioElsRef = useRef(new Map()); // socketId -> HTMLAudioElement

  const cleanupPeer = useCallback((socketId) => {
    peersRef.current.get(socketId)?.close();
    peersRef.current.delete(socketId);

    const audioEl = audioElsRef.current.get(socketId);
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      audioElsRef.current.delete(socketId);
    }

    setVoicePeers((prev) => {
      if (!(socketId in prev)) return prev;
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
  }, []);

  const cleanupAllPeers = useCallback(() => {
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    audioElsRef.current.forEach((el) => {
      el.srcObject = null;
      el.remove();
    });
    audioElsRef.current.clear();
    setVoicePeers({});
  }, []);

  const createPeerConnection = useCallback(
    (socketId) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit("voice:ice-candidate", { to: socketId, candidate: e.candidate });
        }
      };

      pc.ontrack = (e) => {
        let audioEl = audioElsRef.current.get(socketId);
        if (!audioEl) {
          audioEl = new Audio();
          audioEl.autoplay = true;
          audioElsRef.current.set(socketId, audioEl);
        }
        audioEl.srcObject = e.streams[0];
      };

      peersRef.current.set(socketId, pc);
      return pc;
    },
    [socket]
  );

  const joinVoice = useCallback(async () => {
    if (!socket || joined) return;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser doesn't support voice chat.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setJoined(true);
      setMuted(false);
      socket.emit("voice:join");
    } catch {
      setError("Microphone access was denied or unavailable.");
    }
  }, [socket, joined]);

  const leaveVoice = useCallback(() => {
    if (!socket || !joined) return;
    socket.emit("voice:leave");
    cleanupAllPeers();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setJoined(false);
    setMuted(false);
  }, [socket, joined, cleanupAllPeers]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    setMuted((prev) => {
      const next = !prev;
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!socket) return undefined;

    async function handleRoster(roster) {
      for (const peer of roster) {
        setVoicePeers((prev) => ({ ...prev, [peer.socketId]: { userId: peer.userId, name: peer.name } }));
        const pc = createPeerConnection(peer.socketId);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("voice:offer", { to: peer.socketId, sdp: offer });
        } catch {
          cleanupPeer(peer.socketId);
        }
      }
    }

    function handlePeerJoined(peer) {
      // Just track it for UI purposes — the newcomer initiates the offer,
      // so there's nothing to connect yet.
      setVoicePeers((prev) => ({ ...prev, [peer.socketId]: { userId: peer.userId, name: peer.name } }));
    }

    function handlePeerLeft({ socketId }) {
      cleanupPeer(socketId);
    }

    async function handleOffer({ from, sdp }) {
      const pc = peersRef.current.get(from) || createPeerConnection(from);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("voice:answer", { to: from, sdp: answer });
      } catch {
        cleanupPeer(from);
      }
    }

    async function handleAnswer({ from, sdp }) {
      const pc = peersRef.current.get(from);
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      } catch {
        cleanupPeer(from);
      }
    }

    async function handleIceCandidate({ from, candidate }) {
      const pc = peersRef.current.get(from);
      if (!pc || !candidate) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Benign — can happen if a trickled candidate arrives after the
        // connection already closed.
      }
    }

    socket.on("voice:roster", handleRoster);
    socket.on("voice:peer-joined", handlePeerJoined);
    socket.on("voice:peer-left", handlePeerLeft);
    socket.on("voice:offer", handleOffer);
    socket.on("voice:answer", handleAnswer);
    socket.on("voice:ice-candidate", handleIceCandidate);

    return () => {
      socket.off("voice:roster", handleRoster);
      socket.off("voice:peer-joined", handlePeerJoined);
      socket.off("voice:peer-left", handlePeerLeft);
      socket.off("voice:offer", handleOffer);
      socket.off("voice:answer", handleAnswer);
      socket.off("voice:ice-candidate", handleIceCandidate);
    };
  }, [socket, createPeerConnection, cleanupPeer]);

  // A dropped/reconnected socket gets a new id server-side, which orphans
  // every existing peer connection (they're keyed by the old id). Rejoin
  // cleanly rather than silently sitting in a broken voice session.
  useEffect(() => {
    if (!socket) return undefined;
    function handleReconnect() {
      if (!joined) return;
      cleanupAllPeers();
      socket.emit("voice:join");
    }
    socket.on("connect", handleReconnect);
    return () => socket.off("connect", handleReconnect);
  }, [socket, joined, cleanupAllPeers]);

  // Leave voice cleanly if the component unmounts while still joined (e.g.
  // navigating away without explicitly leaving voice first).
  useEffect(() => {
    return () => {
      peersRef.current.forEach((pc) => pc.close());
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { joined, muted, error, voicePeers, joinVoice, leaveVoice, toggleMute };
}
