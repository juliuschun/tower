/**
 * OAuthConnections — 외부 서비스 연결 관리 UI.
 * Settings 모달 안에 렌더링됩니다.
 *
 * 두 섹션:
 * 1. Connections — 개인 OAuth provider 연결 현황 (Google, Kakao, Telegram 등)
 * 2. Skill Readiness — 내가 쓸 수 있는/없는 스킬 현황 (credential 기반)
 */
import { useEffect, useState } from 'react';
import type { ConnectionStatus, SkillReadiness } from '@tower/shared';

interface ProviderStatus {
  connected: boolean;
  nickname?: string;
}

interface ProviderConfig {
  id: string;
  name: string;
  icon: string;
  color: string;
  connectedColor: string;
  connectMode: 'oauth' | 'deeplink';
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'google',
    name: 'Google',
    icon: '🔵',
    color: 'text-blue-400 border-blue-500/30 hover:bg-blue-500/10',
    connectedColor: 'text-blue-300 border-blue-500/50 bg-blue-500/10',
    connectMode: 'oauth',
  },
  {
    id: 'kakao',
    name: 'KakaoTalk',
    icon: '💬',
    color: 'text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10',
    connectedColor: 'text-yellow-300 border-yellow-500/50 bg-yellow-500/10',
    connectMode: 'oauth',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    icon: '✈️',
    color: 'text-blue-400 border-blue-500/30 hover:bg-blue-500/10',
    connectedColor: 'text-blue-300 border-blue-500/50 bg-blue-500/10',
    connectMode: 'deeplink',
  },
];

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export function OAuthConnections() {
  const [status, setStatus] = useState<Record<string, ProviderStatus>>({});
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [skillReadiness, setSkillReadiness] = useState<SkillReadiness[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
  const [showReadiness, setShowReadiness] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/auth/oauth/status', { headers: getAuthHeaders() });
      if (res.ok) setStatus(await res.json());
    } catch {}
  };

  const fetchConnections = async () => {
    try {
      const res = await fetch('/api/me/connections', { headers: getAuthHeaders() });
      if (res.ok) setConnections(await res.json());
    } catch {}
  };

  const fetchSkillReadiness = async () => {
    try {
      const res = await fetch('/api/me/skill-readiness', { headers: getAuthHeaders() });
      if (res.ok) setSkillReadiness(await res.json());
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    fetchConnections();

    // Check if returning from OAuth callback
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth')) {
      window.history.replaceState({}, '', window.location.pathname);
      fetchStatus();
      fetchConnections();
    }
  }, []);

  // Poll status while waiting for Telegram link (user may link from phone)
  useEffect(() => {
    if (!telegramLink) return;
    const interval = setInterval(async () => {
      await fetchStatus();
      await fetchConnections();
    }, 3000);
    return () => clearInterval(interval);
  }, [telegramLink]);

  // Auto-close Telegram link when connected
  useEffect(() => {
    if (telegramLink && status['telegram']?.connected) {
      setTelegramLink(null);
    }
  }, [status, telegramLink]);

  // Load skill readiness on demand
  useEffect(() => {
    if (showReadiness && skillReadiness.length === 0) {
      fetchSkillReadiness();
    }
  }, [showReadiness]);

  const connect = async (provider: string, mode: 'oauth' | 'deeplink') => {
    setLoading(provider);
    try {
      if (mode === 'deeplink') {
        // Telegram: get link token, show deep link
        const res = await fetch('/api/auth/telegram/link', {
          method: 'POST',
          headers: getAuthHeaders(),
        });
        const data = await res.json();
        if (res.ok && data.deepLink) {
          setTelegramLink(data.deepLink);
          window.open(data.deepLink, '_blank');
        } else if (res.ok && data.token) {
          setTelegramLink(`token:${data.token}`);
        } else {
          alert(`연결 실패: ${data.error || 'Unknown error'}`);
        }
      } else {
        // OAuth redirect flow (Kakao, Google, etc.)
        const res = await fetch(`/api/auth/${provider}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (res.ok && data.url) {
          window.location.href = data.url;
          return;
        }
        alert(`연결 실패: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
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
      setTelegramLink(null);
      await fetchStatus();
      await fetchConnections();
      if (showReadiness) await fetchSkillReadiness();
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
      const channel = provider === 'telegram' ? 'Telegram' : provider === 'kakao' ? '카카오톡' : provider;
      alert(result.success ? `✅ 테스트 메시지를 보냈습니다! ${channel}을 확인하세요.` : `❌ 전송 실패: ${result.error}`);
    } catch (err: any) {
      alert(`❌ 오류: ${err.message}`);
    } finally {
      setLoading(null);
    }
  };

  // Merge PROVIDERS config with live connection status
  const getProviderStatus = (providerId: string) => {
    const s = status[providerId];
    const c = connections.find(c => c.provider === providerId);
    return {
      connected: s?.connected || c?.connected || false,
      nickname: s?.nickname || c?.nickname || undefined,
    };
  };

  return (
    <>
      {/* ── Connections ── */}
      <section>
        <h3 className="text-[12px] font-semibold text-surface-500 uppercase tracking-wider mb-3">
          Connections
        </h3>
        <div className="space-y-2">
          {PROVIDERS.map((p) => {
            const s = getProviderStatus(p.id);
            const connected = s.connected;
            const isLoading = loading === p.id;

            return (
              <div key={p.id}>
                <div
                  className={`flex items-center justify-between py-2.5 px-3 rounded-lg border transition-all ${
                    connected ? p.connectedColor : 'border-surface-700'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-base shrink-0">{p.icon}</span>
                    <span className="text-xs font-medium text-gray-200">{p.name}</span>
                    {connected && s.nickname && (
                      <span className="text-[10px] text-surface-500 truncate">({s.nickname})</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {connected ? (
                      <>
                        {/* Test button — only for messaging providers */}
                        {(p.id === 'kakao' || p.id === 'telegram') && (
                          <button
                            onClick={() => testMessage(p.id)}
                            disabled={isLoading}
                            className="px-2 py-1 text-[10px] font-medium text-surface-400 hover:text-gray-200 transition-colors disabled:opacity-50"
                          >
                            테스트
                          </button>
                        )}
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
                        onClick={() => connect(p.id, p.connectMode)}
                        disabled={isLoading}
                        className={`px-3 py-1 text-[10px] font-semibold rounded-md border transition-all disabled:opacity-50 ${p.color}`}
                      >
                        {isLoading ? '...' : '연결'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Telegram deep link waiting state */}
                {p.id === 'telegram' && telegramLink && !connected && (
                  <div className="mt-1.5 px-3 py-2 rounded-md bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-300">
                    <p className="mb-1.5">
                      📱 Telegram 앱에서 봇과 대화를 시작하세요.
                    </p>
                    {telegramLink.startsWith('http') ? (
                      <a
                        href={telegramLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block px-2 py-1 bg-blue-500/20 rounded text-blue-200 hover:bg-blue-500/30 transition-colors"
                      >
                        Telegram에서 열기 →
                      </a>
                    ) : (
                      <p className="text-[10px] text-blue-400/70">
                        봇에게 <code className="bg-blue-500/20 px-1 rounded">/start {telegramLink.replace('token:', '')}</code> 를 보내세요.
                      </p>
                    )}
                    <p className="mt-1.5 text-[10px] text-blue-400/50">
                      연결 대기 중... (10분 내 완료)
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Skill Readiness ── */}
      <section>
        <button
          onClick={() => setShowReadiness(!showReadiness)}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-surface-500 uppercase tracking-wider mb-3 hover:text-surface-400 transition-colors"
        >
          <span className="text-[10px]">{showReadiness ? '▼' : '▶'}</span>
          Skill Readiness
          {skillReadiness.length > 0 && (
            <span className="ml-1 text-[10px] font-normal normal-case">
              ({skillReadiness.filter(s => s.ready).length}/{skillReadiness.length} ready)
            </span>
          )}
        </button>

        {showReadiness && (
          <div className="space-y-1.5">
            {skillReadiness.length === 0 ? (
              <p className="text-[11px] text-surface-600 px-2">
                credential이 필요한 스킬이 없습니다.
              </p>
            ) : (
              skillReadiness.map((skill) => (
                <div
                  key={skill.skillId}
                  className={`flex items-center justify-between py-2 px-3 rounded-lg border transition-all ${
                    skill.ready
                      ? 'border-green-500/20 bg-green-500/5'
                      : 'border-amber-500/20 bg-amber-500/5'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px]">{skill.ready ? '✅' : '⚠️'}</span>
                    <span className="text-xs font-medium text-gray-300">{skill.skillName}</span>
                  </div>
                  {!skill.ready && (
                    <span className="text-[10px] text-amber-400">
                      {skill.missing.join(', ')} 연동 필요
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </>
  );
}
