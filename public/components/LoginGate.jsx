const { useState } = React;

function LoginGate({ onAuthenticated }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }
      onAuthenticated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <Icon name="sparkles" size={24} className="brand-icon" />
          <h1>tiny<span>jot</span></h1>
        </div>
        <p className="auth-subtitle">Sign in to your personal assistant</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label" htmlFor="auth-password">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            className="auth-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter access password"
            autoComplete="current-password"
            autoFocus
            disabled={loading}
          />
          {error && (
            <p className="auth-error" role="alert">
              <Icon name="alert" size={14} />
              {error}
            </p>
          )}
          <button type="submit" className="auth-submit" disabled={loading || !password}>
            {loading ? 'Signing in…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}

window.LoginGate = LoginGate;
