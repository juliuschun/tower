import { useState, useEffect, useCallback } from 'react';

interface Site {
  name: string;
  description: string;
  access: 'public' | 'private';
  created_at: string;
  status?: string;
  files?: number;
  deploy_target?: string;
  external_url?: string;
}

interface App {
  name: string;
  port?: number;
  path?: string;
  description: string;
  access: 'public' | 'private';
  status?: string;
  statusCode?: number;
  created_at: string;
  deploy_target?: string;
  external_url?: string;
}

interface TrafficEntry {
  hits: number;
  path: string;
}

interface PublishInfo {
  role: 'full' | 'managed' | 'standalone';
  gatewayConfigured?: boolean;
  gatewayUrl?: string;
  gatewayEnabled?: boolean;
}

interface PublishPanelProps {
  open: boolean;
  onClose: () => void;
}

const API_BASE = '/api/publish';
const PUBLIC_HOST = window.location.host;

export function PublishPanel({ open, onClose }: PublishPanelProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [traffic, setTraffic] = useState<TrafficEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'overview' | 'traffic'>('overview');
  const [publishInfo, setPublishInfo] = useState<PublishInfo | null>(null);

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const headers = authHeaders();
      const [statusRes, statsRes, infoRes] = await Promise.all([
        fetch(`${API_BASE}/status`, { headers }),
        fetch(`${API_BASE}/stats`, { headers }),
        fetch(`${API_BASE}/info`, { headers }),
      ]);
      if (statusRes.status === 401) throw new Error('Login required');
      if (!statusRes.ok) throw new Error('Publishing service unavailable');
      const health = await statusRes.json();
      const stats = await statsRes.json().catch(() => []);
      const info = await infoRes.json().catch(() => null);
      setSites(health.sites || []);
      setApps(health.apps || []);
      setTraffic(stats || []);
      if (info) setPublishInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load publish status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchData();
  }, [open, fetchData]);

  // auto-refresh every 15s while open
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [open, fetchData]);

  if (!open) return null;

  const totalSites = sites.length;
  const totalApps = apps.length;
  const appsUp = apps.filter(a => a.status === 'up').length;

  const statusDot = (status?: string) => {
    const colors: Record<string, string> = {
      up: 'bg-emerald-500', live: 'bg-emerald-500',
      down: 'bg-red-500', missing: 'bg-red-500',
      timeout: 'bg-amber-500', 'no-port': 'bg-amber-500',
    };
    return colors[status || ''] || 'bg-gray-500';
  };

  const accessBadge = (access: string) => {
    if (access === 'public') {
      return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">public</span>;
    }
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">private</span>;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-[800px] max-w-[95vw] h-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-200">Publishing</p>
                {publishInfo && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wider ${
                    publishInfo.role === 'full' ? 'bg-violet-500/15 text-violet-400 border border-violet-500/30' :
                    publishInfo.role === 'managed' ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30' :
                    'bg-neutral-500/15 text-neutral-400 border border-neutral-500/30'
                  }`}>{publishInfo.role}</span>
                )}
              </div>
              <p className="text-[10px] text-gray-500">{PUBLIC_HOST}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
              title="Refresh"
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex gap-3 px-5 py-3 border-b border-neutral-800/50 shrink-0">
          {[
            { label: 'Sites', value: totalSites, color: 'text-blue-400' },
            { label: 'Apps', value: totalApps, color: 'text-purple-400' },
            { label: 'Online', value: `${appsUp}/${totalApps}`, color: appsUp === totalApps ? 'text-emerald-400' : 'text-amber-400' },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2 px-3 py-1.5 bg-neutral-800/50 rounded-lg">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">{s.label}</span>
              <span className={`text-sm font-bold ${s.color}`}>{s.value}</span>
            </div>
          ))}
          <div className="flex-1" />
          <div className="flex gap-0.5 bg-neutral-800/60 rounded-md p-0.5">
            <button
              onClick={() => setTab('overview')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${tab === 'overview' ? 'bg-neutral-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            >Overview</button>
            <button
              onClick={() => setTab('traffic')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${tab === 'traffic' ? 'bg-neutral-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            >Traffic</button>
          </div>
        </div>

        {/* Role banner */}
        {publishInfo?.role === 'managed' && (
          <div className="mx-5 mt-3 px-3 py-2 bg-sky-500/10 border border-sky-500/20 rounded-lg flex items-center gap-2">
            <svg className="w-4 h-4 text-sky-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
            <div className="flex-1">
              <p className="text-[11px] text-sky-300">Managed Service</p>
              <p className="text-[10px] text-sky-400/60">
                {publishInfo.gatewayConfigured
                  ? '외부 배포는 Moat AI Gateway를 통해 처리됩니다.'
                  : 'Gateway 연결이 설정되지 않았습니다. 관리자에게 문의하세요.'}
              </p>
            </div>
            {publishInfo.gatewayConfigured && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">연결됨</span>
            )}
          </div>
        )}
        {publishInfo?.role === 'full' && publishInfo.gatewayEnabled && (
          <div className="mx-5 mt-3 px-3 py-2 bg-violet-500/10 border border-violet-500/20 rounded-lg flex items-center gap-2">
            <svg className="w-4 h-4 text-violet-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
            </svg>
            <div className="flex-1">
              <p className="text-[11px] text-violet-300">Central Gateway Active</p>
              <p className="text-[10px] text-violet-400/60">고객 서버의 배포 요청을 처리하는 중입니다.</p>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {error ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <p className="text-sm text-gray-400">{error}</p>
              <button onClick={fetchData} className="px-4 py-2 text-xs bg-neutral-800 hover:bg-neutral-700 rounded-lg text-gray-300 transition-colors">
                Retry
              </button>
            </div>
          ) : tab === 'overview' ? (
            <div className="space-y-6">
              {/* Sites */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Sites</span>
                  <span className="text-[10px] text-gray-600">Static HTML / Files</span>
                </div>
                {sites.length === 0 ? (
                  <div className="text-center py-8 text-[12px] text-gray-600 border border-dashed border-neutral-800 rounded-lg">
                    No sites published yet. Ask Tower to create one!
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {sites.map(s => {
                      const siteUrl = s.external_url || `http://${PUBLIC_HOST}/sites/${s.name}/`;
                      return (
                      <a
                        key={s.name}
                        href={siteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-start gap-3 p-3 bg-neutral-800/40 hover:bg-neutral-800/70 border border-neutral-800 hover:border-neutral-700 rounded-lg transition-all"
                      >
                        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${statusDot(s.status)}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-gray-200 group-hover:text-white truncate">{s.name}</span>
                            {accessBadge(s.access)}
                          </div>
                          <p className="text-[11px] text-gray-500 truncate mt-0.5">{s.description || 'No description'}</p>
                          <div className="flex gap-3 mt-1.5 text-[10px] text-gray-600">
                            <span>{s.files ?? '?'} files</span>
                            {s.created_at && <span>{new Date(s.created_at).toLocaleDateString('ko-KR')}</span>}
                          </div>
                        </div>
                        <svg className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 shrink-0 mt-1 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Apps */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Apps</span>
                  <span className="text-[10px] text-gray-600">Dynamic Services</span>
                </div>
                {apps.length === 0 ? (
                  <div className="text-center py-8 text-[12px] text-gray-600 border border-dashed border-neutral-800 rounded-lg">
                    No apps running yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {apps.map(a => {
                      const appUrl = a.external_url || `http://${PUBLIC_HOST}${a.path || '/apps/' + a.name + '/'}`;
                      const isExternal = !!a.external_url;
                      return (
                      <a
                        key={a.name}
                        href={appUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-start gap-3 p-3 bg-neutral-800/40 hover:bg-neutral-800/70 border border-neutral-800 hover:border-neutral-700 rounded-lg transition-all"
                      >
                        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${statusDot(a.status)}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-gray-200 group-hover:text-white truncate">{a.name}</span>
                            {accessBadge(a.access)}
                          </div>
                          <p className="text-[11px] text-gray-500 truncate mt-0.5">{a.description || 'No description'}</p>
                          <div className="flex gap-3 mt-1.5 text-[10px] text-gray-600">
                            {isExternal ? (
                              <span className="text-sky-500">{a.deploy_target === 'azure-container-apps' ? '☁️ Azure' : '☁️ CF Pages'}</span>
                            ) : (
                              <span>port {a.port}</span>
                            )}
                            <span className={a.status === 'up' ? 'text-emerald-500' : 'text-red-400'}>{a.status}</span>
                            {a.statusCode && <span>HTTP {a.statusCode}</span>}
                          </div>
                        </div>
                        <svg className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 shrink-0 mt-1 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Traffic tab */
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Recent Traffic</span>
                <span className="text-[10px] text-gray-600">from nginx access logs</span>
              </div>
              {traffic.length === 0 ? (
                <div className="text-center py-12 text-[12px] text-gray-600">
                  No traffic data yet
                </div>
              ) : (
                <div className="space-y-1">
                  {traffic.map((t, i) => {
                    const maxHits = Math.max(...traffic.map(x => x.hits));
                    const pct = Math.round((t.hits / maxHits) * 100);
                    return (
                      <div key={i} className="flex items-center gap-3 px-3 py-2 hover:bg-neutral-800/40 rounded-md transition-colors">
                        <code className="text-[11px] text-gray-400 font-mono flex-1 truncate">{t.path}</code>
                        <span className="text-[11px] text-gray-500 w-10 text-right shrink-0">{t.hits}</span>
                        <div className="w-24 shrink-0">
                          <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                            <div className="h-full bg-amber-500/60 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
