const { useState } = React;

function LoginGate({ onAuthenticated, userAuth }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const body = userAuth
        ? { username: username.trim(), password }
        : { password };

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }
      onAuthenticated(data.user || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = userAuth
    ? Boolean(username.trim() && password)
    : Boolean(password);

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <Icon name="sparkles" size={24} className="brand-icon" />
          <h1>tiny<span>jot</span></h1>
        </div>
        <p className="auth-subtitle">
          {userAuth
            ? 'Sign in to your personal assistant'
            : 'Enter access password'}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {userAuth && (
            <>
              <label className="auth-label" htmlFor="auth-username">
                Username
              </label>
              <input
                id="auth-username"
                type="text"
                className="auth-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                autoComplete="username"
                autoFocus
                disabled={loading}
              />
            </>
          )}
          <label className="auth-label" htmlFor="auth-password">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            className="auth-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={userAuth ? 'password' : 'Enter access password'}
            autoComplete="current-password"
            autoFocus={!userAuth}
            disabled={loading}
          />
          {error && (
            <p className="auth-error" role="alert">
              <Icon name="alert" size={14} />
              {error}
            </p>
          )}
          <button type="submit" className="auth-submit" disabled={loading || !canSubmit}>
            {loading ? 'Signing in…' : 'Continue'}
          </button>
        </form>

        {userAuth && (
          <p className="auth-footer">
            No account? <a href="/register.html">Register</a>
          </p>
        )}
      </div>
    </div>
  );
}

window.LoginGate = LoginGate;
