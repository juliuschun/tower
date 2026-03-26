/**
 * OAuthConnections — 외부 서비스 연결 관리 UI.
 * Settings 모달 안에 렌더링됩니다.
 */
import React, { useEffect, useState } from 'react';

interface ProviderStatus {
  connected: boolean;
  nickname?: string;
}

const PROVIDERS = [
  {
    id: 'kakao',
    name: 'KakaoTalk',
    icon: '💬',
    color: 'text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10',
    connectedColor: 'text-yellow-300 border-yellow-500/50 bg-yellow-500/10',
  },
  // Future:
  // { id: 'slack', name: 'Slack', icon: '#', ... },
  // { id: 'telegram', name: 'Telegram', icon: '✈️', ... },
];

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export function OAuthConnections() {
  const [status, setStatus] = useState<Record<string, ProviderStatus>>({});
  const [loading, setLoading] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/auth/oauth/status', { headers: getAuthHeaders() });
      if (res.ok) setStatus(await res.json());
    } catch {}
  };

  useEffect(() => {
    fetchStatus();

    // Check if returning from OAuth callback
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth')) {
      window.history.replaceState({}, '', window.location.pathname);
      fetchStatus();
    }
  }, []);

  const connect = async (provider: string) => {
    setLoading(provider);
    try {
      const res = await fetch(`/api/auth/${provider}`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (res.ok && data.url) {
        // Redirect to OAuth consent page
        window.location.href = data.url;
        return; // Don't clear loading — page is navigating away
      }
      console.error('[OAuth] connect failed:', data);
      alert(`연결 실패: ${data.error || 'Unknown error'}`);
    } catch (err: any) {
      console.error('[OAuth] connect error:', err);
      alert(`연결 오류: ${err.message}`);
    } finally {
      setLoading(null);
    }
  };

  const disconnect = async (provider: string) => {
    if (!confirm('연결을 해제하시겠습니까?')) return;
    setLoading(provider);
    try {
      await fetch(`/api/auth/oauth/${provider}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      await fetchStatus();
    } finally {
      setLoading(null);
    }
  };

  const testMessage = async (provider: string) => {
    setLoading(provider);
    try {
      const res = await fetch(`/api/auth/oauth/${provider}/test`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const result = await res.json();
      alert(result.success ? '✅ 테스트 메시지를 보냈습니다! 카카오톡을 확인하세요.' : `❌ 전송 실패: ${result.error}`);
    } catch (err: any) {
      alert(`❌ 오류: ${err.message}`);
    } finally {
      setLoading(null);
    }
  };

  // Don't render if no providers configured (check by presence of at least one provider in status)
  // Always render — shows "연결" button even before status loads

  return (
    <section>
      <h3 className="text-[12px] font-semibold text-surface-500 uppercase tracking-wider mb-3">
        Connections
      </h3>
      <div className="space-y-2">
        {PROVIDERS.map((p) => {
          const s = status[p.id];
          const connected = s?.connected;
          const isLoading = loading === p.id;

          return (
            <div
              key={p.id}
              className={`flex items-center justify-between py-2.5 px-3 rounded-lg border transition-all ${
                connected ? p.connectedColor : 'border-surface-700'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base shrink-0">{p.icon}</span>
                <span className="text-xs font-medium text-gray-200">{p.name}</span>
                {connected && s?.nickname && (
                  <span className="text-[10px] text-surface-500 truncate">({s.nickname})</span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {connected ? (
                  <>
                    <button
                      onClick={() => testMessage(p.id)}
                      disabled={isLoading}
                      className="px-2 py-1 text-[10px] font-medium text-surface-400 hover:text-gray-200 transition-colors disabled:opacity-50"
                    >
                      테스트
                    </button>
                    <button
                      onClick={() => disconnect(p.id)}
                      disabled={isLoading}
                      className="px-2 py-1 text-[10px] font-medium text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                    >
                      해제
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => connect(p.id)}
                    disabled={isLoading}
                    className={`px-3 py-1 text-[10px] font-semibold rounded-md border transition-all disabled:opacity-50 ${p.color}`}
                  >
                    {isLoading ? '...' : '연결'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
