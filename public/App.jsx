const { useState, useEffect, useCallback } = React;

const SESSION_KEY = 'tinyjot-session-id';
const API_OPTS = { credentials: 'include' };

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function toUiMessages(apiMessages) {
  return apiMessages.map((m, i) => ({
    id: `restored-${i}-${Date.now()}`,
    role: m.role,
    content: m.content,
    intent: m.intent || null,
    toolUsed: m.toolUsed || null,
  }));
}

function toApiHistory(messages) {
  return messages
    .filter((m) => m.content && !m.streaming)
    .map((m) => ({ role: m.role, content: m.content }));
}

async function streamChat(message, sessionId, history, onToken, onDone, onError) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    ...API_OPTS,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ message, sessionId, history, stream: true }),
  });

  if (res.status === 401) {
    throw new Error('Session expired — please sign in again');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === 'token') onToken(event.content);
        if (event.type === 'done') onDone(event);
        if (event.type === 'error') onError(event.error);
      } catch {
        /* skip */
      }
    }
  }
}

function ChatApp({ onLogout, discordInviteUrl }) {
  const [sessionId] = useState(getSessionId);
  const [messages, setMessages] = useState([]);
  const [isThinking, setIsThinking] = useState(false);
  const [lastToolUsed, setLastToolUsed] = useState(null);
  const [error, setError] = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [inviteDismissed, setInviteDismissed] = useState(() => {
    try {
      return localStorage.getItem('tinyjot-discord-invite-dismissed-v2') === '1';
    } catch {
      return false;
    }
  });
  const [inviteUrl, setInviteUrl] = useState(discordInviteUrl || null);

  useEffect(() => {
    setInviteUrl(discordInviteUrl || null);
  }, [discordInviteUrl]);

  // Belt-and-suspenders: refresh invite link if parent passed null (stale /api/auth/me)
  useEffect(() => {
    if (inviteUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', API_OPTS);
        const data = await res.json();
        if (!cancelled && data.discordInviteUrl) {
          setInviteUrl(data.discordInviteUrl);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteUrl]);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const res = await fetch(`/api/session/${sessionId}`, API_OPTS);
        if (res.status === 401) {
          onLogout();
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.messages?.length) {
          setMessages(toUiMessages(data.messages));
        }
      } catch (err) {
        console.warn('Session restore failed:', err.message);
      } finally {
        if (!cancelled) setSessionLoaded(true);
      }
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, [sessionId, onLogout]);

  const handleSend = useCallback(
    async (text) => {
      setError(null);

      const userMsg = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
      };

      const assistantId = `a-${Date.now()}`;
      let gotFirstToken = false;

      setMessages((prev) => [...prev, userMsg]);
      setIsThinking(true);

      const history = toApiHistory(messages);

      try {
        await streamChat(
          text,
          sessionId,
          history,
          (chunk) => {
            if (!gotFirstToken) {
              gotFirstToken = true;
              setIsThinking(false);
            }
            setMessages((prev) => {
              const exists = prev.some((m) => m.id === assistantId);
              if (!exists) {
                return [
                  ...prev,
                  {
                    id: assistantId,
                    role: 'assistant',
                    content: chunk,
                    streaming: true,
                  },
                ];
              }
              return prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + chunk }
                  : m
              );
            });
          },
          (event) => {
            setIsThinking(false);
            setLastToolUsed(event.toolUsed || null);
            setMessages((prev) => {
              const exists = prev.some((m) => m.id === assistantId);
              const assistant = {
                id: assistantId,
                role: 'assistant',
                content: event.reply || '',
                intent: event.intent,
                toolUsed: event.toolUsed,
                streaming: false,
              };
              if (!exists) return [...prev, assistant];
              return prev.map((m) =>
                m.id === assistantId ? { ...m, ...assistant, content: event.reply || m.content } : m
              );
            });
          },
          (errMsg) => {
            throw new Error(errMsg);
          }
        );
      } catch (err) {
        setIsThinking(false);
        if (err.message.includes('sign in')) {
          onLogout();
          return;
        }
        setError(err.message);
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== assistantId),
          {
            id: assistantId,
            role: 'assistant',
            content: `Something went wrong: ${err.message}`,
            intent: 'ERROR',
            streaming: false,
          },
        ]);
      } finally {
        setIsThinking(false);
      }
    },
    [messages, sessionId, onLogout]
  );

  const handleClearChat = useCallback(async () => {
    if (isThinking || messages.length === 0) return;
    if (!window.confirm('Clear this conversation?')) return;

    setError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}/clear`, {
        method: 'POST',
        ...API_OPTS,
      });
      if (res.status === 401) {
        onLogout();
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Clear failed (${res.status})`);
      }
      setMessages([]);
      setLastToolUsed(null);
    } catch (err) {
      setError(err.message);
    }
  }, [isThinking, messages.length, sessionId, onLogout]);

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', ...API_OPTS });
    onLogout();
  }, [onLogout]);

  const canClear = messages.length > 0 && !isThinking;
  const showInvite = Boolean(inviteUrl) && !inviteDismissed;

  const dismissInvite = () => {
    setInviteDismissed(true);
    try {
      localStorage.setItem('tinyjot-discord-invite-dismissed-v2', '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <Icon name="sparkles" size={20} className="brand-icon" />
          <h1>tiny<span>jot</span></h1>
        </div>
        <div className="header-actions">
          {inviteUrl && (
            <a
              href={inviteUrl}
              className="discord-invite-btn"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Add bot to Discord"
            >
              Add to Discord
            </a>
          )}
          <a href="/settings.html" className="clear-chat-btn" aria-label="Settings">
            Settings
          </a>
          <button
            type="button"
            className="clear-chat-btn"
            onClick={handleClearChat}
            disabled={!canClear}
            aria-label="Clear chat"
          >
            <Icon name="trash" size={14} />
            Clear
          </button>
          <button
            type="button"
            className="clear-chat-btn"
            onClick={handleLogout}
            aria-label="Sign out"
          >
            Sign out
          </button>
          <span className="header-meta">
            {sessionLoaded ? 'ready' : '…'}
          </span>
        </div>
      </header>

      {showInvite && (
        <div className="discord-banner">
          <div className="discord-banner-text">
            <strong>Add bot to your Discord</strong>
            <span>Invite jotbot to a server, then chat with @mentions.</span>
          </div>
          <div className="discord-banner-actions">
            <a
              href={inviteUrl}
              className="discord-banner-cta"
              target="_blank"
              rel="noopener noreferrer"
            >
              Add to Discord
            </a>
            <button type="button" className="discord-banner-dismiss" onClick={dismissInvite}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="error-banner">
          <Icon name="alert" size={14} />
          {error}
        </div>
      )}

      <ChatWindow messages={messages} isThinking={isThinking} />
      <InputBar onSend={handleSend} disabled={isThinking} toolUsed={lastToolUsed} />
    </div>
  );
}

function App() {
  const [auth, setAuth] = useState({
    checking: true,
    required: false,
    authenticated: false,
    userAuth: false,
    discordInviteUrl: null,
  });

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', API_OPTS);
      const data = await res.json();
      setAuth({
        checking: false,
        required: Boolean(data.authRequired),
        authenticated: Boolean(data.authenticated),
        userAuth: Boolean(data.userAuth),
        discordInviteUrl: data.discordInviteUrl || null,
      });
    } catch {
      setAuth({
        checking: false,
        required: true,
        authenticated: false,
        userAuth: true,
        discordInviteUrl: null,
      });
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleLogout = useCallback(() => {
    setAuth((prev) => ({
      ...prev,
      checking: false,
      required: true,
      authenticated: false,
    }));
  }, []);

  if (auth.checking) {
    return (
      <div className="auth-screen">
        <p className="auth-loading">Loading…</p>
      </div>
    );
  }

  if (auth.required && !auth.authenticated) {
    return (
      <LoginGate
        userAuth={auth.userAuth}
        onAuthenticated={() => {
          // Re-fetch /api/auth/me so discordInviteUrl and user are fresh
          checkAuth();
        }}
      />
    );
  }

  return (
    <ChatApp onLogout={handleLogout} discordInviteUrl={auth.discordInviteUrl} />
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
