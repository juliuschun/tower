import React, { useState, useEffect, useRef } from 'react';
import { toastSuccess, toastError } from '../../utils/toast';

interface User { id: number; username: string; }
interface Share {
  id: string;
  share_type: 'internal' | 'external';
  token?: string;
  expires_at?: string;
  target_username?: string;
  url?: string;
}

interface Props {
  filePath: string;
  onClose: () => void;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export function ShareModal({ filePath, onClose }: Props) {
  const [tab, setTab] = useState<'internal' | 'external'>('external');
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | ''>('');
  const [expiresIn, setExpiresIn] = useState<'1h' | '24h' | '7d'>('24h');
  const [shares, setShares] = useState<Share[]>([]);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const fileName = filePath.split('/').pop() ?? filePath;

  useEffect(() => {
    fetch('/api/users', { headers: getAuthHeaders() })
      .then(r => r.json()).then(setUsers).catch(() => {});
    loadShares();
  }, [filePath]);

  const loadShares = () => {
    fetch(`/api/shares?filePath=${encodeURIComponent(filePath)}`, { headers: getAuthHeaders() })
      .then(r => r.json()).then(setShares).catch(() => {});
  };

  const handleInternalShare = async () => {
    if (!selectedUserId) return;
    setLoading(true);
    try {
      const res = await fetch('/api/shares', {
        method: 'POST', headers: getAuthHeaders(),
        body: JSON.stringify({ shareType: 'internal', filePath, targetUserId: selectedUserId }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toastSuccess('공유했습니다.');
      setSelectedUserId('');
      loadShares();
    } catch (e: any) { toastError(e.message); }
    finally { setLoading(false); }
  };

  const handleExternalShare = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/shares', {
        method: 'POST', headers: getAuthHeaders(),
        body: JSON.stringify({ shareType: 'external', filePath, expiresIn }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      const fullUrl = `${window.location.origin}${data.url}`;
      setGeneratedUrl(fullUrl);
      await navigator.clipboard.writeText(fullUrl);
      toastSuccess('링크 생성 및 복사 완료!');
      loadShares();
    } catch (e: any) { toastError(e.message); }
    finally { setLoading(false); }
  };

  const handleRevoke = async (shareId: string) => {
    try {
      const res = await fetch(`/api/shares/${shareId}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!res.ok) throw new Error((await res.json()).error);
      toastSuccess('공유가 취소되었습니다.');
      setShares(prev => prev.filter(s => s.id !== shareId));
      if (generatedUrl) setGeneratedUrl('');
    } catch (e: any) { toastError(e.message); }
  };

  const externalShares = shares.filter(s => s.share_type === 'external');
  const internalShares = shares.filter(s => s.share_type === 'internal');

  const timeLeft = (expiresAt: string) => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return '만료됨';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}시간 남음` : `${m}분 남음`;
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="bg-surface-800 border border-surface-700 rounded-xl shadow-2xl w-[420px] max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
          <div>
            <h2 className="text-[13px] font-semibold text-white">파일 공유</h2>
            <p className="text-[11px] text-gray-500 truncate max-w-[300px]">{fileName}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-700">
          {(['external', 'internal'] as const).map(t => (
            <button key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-[12px] font-medium transition-colors ${
                tab === t
                  ? 'text-primary-400 border-b-2 border-primary-500'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {t === 'external' ? '외부 링크' : '내부 유저'}
            </button>
          ))}
        </div>

        <div className="p-4 space-y-4">
          {/* External tab */}
          {tab === 'external' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                {(['1h', '24h', '7d'] as const).map(opt => (
                  <button key={opt}
                    onClick={() => setExpiresIn(opt)}
                    className={`flex-1 py-1.5 rounded text-[11px] font-medium border transition-colors ${
                      expiresIn === opt
                        ? 'bg-primary-600/30 border-primary-500/50 text-primary-300'
                        : 'border-surface-600 text-gray-500 hover:border-surface-500 hover:text-gray-300'
                    }`}
                  >
                    {opt === '1h' ? '1시간' : opt === '24h' ? '24시간' : '7일'}
                  </button>
                ))}
              </div>
              <button
                onClick={handleExternalShare}
                disabled={loading}
                className="w-full py-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-[12px] font-medium transition-colors"
              >
                {loading ? '생성 중...' : '링크 생성 & 복사'}
              </button>
              {generatedUrl && (
                <div className="flex items-center gap-2 bg-surface-900 rounded-lg px-3 py-2">
                  <span className="flex-1 text-[11px] text-gray-400 truncate">{generatedUrl}</span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(generatedUrl); toastSuccess('복사됨'); }}
                    className="text-primary-400 hover:text-primary-300 text-[10px] shrink-0"
                  >복사</button>
                </div>
              )}
            </div>
          )}

          {/* Internal tab */}
          {tab === 'internal' && (
            <div className="space-y-3">
              <select
                value={selectedUserId}
                onChange={e => setSelectedUserId(Number(e.target.value) || '')}
                className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-[12px] text-white focus:outline-none focus:border-primary-500"
              >
                <option value="">유저 선택...</option>
                {users.map(u => <option key={u.id} value={u.id}>@{u.username}</option>)}
              </select>
              <button
                onClick={handleInternalShare}
                disabled={loading || !selectedUserId}
                className="w-full py-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-[12px] font-medium transition-colors"
              >
                {loading ? '공유 중...' : '공유하기'}
              </button>
            </div>
          )}

          {/* Share list */}
          {(externalShares.length > 0 || internalShares.length > 0) && (
            <div className="border-t border-surface-700/50 pt-3">
              <h3 className="text-[11px] text-gray-500 mb-2 font-medium uppercase tracking-wide">현재 공유 목록</h3>
              <div className="space-y-1.5">
                {externalShares.map(s => (
                  <div key={s.id} className="flex items-center gap-2 bg-surface-900 rounded-lg px-3 py-2">
                    <svg className="w-3.5 h-3.5 text-primary-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <span className="flex-1 text-[11px] text-gray-400">
                      외부 링크 · {s.expires_at ? timeLeft(s.expires_at) : ''}
                    </span>
                    <button onClick={() => handleRevoke(s.id)} className="text-[10px] text-red-400 hover:text-red-300 shrink-0">취소</button>
                  </div>
                ))}
                {internalShares.map(s => (
                  <div key={s.id} className="flex items-center gap-2 bg-surface-900 rounded-lg px-3 py-2">
                    <svg className="w-3.5 h-3.5 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className="flex-1 text-[11px] text-gray-400">@{s.target_username}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
