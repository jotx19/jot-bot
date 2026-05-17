const { useEffect, useRef } = React;

function ChatWindow({ messages, isThinking }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  return (
    <div className="chat-window">
      {messages.length === 0 && !isThinking && (
        <div className="empty-state">
          <Icon name="sparkles" size={32} className="empty-icon" />
          <h2>tinyjot</h2>
          <p>
            Ask anything. Memory, search, and tools — built in.
          </p>
        </div>
      )}

      {messages.map((msg, i) => {
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const sameAsPrev = prev?.role === msg.role;
        const sameAsNext = next?.role === msg.role;

        return (
          <MessageBubble
            key={msg.id}
            message={msg}
            grouped={sameAsPrev || sameAsNext}
            groupStart={!sameAsPrev && sameAsNext}
            groupEnd={!sameAsNext}
          />
        );
      })}

      {isThinking && (
        <div className="message-row assistant thinking">
          <div className="msg-avatar" aria-hidden="true">
            <Icon name="bot" size={14} />
          </div>
          <div className="think-row">
            <span className="think-dots" aria-label="Typing">
              <span /><span /><span />
            </span>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

window.ChatWindow = ChatWindow;
