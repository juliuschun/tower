import { useState } from 'react';

interface SecureField {
  key: string;
  label?: string;
  required?: boolean;
}

interface SecureInputSpec {
  target?: string;       // e.g. ".env" (default)
  fields: SecureField[];
}

export default function SecureInputBlock({ raw, fallbackCode }: { raw: string; fallbackCode: string }) {
  let spec: SecureInputSpec;
  try {
    spec = JSON.parse(raw);
    if (!spec.fields || !Array.isArray(spec.fields)) throw new Error('Missing fields');
  } catch {
    return (
      <pre className="my-2 bg-surface-900/60 border border-surface-700/40 rounded-lg p-4 overflow-x-auto text-sm">
        <code className="text-xs text-red-400 block mb-2">Invalid secure-input JSON</code>
        <code>{fallbackCode}</code>
      </pre>
    );
  }

  return <SecureInputForm spec={spec} />;
}

function SecureInputForm({ spec }: { spec: SecureInputSpec }) {
  const target = spec.target || '.env';
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of spec.fields) init[f.key] = '';
    return init;
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [savedCount, setSavedCount] = useState(0);

  const allRequiredFilled = spec.fields.every(f => !f.required || values[f.key]?.trim());

  const handleSave = async () => {
    setStatus('saving');
    setErrorMsg('');
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const entries = Object.entries(values).filter(([, v]) => v.trim());
      const res = await fetch('/api/env', {
        method: 'POST',
        headers,
        body: JSON.stringify({ target, entries: entries.map(([key, value]) => ({ key, value })) }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setSavedCount(entries.length);
      setStatus('done');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save');
      setStatus('error');
    }
  };

  if (status === 'done') {
    return (
      <div className="my-2 rounded-lg border border-emerald-800/40 bg-emerald-950/30 p-4">
        <div className="flex items-center gap-2 text-emerald-400 text-[13px] font-medium">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          {savedCount}개 키가 {target}에 저장되었습니다
        </div>
        <p className="text-[11px] text-gray-500 mt-1">값은 채팅 히스토리에 저장되지 않습니다.</p>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg border border-surface-700/40 bg-surface-900/60 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <span className="text-[13px] font-medium text-gray-200">Secure Input</span>
        <span className="text-[10px] text-surface-500 ml-auto">{target}</span>
      </div>

      {/* Fields */}
      <div className="space-y-2">
        {spec.fields.map(field => (
          <div key={field.key}>
            <label className="text-[11px] text-gray-400 mb-0.5 block">
              {field.label || field.key}
              {field.required && <span className="text-amber-500 ml-0.5">*</span>}
            </label>
            <input
              type="password"
              value={values[field.key] || ''}
              onChange={(e) => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
              placeholder={field.key}
              className="w-full bg-surface-800 border border-surface-700 rounded-md px-3 py-1.5 text-[12px] text-gray-200 placeholder-surface-600 outline-none focus:border-primary-500/50 transition-colors font-mono"
              autoComplete="off"
              data-1p-ignore
            />
          </div>
        ))}
      </div>

      {/* Error */}
      {status === 'error' && (
        <div className="mt-2 text-[11px] text-red-400">{errorMsg}</div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-[10px] text-surface-500 flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          값은 채팅에 저장되지 않습니다
        </span>
        <button
          onClick={handleSave}
          disabled={!allRequiredFilled || status === 'saving'}
          className="px-3 py-1.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-md text-[11px] font-medium text-white transition-colors flex items-center gap-1.5"
        >
          {status === 'saving' ? (
            <>
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Saving...
            </>
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Save to {target}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
