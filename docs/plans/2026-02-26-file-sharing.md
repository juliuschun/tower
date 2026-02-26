# File Sharing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 파일 트리 우클릭 메뉴에 "공유하기"를 추가해 내부 유저 권한 부여 + 외부 시간제한 링크 공유를 지원한다.

**Architecture:** `shares` DB 테이블로 내부/외부 공유를 통합 관리. 외부 공유는 `crypto.randomUUID()` 토큰으로 인증 없이 접근 가능한 뷰어 페이지(`/shared/:token`)를 제공. 내부 공유는 `GET /api/files/read` 에서 `isPathSafe` 실패 시 shares 테이블을 fallback으로 조회해 허용.

**Tech Stack:** Node.js/Express + better-sqlite3 (backend), React 18 + Zustand + Tailwind CSS (frontend). `react-markdown` + `rehype-highlight` 이미 설치돼 있음. React Router 미사용 — URL은 `window.location.pathname`으로 직접 확인.

---

## Task 1: DB 스키마 — `shares` 테이블 추가

**Files:**
- Modify: `backend/db/schema.ts` (initSchema 함수 내부 끝에 추가)

**Step 1: `shares` 테이블 생성 SQL을 `initSchema`에 추가**

`backend/db/schema.ts` 의 `initSchema` 함수 내 마지막 Kanban tasks 블록 뒤에 다음을 추가:

```typescript
  // File sharing table
  db.exec(`
    CREATE TABLE IF NOT EXISTS shares (
      id              TEXT PRIMARY KEY,
      file_path       TEXT NOT NULL,
      owner_id        INTEGER NOT NULL,
      share_type      TEXT NOT NULL CHECK(share_type IN ('internal','external')),
      target_user_id  INTEGER,
      token           TEXT UNIQUE,
      expires_at      DATETIME,
      revoked         INTEGER DEFAULT 0,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (target_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
    CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner_id);
    CREATE INDEX IF NOT EXISTS idx_shares_target ON shares(target_user_id);
  `);
```

**Step 2: 수동으로 DB 파일 삭제해서 테이블 생성 확인 (개발환경 기준)**

```bash
# DB 경로 확인
grep -r "dbPath" /home/enterpriseai/claude-desk/backend/config.ts

# 서버 재시작해서 테이블 생성 확인
cd /home/enterpriseai/claude-desk
npm run dev:backend &
sleep 3
# 로그에서 에러 없이 뜨면 OK
```

**Step 3: Commit**

```bash
cd /home/enterpriseai/claude-desk
git add backend/db/schema.ts
git commit -m "feat(db): add shares table for file sharing"
```

---

## Task 2: 백엔드 — `share-manager.ts` 서비스 생성

**Files:**
- Create: `backend/services/share-manager.ts`

**Step 1: 서비스 파일 생성**

```typescript
// backend/services/share-manager.ts
import { getDb } from '../db/schema.js';
import { randomUUID } from 'crypto';

export interface Share {
  id: string;
  file_path: string;
  owner_id: number;
  share_type: 'internal' | 'external';
  target_user_id?: number;
  token?: string;
  expires_at?: string;
  revoked: number;
  created_at: string;
}

export interface ShareWithMeta extends Share {
  owner_username?: string;
  target_username?: string;
}

const EXPIRES_MAP: Record<string, number> = {
  '1h':  1 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7 * 24 * 60 * 60 * 1000,
};

export function createInternalShare(filePath: string, ownerId: number, targetUserId: number): Share {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO shares (id, file_path, owner_id, share_type, target_user_id)
    VALUES (?, ?, ?, 'internal', ?)
  `).run(id, filePath, ownerId, targetUserId);
  return db.prepare('SELECT * FROM shares WHERE id = ?').get(id) as Share;
}

export function createExternalShare(filePath: string, ownerId: number, expiresIn: string): Share & { token: string } {
  const db = getDb();
  const id = randomUUID();
  const token = randomUUID().replace(/-/g, '');
  const ms = EXPIRES_MAP[expiresIn] ?? EXPIRES_MAP['24h'];
  const expiresAt = new Date(Date.now() + ms).toISOString();
  db.prepare(`
    INSERT INTO shares (id, file_path, owner_id, share_type, token, expires_at)
    VALUES (?, ?, ?, 'external', ?, ?)
  `).run(id, filePath, ownerId, token, expiresAt);
  return db.prepare('SELECT * FROM shares WHERE id = ?').get(id) as Share & { token: string };
}

