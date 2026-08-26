import { useEffect, useRef, useState } from "react";

export default function Chat({ socket, initialMessages, you }) {
  const [messages, setMessages] = useState(initialMessages || []);
  const [draft, setDraft] = useState("");
  const listRef = useRef(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    function onMessage(message) {
      setMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message]
      );
    }

    function onMissed(missed) {
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        const toAdd = missed.filter((m) => !known.has(m.id));
        if (!toAdd.length) return prev;
        return [...prev, ...toAdd].sort((a, b) => a.id - b.id);
      });
    }

    // Ask for anything sent while this socket was offline. Runs on every
    // (re)connect — including the very first one, in case a message landed
    // in the gap between the REST history fetch and the socket joining.
    function onConnect() {
      const lastId = messagesRef.current.reduce((max, m) => Math.max(max, m.id), 0);
      socket.emit("chat:sync", lastId);
    }

    socket.on("chat:message", onMessage);
    socket.on("chat:missed", onMissed);
    socket.on("connect", onConnect);
    if (socket.connected) onConnect();

    return () => {
      socket.off("chat:message", onMessage);
      socket.off("chat:missed", onMissed);
      socket.off("connect", onConnect);
    };
  }, [socket]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  // On narrow screens the chat shares the sidebar with the participant list
  // and is display:none while the other panel is showing — messages that
  // arrive meanwhile can't be scrolled to, because the list has no height.
  // Re-pin to the bottom whenever it gets its height back.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return undefined;
    let wasHidden = list.clientHeight === 0;
    const observer = new ResizeObserver(() => {
      const hidden = list.clientHeight === 0;
      if (wasHidden && !hidden) list.scrollTo({ top: list.scrollHeight });
      wasHidden = hidden;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    socket.emit("chat:message", { body: draft.trim() });
    setDraft("");
  }

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && <p className="chat-empty">No messages yet — say hi.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.senderName === you ? "mine" : ""}`}>
            <span className="chat-sender">{m.senderName}</span>
            <span className="chat-body">{m.body}</span>
          </div>
        ))}
      </div>
      <form className="chat-form" onSubmit={handleSubmit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the room…"
          maxLength={1000}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
