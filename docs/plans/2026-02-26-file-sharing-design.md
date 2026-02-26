# File Sharing Feature — Design Document

**Date:** 2026-02-26
**Status:** Approved

---

## Overview

파일 트리에서 파일을 우클릭하면 나타나는 컨텍스트 메뉴에 "공유하기" 항목을 추가한다.
공유는 두 가지 방식을 지원한다:

- **내부 공유**: claude-desk에 등록된 다른 유저에게 파일 읽기 권한 부여
- **외부 링크 공유**: 시간 제한 토큰 URL 생성 → 로그인 없이 뷰어 페이지에서 열람 + 다운로드

공유 목록 조회와 외부 링크 취소(revoke)를 지원하는 최소한의 관리 UI도 제공한다.

---

## Database Schema

`shares` 테이블을 신규 추가한다. 내부/외부 공유를 단일 테이블로 통합 관리.

```sql
CREATE TABLE IF NOT EXISTS shares (
  id              TEXT PRIMARY KEY,      -- crypto.randomUUID()
  file_path       TEXT NOT NULL,         -- 절대 경로
  owner_id        INTEGER NOT NULL,      -- 공유를 만든 유저 ID
  share_type      TEXT NOT NULL,         -- 'internal' | 'external'
  target_user_id  INTEGER,               -- internal 전용: 대상 유저 ID
  token           TEXT UNIQUE,           -- external 전용: 랜덤 토큰
  expires_at      DATETIME,              -- external 전용: 만료 시각
  revoked         INTEGER DEFAULT 0,     -- 1이면 무효
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (target_user_id) REFERENCES users(id)
);
```

---

## Backend API

### 신규 엔드포인트

| Method | Endpoint | 설명 | 인증 |
|---|---|---|---|
| `POST` | `/api/shares` | 공유 생성 | 필요 |
| `GET` | `/api/shares?filePath=...` | 파일의 내 공유 목록 조회 | 필요 |
| `DELETE` | `/api/shares/:id` | 외부 공유 취소(revoke) | 필요 (본인만) |
| `GET` | `/api/shares/with-me` | 나에게 공유된 파일 목록 | 필요 |
| `GET` | `/api/shared/:token` | 외부 뷰어용 파일 콘텐츠 반환 | **불필요** |
| `GET` | `/api/users` | 유저 목록 (id + username만) | 필요 |

### 기존 엔드포인트 수정

- `GET /api/files/read`: `isPathSafe` 실패 시 `shares` 테이블에 유효한 `internal` 공유가 있으면 허용

### POST /api/shares 요청 바디

```ts
// 내부 공유
{ shareType: 'internal', filePath: string, targetUserId: number }

// 외부 공유
{ shareType: 'external', filePath: string, expiresIn: '1h' | '24h' | '7d' }
```

### GET /api/shared/:token 동작

1. `shares` 테이블에서 token 조회
2. `revoked === 1` 또는 `expires_at` 초과 시 410 Gone 반환
3. 유효하면 파일 콘텐츠 + 파일명 + MIME 타입 반환

---

## Frontend Components

### 1. FileTree.tsx 수정

`MenuAction` 타입에 `'shareFile'` 추가. 파일(디렉터리 아님)에만 "공유하기 🔗" 메뉴 항목 표시.

### 2. ShareModal (신규)

`frontend/src/components/files/ShareModal.tsx`

```
┌──────────────────────────────────┐
│ 파일 공유: competitive_adv...md   │
├──────────────────────────────────┤
│ [내부 유저] [외부 링크]           │  ← 탭
│                                  │
│ (내부 탭)                        │
│  유저 선택: [드롭다운 ▼]         │
│  [공유하기]                      │
│                                  │
│ (외부 탭)                        │
│  만료: [1시간] [24시간▼] [7일]   │
│  [링크 생성]                     │
│  https://... [복사 📋]           │
├──────────────────────────────────┤
│ 현재 공유 목록                   │
│  • 외부링크 (24h, 23h 남음) [취소]│
│  • @홍길동 (내부)                │
└──────────────────────────────────┘
```

- 모달 열릴 때 `GET /api/shares?filePath=...` 로 기존 공유 목록 즉시 로드
- 외부 링크 복사: `navigator.clipboard.writeText(url)`
- 취소 버튼: `DELETE /api/shares/:id` → 목록 갱신

### 3. /shared/:token 뷰어 페이지 (신규)

`frontend/src/pages/SharedViewer.tsx`

- React Router public route (`/shared/:token`)
- 로그인 상태 무관하게 접근 가능
- `GET /api/shared/:token` 호출
- 렌더링 전략:
  - `.md` → `react-markdown` (GFM 지원)
  - `.ts`, `.tsx`, `.js`, `.py` 등 코드 파일 → syntax highlighting
  - 그 외 → `<pre>` plain text
- 우측 상단 "다운로드" 버튼 → 동일 endpoint에 `?download=1` 파라미터로 `Content-Disposition: attachment` 수신
- 만료/취소된 토큰 → "이 링크는 만료되었거나 취소되었습니다" 안내 페이지

### 4. Sidebar.tsx 수정

파일 탭 하단에 "나와 공유됨" 섹션 추가.

- `GET /api/shares/with-me` 로 목록 로드 (로그인 시 1회)
- 파일명 + 공유한 유저명 표시
- 클릭 시 에디터에서 읽기 전용으로 열림

---

## Data Flow

### 외부 링크 공유

```
우클릭 → 공유하기 → ShareModal 열림
→ 외부 링크 탭 → 만료 선택 → [링크 생성]
→ POST /api/shares { shareType: 'external', filePath, expiresIn }
→ DB: shares 행 삽입 (token = randomUUID())
→ 응답: { id, url: '/shared/<token>' }
→ 클립보드 복사
→ 수신자: GET /api/shared/<token> (인증 없음)
→ 파일 내용 반환 → 뷰어 렌더링
```

### 내부 유저 공유

```
우클릭 → 공유하기 → ShareModal 열림
→ 내부 유저 탭 → 유저 선택 → [공유하기]
→ POST /api/shares { shareType: 'internal', filePath, targetUserId }
→ DB: shares 행 삽입
→ 대상 유저 로그인 시: GET /api/shares/with-me
→ 사이드바 "나와 공유됨" 섹션에 파일 노출
→ 파일 클릭 → GET /api/files/read { path }
→ 백엔드: allowed_path 체크 실패
         → shares 테이블 확인 (internal, not revoked, target = 현재 유저)
         → 허용 → 파일 내용 반환
```

---

## Decisions & Constraints

- **외부 토큰**: JWT 아닌 `crypto.randomUUID()` 사용 — revoke 가능하게 DB에 저장
- **내부 공유 revoke**: UI에서 지원 안 함 (요구사항 C: 외부 링크만 취소 가능)
- **파일 공유만**: 디렉터리 공유는 미지원 (컨텍스트 메뉴에서 파일만 노출)
- **신규 라이브러리**: `react-markdown` (뷰어 마크다운 렌더링)
- **기존 인증 미변경**: authMiddleware는 그대로, `/api/shared/:token`만 별도 public 라우트
