import { useEffect, useRef, useState } from "react";

export default function Chat({ socket, initialMessages, you }) {
  const [messages, setMessages] = useState(initialMessages || []);
  const [draft, setDraft] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    function onMessage(message) {
      setMessages((prev) => [...prev, message]);
    }
    socket.on("chat:message", onMessage);
    return () => socket.off("chat:message", onMessage);
  }, [socket]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

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
