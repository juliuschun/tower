import { useState } from 'react';

type ViewTab = 'text' | 'snapshot' | 'screenshot';

export function BrowserPanel() {
  const [url, setUrl] = useState('https://example.com');
  const [activeTab, setActiveTab] = useState<ViewTab>('text');
  const [output, setOutput] = useState('');
  const [screenshotSrc, setScreenshotSrc] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle');

  function apiFetch(path: string, init?: RequestInit) {
    const token = localStorage.getItem('token');
    return fetch(`/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers as Record<string, string> ?? {}),
      },
    });
  }

  async function handleNavigate() {
    setLoading(true);
    setStatus('idle');
    try {
      const res = await apiFetch('/browser/navigate', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const data = await res.json();
        setOutput(data.error ?? JSON.stringify(data));
        setStatus('error');
        return;
      }
      // navigate 성공 → 현재 탭 자동 갱신
      await readTab(activeTab);
    } catch (err: unknown) {
      setOutput(err instanceof Error ? err.message : String(err));
      setStatus('error');
    } finally {
      setLoading(false);
    }
  }

  async function readTab(tab: ViewTab) {
    setLoading(true);
    setStatus('idle');
    setActiveTab(tab);
    try {
      if (tab === 'text') {
        const res = await apiFetch('/browser/text');
        const data = await res.json();
        setOutput(data.text ?? data.error ?? JSON.stringify(data));
        setStatus(res.ok ? 'ok' : 'error');
      } else if (tab === 'snapshot') {
        const res = await apiFetch('/browser/snapshot?filter=interactive');
        const data = await res.json();
        setOutput(data.snapshot ?? data.error ?? JSON.stringify(data));
        setStatus(res.ok ? 'ok' : 'error');
      } else {
        // screenshot — img src 직접 사용 (binary response)
        setScreenshotSrc(`/api/browser/screenshot?t=${Date.now()}`);
        setOutput('');
        setStatus('ok');
      }
    } catch (err: unknown) {
      setOutput(err instanceof Error ? err.message : String(err));
      setStatus('error');
    } finally {
      setLoading(false);
    }
  }

  const tabBtn = (t: ViewTab, label: string) => (
    <button
      key={t}
      onClick={() => readTab(t)}
      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
        activeTab === t
          ? 'bg-neutral-700 text-gray-100'
          : 'text-gray-400 hover:text-gray-200 hover:bg-neutral-800'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full bg-neutral-950 text-gray-100 p-4 gap-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Browser</p>

      {/* URL bar */}
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
          placeholder="https://..."
          className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={handleNavigate}
          disabled={loading}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-sm font-medium transition-colors"
        >
          {loading ? '…' : 'Go'}
        </button>
      </div>

      {/* View tabs */}
      <div className="flex gap-1 bg-neutral-900 rounded p-1 w-fit">
        {tabBtn('text', 'Text')}
        {tabBtn('snapshot', 'Snapshot')}
        {tabBtn('screenshot', 'Screenshot')}
      </div>

      {/* Output */}
      <div className="flex-1 overflow-auto rounded border border-neutral-800">
        {activeTab === 'screenshot' && screenshotSrc ? (
          <img
            src={screenshotSrc}
            alt="browser screenshot"
            className="max-w-full"
            onError={() => setStatus('error')}
          />
        ) : (
          <pre
            className={`text-xs whitespace-pre-wrap font-mono p-3 min-h-full ${
              status === 'error' ? 'text-red-400' : 'text-gray-300'
            }`}
          >
            {output || (loading ? 'Loading…' : 'Navigate to a URL to begin.')}
          </pre>
        )}
      </div>
    </div>
  );
}