export function getSharesByFile(filePath: string, ownerId: number): ShareWithMeta[] {
  const db = getDb();
  return db.prepare(`
    SELECT s.*, u.username as target_username
    FROM shares s
    LEFT JOIN users u ON s.target_user_id = u.id
    WHERE s.file_path = ? AND s.owner_id = ? AND s.revoked = 0
    ORDER BY s.created_at DESC
  `).all(filePath, ownerId) as ShareWithMeta[];
}

export function getSharesWithMe(targetUserId: number): ShareWithMeta[] {
  const db = getDb();
  return db.prepare(`
    SELECT s.*, u.username as owner_username
    FROM shares s
    JOIN users u ON s.owner_id = u.id
    WHERE s.target_user_id = ? AND s.share_type = 'internal' AND s.revoked = 0
    ORDER BY s.created_at DESC
  `).all(targetUserId) as ShareWithMeta[];
}

export function getShareByToken(token: string): Share | null {
  const db = getDb();
  return db.prepare('SELECT * FROM shares WHERE token = ?').get(token) as Share | null;
}

export function revokeShare(shareId: string, ownerId: number): boolean {
  const db = getDb();
  const result = db.prepare(`
    UPDATE shares SET revoked = 1 WHERE id = ? AND owner_id = ? AND share_type = 'external'
  `).run(shareId, ownerId);
  return result.changes > 0;
}

export function hasInternalShareForUser(filePath: string, userId: number): boolean {
  const db = getDb();
  const row = db.prepare(`
    SELECT 1 FROM shares
    WHERE file_path = ? AND target_user_id = ? AND share_type = 'internal' AND revoked = 0
    LIMIT 1
  `).get(filePath, userId);
  return !!row;
}

export function isTokenValid(share: Share): boolean {
  if (share.revoked) return false;
  if (share.expires_at && new Date(share.expires_at) < new Date()) return false;
  return true;
}
```

**Step 2: Commit**

```bash
cd /home/enterpriseai/claude-desk
git add backend/services/share-manager.ts
git commit -m "feat(backend): add share-manager service"
```

---

## Task 3: 백엔드 — API 라우트 추가

**Files:**
- Modify: `backend/routes/api.ts`

**Step 1: `share-manager` import 추가**

`api.ts` 최상단 imports에 추가:

```typescript
import {
  createInternalShare, createExternalShare, getSharesByFile,
  getSharesWithMe, getShareByToken, revokeShare, isTokenValid,
} from '../services/share-manager.js';
import fs from 'fs/promises';
import path from 'path';
```

> 주의: `fs` 는 이미 `import fs from 'fs'` 로 있음. `fs/promises` 는 별도로 `import fsPromises from 'fs/promises'` 로 추가.

**Step 2: `authMiddleware` 블록 바로 앞에 public 라우트 추가**

`router.use(authMiddleware);` 라인 바로 위에 삽입:

```typescript
// ───── Public: Shared file viewer (no auth required) ─────
router.get('/shared/:token', async (req, res) => {
  const share = getShareByToken(req.params.token);
  if (!share || !isTokenValid(share)) {
    return res.status(410).json({ error: '만료되었거나 취소된 링크입니다.' });
  }

  try {
    const content = await fsPromises.readFile(share.file_path, 'utf-8');
    const fileName = path.basename(share.file_path);
    const ext = path.extname(fileName).slice(1).toLowerCase();

    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.send(content);
    }

    res.json({ content, fileName, ext });
  } catch {
    res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  }
});
```

**Step 3: authMiddleware 이후 protected 라우트에 shares + users 엔드포인트 추가**

`router.get('/health', ...)` 블록 뒤에 추가:

```typescript
// ───── Users list (for internal share dropdown) ─────
router.get('/users', (req, res) => {
  const db = (await import('../db/schema.js')).getDb();
  const users = db.prepare('SELECT id, username FROM users WHERE disabled = 0 ORDER BY username').all();
  const currentUserId = (req as any).user?.userId;
  res.json(users.filter((u: any) => u.id !== currentUserId));
});
```

> 주의: `getDb`는 이미 auth 등에서 사용하므로, `backend/db/schema.js` import는 파일 상단에서 직접 가져오는 게 더 깔끔함. `getDb`를 auth.ts의 import 경로와 동일하게 top-level import로 추가:

```typescript
import { getDb } from '../db/schema.js';
```

그리고 라우트:

```typescript
// ───── Users list (for share modal dropdown) ─────
router.get('/users', (req, res) => {
  const currentUserId = (req as any).user?.userId;
  const users = getDb()
    .prepare('SELECT id, username FROM users WHERE disabled = 0 ORDER BY username')
    .all()
    .filter((u: any) => u.id !== currentUserId);
  res.json(users);
});

