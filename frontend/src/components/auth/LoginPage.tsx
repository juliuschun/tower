import React, { useState } from 'react';

interface LoginPageProps {
  isSetup: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
  error?: string;
}

export function LoginPage({ isSetup, onLogin, error }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    try {
      await onLogin(username, password);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-bg flex items-center justify-center p-4" style={{ minHeight: '100dvh' }}>
      <div className="w-full max-w-sm">
        {/* ── Branding ── */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-extrabold tracking-tight text-primary-500 mb-2">
            Tower
          </h1>
          <p className="text-sm text-gray-500 font-medium">
            Every task builds your tower.
          </p>
        </div>

        {/* ── Form Card ── */}
        <form
          onSubmit={handleSubmit}
          className="bg-surface-900 border border-surface-700 rounded-2xl p-7 space-y-5 shadow-lg shadow-black/20"
        >
          <p className="text-xs text-gray-500 text-center font-medium tracking-wide uppercase">
            {isSetup ? 'Create an admin account' : 'Sign in to continue'}
          </p>

          <div>
            <label htmlFor="login-username" className="block text-xs text-gray-400 mb-1.5 font-medium">
              Username
            </label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 transition-colors duration-200 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/40"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs text-gray-400 mb-1.5 font-medium">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 transition-colors duration-200 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/40"
              autoComplete={isSetup ? 'new-password' : 'current-password'}
            />
          </div>

          {error && (
            <div role="alert" className="text-sm text-red-400 bg-red-900/20 px-3 py-2.5 rounded-lg border border-red-800/30">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full py-2.5 bg-primary-600 hover:bg-primary-500 active:bg-primary-700 rounded-lg text-sm font-semibold tracking-wide transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:shadow-md hover:shadow-primary-600/20"
          >
            {loading ? 'Processing...' : isSetup ? 'Create account' : 'Sign in'}
          </button>
        </form>

        {/* ── Footer ── */}
        <p className="text-center text-[11px] text-gray-600 mt-6">
          Powered by Claude &middot; Enterprise AI
        </p>
      </div>
    </div>
  );
}
