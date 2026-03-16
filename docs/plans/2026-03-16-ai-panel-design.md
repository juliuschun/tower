# AI Side Panel — Design Document

**Date:** 2026-03-16
**Status:** Approved

## Overview

Channel 옆에 AI 사이드 패널을 추가. VS Code Copilot Chat / Slack AI처럼 채널 대화를 읽으면서 개인적으로 AI와 대화하고, 중요한 내용은 "채널에 공유"로 팀에 전파.

## Design Decisions

| 결정 | 선택 | 이유 |
|------|------|------|
| @ai 인라인 유지? | 유지 | 간단한 공개 질문용 |
| 패널 트리거 | 채널 헤더 AI 아이콘 | 채널 컨텍스트에서 바로 접근 |
| 대화 지속성 | DB 저장 | 다중 스레드, 이어서 대화, 이력 보존 |
| 패널 너비 | 400px 고정, 모바일 전체 | 심플 |

## Architecture

### Data Model

기존 `sessions` 테이블 재활용 — 새 컬럼 추가:

```sql
ALTER TABLE sessions ADD COLUMN room_id TEXT;      -- NULL = 일반 세션, UUID = 패널 세션
ALTER TABLE sessions ADD COLUMN panel_owner INTEGER; -- 패널 세션 소유자 (user_id)
```

- `room_id` + `panel_owner` 조합으로 "이 채널에서 이 사용자의 AI 스레드들" 조회
- 기존 세션 인프라 (메시지 저장, 스트리밍, 모델 선택) 그대로 활용
- Engine 추상화도 그대로 — Claude/Pi 모두 지원

### UI Components

```
RoomPanel.tsx (기존)
├─ 메인 채팅 영역
└─ AiPanelToggle (헤더 버튼)

AiPanel.tsx (신규)
├─ AiThreadList — 스레드 목록 (room_id + panel_owner로 필터)
├─ AiThreadView — 선택된 스레드 대화 (기존 ChatPanel 경량 버전)
│  ├─ 메시지 리스트 (스트리밍 포함)
│  ├─ "채널에 공유" 버튼
│  └─ 입력창
└─ NewThreadButton — 새 스레드 생성
```

### Flow: 새 스레드 생성

1. 사용자가 AI Panel에서 "New thread" 클릭
2. 프론트: `POST /api/sessions` with `{ roomId, engine, title: 'New thread' }`
3. 백엔드: `sessions` 테이블에 `room_id`, `panel_owner` 설정하여 생성
4. 시스템 프롬프트에 채널 최근 20개 메시지 자동 주입
5. 사용자가 질문 입력 → 기존 `chat` WS 흐름 그대로

### Flow: 채널에 공유

1. AI 답변 옆 "채널에 공유" 버튼 클릭
2. 프론트: `room_message` WS with `{ roomId, content: AI답변, msgType 힌트 }`
3. 백엔드: `sendMessage(roomId, userId, content, 'ai_summary', { shared_from_panel: true, thread_id: sessionId })`
4. 채널에 `ai_summary` 메시지로 표시 — "Shared by 김대리 from AI Panel"

### Flow: 기존 @ai 인라인

변경 없음. @ai는 채널에서 공개적으로 동작, AI Panel과 독립.

## UI Layout

```
Desktop (>1024px):
┌────────┬────────────────────┬──────────────────┐
│Sidebar │ Channel (flex-1)   │ AI Panel (400px) │
│(240px) │                    │ (collapsible)    │
└────────┴────────────────────┴──────────────────┘

Mobile (<1024px):
AI Panel = full-screen overlay (채널 위에 덮음)
```

## Panel Session vs Regular Session

| | Regular Session | Panel Session |
|---|---|---|
| `room_id` | NULL | channel UUID |
| `panel_owner` | NULL | user_id |
| 사이드바 표시 | Sessions 탭 | AI Panel에서만 |
| CWD | workspace/project | workspace (채널의 프로젝트가 있으면 그 경로) |
| Permission | 사용자 role 기반 | acceptEdits (채널과 동일) |
| System prompt | Tower 기본 | Tower 기본 + 채널 컨텍스트 |

## Channel Context Injection

Panel 세션 시작 시 system prompt에 추가:

```
[Channel Context: {roomName}]
Recent messages from the team channel (for reference):
{last 20 messages}

You are assisting a team member privately. They can see the channel
conversation above. Answer based on the channel context when relevant.
If they ask you to share something, tell them to use the "Share to channel" button.
```

## Not In Scope (Phase 1)

- 스레드 공유 (다른 사람에게 AI 스레드 보여주기)
- 파일 첨부
- 스레드 검색
- @task 연동 (패널에서 task 생성)

이것들은 Phase 2에서.

## API Changes

### New Endpoints (없음)
기존 `/api/sessions` 에 `roomId` 파라미터만 추가.

### Modified Endpoints

**POST /api/sessions** — 세션 생성
```json
{
  "title": "ETF 분석",
  "engine": "claude",
  "roomId": "uuid-of-channel",  // NEW: null이면 일반 세션
}
```

**GET /api/sessions?roomId=xxx** — 패널 세션 목록
- `roomId` 쿼리 파라미터 추가
- `panel_owner = 현재 사용자`로 필터

### WS: share_to_channel (새 메시지 타입)
```json
{
  "type": "share_to_channel",
  "roomId": "uuid",
  "sessionId": "panel-session-id",
  "messageId": "msg-to-share",
  "content": "AI가 생성한 텍스트"
}
```
