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
    <div className="min-h-screen app-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary-500 mb-2">Claude Desk</h1>
          <p className="text-sm text-gray-500">
            {isSetup ? '관리자 계정을 생성하세요' : '로그인'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-surface-900 border border-surface-700 rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">사용자명</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-primary-600"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-primary-600"
            />
          </div>

          {error && (
            <div className="text-sm text-red-400 bg-red-900/20 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full py-2 bg-primary-600 hover:bg-primary-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? '처리 중...' : isSetup ? '계정 생성' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  );
}
