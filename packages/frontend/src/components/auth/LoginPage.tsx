import React, { useState } from 'react';
import towerBg from '../../assets/tower-bg.png';

interface LoginPageProps {
  isSetup: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
  error?: string;
}

export function LoginPage({ isSetup, onLogin, error }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

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
    <div
      className="relative flex items-center justify-center min-h-full"
      style={{
        minHeight: '100dvh',
        background: 'linear-gradient(135deg, #0a0e1a 0%, #0f1629 40%, #131b33 100%)',
        overflow: 'hidden',
      }}
    >
      {/* ── Background tower image ── */}
      <img
        src={towerBg}
        alt=""
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center right',
          opacity: 0.4,
          maskImage: 'radial-gradient(ellipse 90% 90% at 60% 50%, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 90% at 60% 50%, black 30%, transparent 75%)',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />

      {/* ── Ambient glow effects ── */}
      <div
        style={{
          position: 'absolute',
          top: '20%',
          right: '25%',
          width: '500px',
          height: '500px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(196, 155, 55, 0.08) 0%, transparent 70%)',
          filter: 'blur(60px)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '10%',
          left: '10%',
          width: '400px',
          height: '400px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(196, 155, 55, 0.04) 0%, transparent 70%)',
          filter: 'blur(80px)',
          pointerEvents: 'none',
        }}
      />

      {/* ── Subtle grid pattern ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(196, 155, 55, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(196, 155, 55, 0.03) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
          pointerEvents: 'none',
        }}
      />

      {/* ── Main content ── */}
      <div className="relative z-10 flex flex-col items-center w-full max-w-md px-6">

        {/* ── Logo & Branding ── */}
        <div className="text-center mb-10">
          {/* Tower icon */}
          <div
            className="mx-auto mb-5"
            style={{
              width: '72px',
              height: '72px',
              borderRadius: '20px',
              background: 'linear-gradient(135deg, rgba(196, 155, 55, 0.15), rgba(196, 155, 55, 0.05))',
              border: '1px solid rgba(196, 155, 55, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 40px rgba(196, 155, 55, 0.1), inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 2L8 6V10L4 14V22H20V14L16 10V6L12 2Z"
                stroke="rgba(196, 155, 55, 0.9)"
                strokeWidth="1.5"
                strokeLinejoin="round"
                fill="rgba(196, 155, 55, 0.1)"
              />
              <line x1="4" y1="22" x2="20" y2="22" stroke="rgba(196, 155, 55, 0.9)" strokeWidth="1.5" />
              <line x1="8" y1="10" x2="16" y2="10" stroke="rgba(196, 155, 55, 0.5)" strokeWidth="1" />
              <line x1="6" y1="14" x2="18" y2="14" stroke="rgba(196, 155, 55, 0.5)" strokeWidth="1" />
              <rect x="10" y="17" width="4" height="5" rx="0.5" fill="rgba(196, 155, 55, 0.3)" stroke="rgba(196, 155, 55, 0.6)" strokeWidth="0.8" />
              <circle cx="12" cy="7" r="1" fill="rgba(196, 155, 55, 0.7)" />
            </svg>
          </div>

          <h1
            className="text-4xl font-extrabold tracking-tight mb-2"
            style={{
              background: 'linear-gradient(135deg, #c49b37 0%, #e8c55a 50%, #c49b37 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 2px 4px rgba(196, 155, 55, 0.3))',
            }}
          >
            Tower
          </h1>
          <p
            className="text-sm font-medium tracking-wide"
            style={{ color: 'rgba(196, 155, 55, 0.5)' }}
          >
            Every task builds your tower.
          </p>
        </div>

        {/* ── Form Card ── */}
        <form
          onSubmit={handleSubmit}
          className="w-full space-y-5"
          style={{
            background: 'linear-gradient(135deg, rgba(15, 20, 35, 0.85), rgba(20, 25, 45, 0.9))',
            border: '1px solid rgba(196, 155, 55, 0.12)',
            borderRadius: '20px',
            padding: '32px',
            boxShadow: `
              0 4px 24px rgba(0, 0, 0, 0.4),
              0 0 0 1px rgba(255, 255, 255, 0.03),
              inset 0 1px 0 rgba(255, 255, 255, 0.04)
            `,
            backdropFilter: 'blur(20px)',
          }}
        >
          <p
            className="text-[11px] text-center font-semibold tracking-[0.15em] uppercase"
            style={{ color: 'rgba(196, 155, 55, 0.45)' }}
          >
            {isSetup ? 'Create an admin account' : 'Sign in to continue'}
          </p>

          {/* Username */}
          <div>
            <label
              htmlFor="login-username"
              className="block text-xs mb-2 font-medium transition-colors duration-200"
              style={{ color: focused === 'username' ? 'rgba(196, 155, 55, 0.8)' : 'rgba(160, 170, 200, 0.6)' }}
            >
              Username
            </label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onFocus={() => setFocused('username')}
              onBlur={() => setFocused(null)}
              className="w-full rounded-xl px-4 py-3 text-sm text-gray-100 transition-all duration-300 outline-none"
              style={{
                background: 'rgba(10, 14, 26, 0.6)',
                border: focused === 'username'
                  ? '1px solid rgba(196, 155, 55, 0.4)'
                  : '1px solid rgba(100, 110, 140, 0.15)',
                boxShadow: focused === 'username'
                  ? '0 0 20px rgba(196, 155, 55, 0.08), inset 0 0 20px rgba(196, 155, 55, 0.03)'
                  : 'none',
              }}
              autoFocus
              autoComplete="username"
            />
          </div>

          {/* Password */}
          <div>
            <label
              htmlFor="login-password"
              className="block text-xs mb-2 font-medium transition-colors duration-200"
              style={{ color: focused === 'password' ? 'rgba(196, 155, 55, 0.8)' : 'rgba(160, 170, 200, 0.6)' }}
            >
              Password
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocused('password')}
              onBlur={() => setFocused(null)}
              className="w-full rounded-xl px-4 py-3 text-sm text-gray-100 transition-all duration-300 outline-none"
              style={{
                background: 'rgba(10, 14, 26, 0.6)',
                border: focused === 'password'
                  ? '1px solid rgba(196, 155, 55, 0.4)'
                  : '1px solid rgba(100, 110, 140, 0.15)',
                boxShadow: focused === 'password'
                  ? '0 0 20px rgba(196, 155, 55, 0.08), inset 0 0 20px rgba(196, 155, 55, 0.03)'
                  : 'none',
              }}
              autoComplete={isSetup ? 'new-password' : 'current-password'}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              role="alert"
              className="text-sm px-4 py-3 rounded-xl"
              style={{
                color: '#f87171',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.15)',
              }}
            >
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full py-3 rounded-xl text-sm font-bold tracking-wide transition-all duration-300 cursor-pointer disabled:cursor-not-allowed"
            style={{
              background: loading || !username || !password
                ? 'rgba(196, 155, 55, 0.15)'
                : 'linear-gradient(135deg, #b8922e, #c49b37, #d4a842)',
              color: loading || !username || !password
                ? 'rgba(196, 155, 55, 0.4)'
                : '#0a0e1a',
              boxShadow: loading || !username || !password
                ? 'none'
                : '0 4px 20px rgba(196, 155, 55, 0.25), 0 0 40px rgba(196, 155, 55, 0.08)',
              border: 'none',
            }}
            onMouseEnter={(e) => {
              if (!loading && username && password) {
                e.currentTarget.style.boxShadow = '0 6px 28px rgba(196, 155, 55, 0.35), 0 0 60px rgba(196, 155, 55, 0.12)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading && username && password) {
                e.currentTarget.style.boxShadow = '0 4px 20px rgba(196, 155, 55, 0.25), 0 0 40px rgba(196, 155, 55, 0.08)';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.3" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Processing...
              </span>
            ) : isSetup ? 'Create account' : 'Sign in'}
          </button>
        </form>

        {/* ── Footer ── */}
        <p
          className="text-center text-[11px] mt-8 font-medium tracking-wider"
          style={{ color: 'rgba(160, 170, 200, 0.25)' }}
        >
          Powered by Claude &middot; Enterprise AI
        </p>
      </div>
    </div>
  );
}