// ───── Shares ─────
router.post('/shares', (req, res) => {
  const { shareType, filePath, targetUserId, expiresIn } = req.body;
  const ownerId = (req as any).user?.userId;
  if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });
  if (!filePath) return res.status(400).json({ error: 'filePath required' });

  try {
    if (shareType === 'internal') {
      if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
      const share = createInternalShare(filePath, ownerId, targetUserId);
      return res.json(share);
    } else if (shareType === 'external') {
      const share = createExternalShare(filePath, ownerId, expiresIn || '24h');
      const url = `/shared/${share.token}`;
      return res.json({ ...share, url });
    } else {
      return res.status(400).json({ error: 'shareType must be internal or external' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/shares', (req, res) => {
  const ownerId = (req as any).user?.userId;
  const filePath = req.query.filePath as string;
  if (!ownerId || !filePath) return res.status(400).json({ error: 'filePath required' });
  res.json(getSharesByFile(filePath, ownerId));
});

router.get('/shares/with-me', (req, res) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  res.json(getSharesWithMe(userId));
});

router.delete('/shares/:id', (req, res) => {
  const ownerId = (req as any).user?.userId;
  if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });
  const ok = revokeShare(req.params.id, ownerId);
  if (!ok) return res.status(404).json({ error: '공유를 찾을 수 없거나 취소 권한이 없습니다.' });
  res.json({ ok: true });
});
```

> **중요:** `router.get('/shares/with-me', ...)` 를 `router.delete('/shares/:id', ...)` 보다 **반드시 먼저** 등록해야 한다. Express는 `:id` 가 `with-me` 를 잡아버린다.

**Step 4: `GET /api/files/read` 수정 — internal share fallback**

기존 `/files/read` 라우트에서 `isPathSafe` 실패 시 shares 테이블 확인 로직 추가:

```typescript
// 기존 코드 (대략 이런 패턴)
router.get('/files/read', async (req, res) => {
  const filePath = req.query.path as string;
  const userId = (req as any).user?.userId;
  const userRoot = userId ? getUserAllowedPath(userId) : config.workspaceRoot;

  if (!isPathSafe(filePath, userRoot)) {
    // 기존: return res.status(403).json({ error: 'Access denied' });
    // 변경: internal share 확인 후 허용
    const { hasInternalShareForUser } = await import('../services/share-manager.js');
    if (!userId || !hasInternalShareForUser(filePath, userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    // internal share 있으면 통과 — 아래 read 로직 계속
  }
  // ... 기존 read 로직
});
```

실제 구현 시에는 top-level import로 올려두는 게 깔끔함:

```typescript
import { ..., hasInternalShareForUser } from '../services/share-manager.js';
```

그리고 `/files/read` 에서:

```typescript
if (!isPathSafe(filePath, userRoot)) {
  if (!userId || !hasInternalShareForUser(filePath, userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
}
```

**Step 5: 서버 재시작 후 curl로 동작 확인**

```bash
# 로그인 토큰 획득
TOKEN=$(curl -s -X POST http://localhost:32355/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"yourpassword"}' | jq -r '.token')

# 유저 목록 확인
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:32355/api/users | jq

# 외부 공유 생성
curl -s -X POST http://localhost:32355/api/shares \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"shareType":"external","filePath":"/home/enterpriseai/workspace/claude-desk-related/competitive_advantage.md","expiresIn":"1h"}' | jq

# 반환된 token으로 파일 내용 조회 (인증 없이)
curl -s "http://localhost:32355/api/shared/<TOKEN_HERE>" | jq '.fileName'
```

**Step 6: Commit**

```bash
cd /home/enterpriseai/claude-desk
git add backend/routes/api.ts
git commit -m "feat(api): add shares endpoints and public shared file route"
```

---

## Task 4: 프론트엔드 — `ShareModal` 컴포넌트

**Files:**
- Create: `frontend/src/components/files/ShareModal.tsx`

**Step 1: 컴포넌트 생성**

```typescript
// frontend/src/components/files/ShareModal.tsx
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
    // 유저 목록 로드
    fetch('/api/users', { headers: getAuthHeaders() })
      .then(r => r.json()).then(setUsers).catch(() => {});
    // 기존 공유 목록 로드
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
      loadShares();
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
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}>
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
                tab === t ? 'text-primary-400 border-b-2 border-primary-500' : 'text-gray-500 hover:text-gray-300'
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
                onClick={handleExternalShare} disabled={loading}
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
                onClick={handleInternalShare} disabled={loading || !selectedUserId}
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
```

**Step 2: Commit**

```bash
cd /home/enterpriseai/claude-desk
git add frontend/src/components/files/ShareModal.tsx
git commit -m "feat(ui): add ShareModal component"
```

---

## Task 5: 프론트엔드 — FileTree 컨텍스트 메뉴에 "공유하기" 추가

**Files:**
- Modify: `frontend/src/components/files/FileTree.tsx`

**Step 1: `MenuAction` 타입에 `shareFile` 추가**

```typescript
// 기존
type MenuAction = 'newFile' | 'newFolder' | 'rename' | 'delete' | 'newSession';
// 변경
type MenuAction = 'newFile' | 'newFolder' | 'rename' | 'delete' | 'newSession' | 'shareFile';
```

**Step 2: `ContextMenu` 내 `menuItems` 배열에 항목 추가**

`rename` 항목 바로 앞에 삽입 (파일에만 표시):

```typescript
{
  action: 'shareFile' as MenuAction,
  label: '공유하기',
  show: !entry.isDirectory,
  icon: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  ),
},
```

**Step 3: `FileTree` 컴포넌트에 ShareModal state 및 import 추가**

파일 상단에 import 추가:

```typescript
import { ShareModal } from './ShareModal';
```

`FileTree` 컴포넌트 내부에 state 추가:

```typescript
const [shareFilePath, setShareFilePath] = useState<string | null>(null);
```

**Step 4: `handleContextAction` 에 `shareFile` 처리 추가**

```typescript
if (action === 'shareFile') {
  setShareFilePath(entry.path);
  return;
}
```

**Step 5: 컴포넌트 return 내 ShareModal 렌더링 추가**

`{contextMenu && <ContextMenu ... />}` 블록 바로 뒤에:

```typescript
{shareFilePath && (
  <ShareModal filePath={shareFilePath} onClose={() => setShareFilePath(null)} />
)}
```

**Step 6: Commit**

```bash
cd /home/enterpriseai/claude-desk
git add frontend/src/components/files/FileTree.tsx
git commit -m "feat(ui): add share file context menu item and integrate ShareModal"
```

---

## Task 6: 프론트엔드 — `SharedViewer` 페이지

React Router가 없으므로, `App.tsx` 에서 `window.location.pathname`을 체크해 뷰어를 렌더링한다.

**Files:**
- Create: `frontend/src/components/shared/SharedViewer.tsx`
- Modify: `frontend/src/App.tsx`

**Step 1: SharedViewer 컴포넌트 생성**

```typescript
// frontend/src/components/shared/SharedViewer.tsx
import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

const CODE_EXTS = new Set(['ts','tsx','js','jsx','py','sh','sql','json','yaml','yml','css','html','md']);

interface FileData {
  content: string;
  fileName: string;
  ext: string;
}

export function SharedViewer() {
  const token = window.location.pathname.split('/shared/')[1];
  const [data, setData] = useState<FileData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setError('잘못된 링크입니다.'); setLoading(false); return; }
    fetch(`/api/shared/${token}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError('이 링크는 만료되었거나 취소되었습니다.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleDownload = () => {
    window.location.href = `/api/shared/${token}?download=1`;
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-gray-400 text-sm">불러오는 중...</div>
    </div>
  );

  if (error || !data) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center space-y-2">
        <div className="text-4xl">🔗</div>
        <p className="text-gray-300 text-sm">{error || '파일을 불러올 수 없습니다.'}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-3 flex items-center justify-between sticky top-0 bg-gray-950/90 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs">📄</span>
          <span className="text-sm font-medium text-white">{data.fileName}</span>
        </div>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-xs font-medium transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          다운로드
        </button>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {data.ext === 'md' ? (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
              {data.content}
            </ReactMarkdown>
          </div>
        ) : CODE_EXTS.has(data.ext) ? (
          <pre className="bg-gray-900 rounded-xl p-4 overflow-x-auto text-sm text-gray-200 leading-relaxed">
            <code>{data.content}</code>
          </pre>
        ) : (
          <pre className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{data.content}</pre>
        )}
      </div>
    </div>
  );
}
```

**Step 2: App.tsx 최상단에서 SharedViewer 분기 처리**

`App.tsx` 에서 `App` 컴포넌트 내부 최상단 (useState 아래)에 추가:

```typescript
import { SharedViewer } from './components/shared/SharedViewer';

// App 컴포넌트 내부, return 직전에:
// 공유 뷰어 라우트 — /shared/:token
if (window.location.pathname.startsWith('/shared/')) {
  return <SharedViewer />;
}
```

실제로는 `function App()` 의 return 구문 바로 앞에 이 조건문을 넣으면 된다:

```typescript
function App() {
  // ... 기존 state/hooks ...

  // 공유 뷰어 — 로그인 불필요
  if (window.location.pathname.startsWith('/shared/')) {
    return <SharedViewer />;
  }

  // ... 기존 return 구문
}
```

**Step 3: Vite dev server가 `/shared/*` 를 index.html로 fallback하도록 확인**

Vite는 기본으로 SPA fallback을 지원하므로 별도 설정 불필요. 프로덕션(Cloudflare Tunnel + Express)에서도 Express가 `/*` 를 index.html로 서빙하는지 확인:

```bash
grep -n "index.html\|static\|sendFile" /home/enterpriseai/claude-desk/backend/server.ts
```

Express에서 `app.get('*', ...)` 로 index.html을 서빙하는 구문이 있어야 함. 없으면 추가.

**Step 4: 브라우저에서 확인**

1. 서버 재시작
2. 파일 우클릭 → 공유하기 → 외부 링크 탭 → 링크 생성
3. 생성된 URL을 새 탭에서 열기
4. 뷰어 페이지가 정상 렌더링되는지 확인
5. 다운로드 버튼 동작 확인

**Step 5: Commit**

```bash
cd /home/enterpriseai/claude-desk
git add frontend/src/components/shared/SharedViewer.tsx frontend/src/App.tsx
git commit -m "feat(ui): add SharedViewer page for external link sharing"
```

---

## Task 7: 프론트엔드 — Sidebar "나와 공유됨" 섹션

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.tsx`

**Step 1: Sidebar 하단 파일 탭에 "나와 공유됨" 섹션 추가**

`Sidebar.tsx` 에서 FileTree 렌더링 블록(`</div>` 닫는 태그) 바로 아래, `sidebarTab === 'prompts'` 분기 전에 추가:

"나와 공유됨" 섹션은 `sidebarTab === 'files'` 조건 블록 내부에 FileTree 아래 추가.

```typescript
// Sidebar에 state 추가 (컴포넌트 내부)
const [sharedWithMe, setSharedWithMe] = useState<{ id: string; file_path: string; owner_username: string }[]>([]);

useEffect(() => {
  if (!token) return;
  fetch('/api/shares/with-me', {
    headers: { Authorization: `Bearer ${token}` }
  })
    .then(r => r.json())
    .then(setSharedWithMe)
    .catch(() => {});
}, [token]);
```

Sidebar의 파일 탭 섹션 내 FileTree 아래에:

```typescript
{sharedWithMe.length > 0 && (
  <div className="mt-3 px-2">
    <div className="text-[10px] text-gray-600 uppercase tracking-wide font-medium mb-1.5 px-1">
      나와 공유됨
    </div>
    <div className="space-y-0.5">
      {sharedWithMe.map(s => (
        <button
          key={s.id}
          onClick={() => onFileClick(s.file_path)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-gray-400 hover:text-white hover:bg-surface-700/50 transition-colors text-left"
        >
          <svg className="w-3.5 h-3.5 text-green-500/60 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          <span className="truncate">{s.file_path.split('/').pop()}</span>
          <span className="text-[10px] text-gray-600 shrink-0">@{s.owner_username}</span>
        </button>
      ))}
    </div>
  </div>
)}
```

> **주의:** Sidebar는 Props로 `token`을 받지 않을 수 있음. 그 경우 `localStorage.getItem('token')` 을 직접 사용하거나, Zustand store에서 token을 읽으면 됨. Sidebar의 실제 Props 구조를 확인 후 적용.

**Step 2: 브라우저에서 확인**

1. 유저A로 로그인 → 파일 공유하기 → 내부 유저 → 유저B 선택
2. 유저B로 로그인 → 사이드바 파일 탭 하단에 "나와 공유됨" 섹션 확인
3. 파일 클릭 → 에디터에서 열리는지 확인

**Step 3: Commit**

```bash
cd /home/enterpriseai/claude-desk
git add frontend/src/components/layout/Sidebar.tsx
git commit -m "feat(ui): add shared-with-me section to file sidebar"
```

---

## 최종 확인

```bash
# 전체 빌드 에러 없는지 확인
cd /home/enterpriseai/claude-desk && npm run build

# E2E 시나리오
# 1. 외부 링크 공유: 파일 우클릭 → 공유하기 → 외부 링크 → 링크 생성 → 새 탭에서 열기 → 뷰어 확인 → 다운로드 → 링크 취소
# 2. 내부 공유: 파일 우클릭 → 공유하기 → 내부 유저 → 유저 선택 → 공유 → 해당 유저로 로그인 → 사이드바 확인 → 파일 클릭
```
