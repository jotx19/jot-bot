const { useState, useRef, useEffect } = React;

const MAX_INPUT_HEIGHT = 120;

function InputBar({ onSend, disabled, toolUsed }) {
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [text]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const canSend = !disabled && Boolean(text.trim());

  return (
    <div className="input-bar">
      <form className="input-row" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message"
          disabled={disabled}
          autoComplete="off"
          aria-label="Message"
        />
        <button
          type="submit"
          className={`send-btn${canSend ? ' send-btn--active' : ''}`}
          disabled={!canSend}
          aria-label="Send"
        >
          <Icon name="arrow-right" size={16} />
        </button>
      </form>
      <p className="input-hint">
        Press <kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for newline
      </p>
      {toolUsed && (
        <p className="footer-hint footer-hint--tool">
          <Icon name="wrench" size={12} />
          {toolUsed}
        </p>
      )}
    </div>
  );
}

window.InputBar = InputBar;
