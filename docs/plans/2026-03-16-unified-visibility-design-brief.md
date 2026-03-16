# Tower Unified Visibility & Permission Model — Design Brief

**Date:** 2026-03-16
**Status:** Pre-design (고민 포인트 정리)
**Next:** 다음 세션에서 이 문서를 기반으로 전체 설계

---

## 배경: 왜 지금 필요한가

Tower에 AI 대화 경로가 4개 생겼지만, 각각 다른 시스템으로 동작:

| 경로 | 저장소 | 가시성 | 공유 | 문제 |
|------|--------|--------|------|------|
| Sessions (1:1) | sessions 테이블 | 나만 (프로젝트 멤버도 볼 수 있긴 함) | 프로젝트 통해 암묵적 공유 | 권한 모델 불명확 |
| @ai (채널 인라인) | room_messages | 채널 멤버 전체 | 무조건 공개 | 개인화 불가 |
| @task (채널) | tasks + room_messages | 채널 멤버 전체 | 무조건 공개 | 개인화 불가 |
| AI Panel (제안) | sessions (room_id 연결) | 나만 | "채널에 공유" | 아직 미구현 |

**핵심 문제:** "누가 어떤 AI 대화를 볼 수 있는가"에 대한 일관된 모델이 없음.

---

## 현재 상태 (As-Is)

### Sessions
- `sessions` 테이블: id, title, engine, cwd, project_id 등
- project_id로 프로젝트에 연결 → 프로젝트 멤버가 볼 수 있음
- 하지만 "본다"의 범위가 불명확 (목록만? 내용도? 이어서 대화 가능?)
- 생성자 정보: `created_by` 필드 존재

### Projects
- 프로젝트별 멤버십: owner, admin, member, viewer
- 세션은 프로젝트에 속함 → 프로젝트 멤버가 세션 목록을 봄
- 그러나 다른 사람의 세션에 메시지를 보내는 건? (현재 가능하지만 의도된 건지 불분명)

### Channels (Rooms)
- room_members: owner, admin, member, readonly
- 메시지는 채널 멤버 전체에게 공개
- @ai/@task 결과도 채널에 공개

---

## 고민 포인트

### 1. Visibility 모델

**질문:** 세션의 가시성 레벨을 어떻게 나눌 것인가?

```
private     → 나만 봄 (현재 기본)
project     → 프로젝트 멤버 봄 (현재 암묵적)
channel     → 채널 멤버 봄 (AI Panel, @ai)
team        → 전체 팀 (필요한가?)
```

**고민:**
- `project`와 `channel`이 겹칠 수 있음 (채널이 프로젝트에 연결된 경우)
- `team` 레벨이 필요한가? 아니면 project가 충분한가?
- visibility 변경이 가능해야 하나? (private → channel 전환)

### 2. 세션 소유권 vs 접근 권한

**질문:** 다른 사람의 세션에서 무엇을 할 수 있는가?

| 행위 | 현재 | 제안 검토 필요 |
|------|------|---------------|
| 목록 보기 | 프로젝트 멤버 가능 | O |
| 내용 읽기 | 가능 (제한 없음) | 읽기 전용? |
| 이어서 대화 | 가능 (WS로 메시지 전송) | 금지? 별도 세션? |
| 복사/포크 | 없음 | Fork 기능? |

**고민:**
- 팀원의 세션에 내가 메시지를 보내면 혼란 (누가 보낸 건지?)
- "읽기 전용 공유"가 대부분의 유즈케이스를 커버할 듯
- Fork: 팀원 세션을 내 세션으로 복사 → 이어서 개인 대화

### 3. @ai 결과의 세션화

**질문:** @ai 인라인 답변도 세션으로 만들어야 하나?

**현재:** @ai 답변은 room_messages에 저장, 세션 없음
**제안:** @ai가 답변하면 숨겨진 session이 생성되고, 나중에 AI Panel에서 이어서 대화 가능?

**고민:**
- @ai를 세션으로 만들면 간단한 질문도 세션이 쌓임 → 노이즈
- 안 만들면 @ai 답변을 기반으로 이어서 대화하려면 다시 컨텍스트를 줘야 함
- 절충안: @ai는 세션 없이 유지, 이어서 대화하고 싶으면 AI Panel에서 "이 대화 이어가기" 클릭 → 그때 세션 생성

### 4. AI Panel의 위상

**질문:** AI Panel은 "채널의 부속"인가, "세션의 확장"인가?

A) **채널의 부속** — AI Panel은 채널에 붙어 있고, 채널 컨텍스트를 읽음. 채널이 없으면 AI Panel도 없음.
B) **세션의 확장** — AI Panel은 사실상 Session인데, 채널과 연결된 것. 채널 없이도 독립적으로 존재 가능 (= 기존 Sessions).
C) **둘 다** — AI Panel = Session with room_id. room_id가 있으면 채널 연결, 없으면 독립 세션.

**C가 가장 자연스러움** — Session이 근본이고, 채널 연결은 옵션.

### 5. DB 스키마 변경 범위

**최소 변경:**
```sql
ALTER TABLE sessions ADD COLUMN visibility TEXT DEFAULT 'private';
-- 'private' | 'project' | 'channel'
ALTER TABLE sessions ADD COLUMN room_id TEXT;
-- NULL = 독립 세션, UUID = 채널 연결 패널 세션
```

**고민:**
- `visibility`와 `room_id`가 중복인가? room_id가 있으면 자동으로 channel visibility?
- 아니면 room_id가 있어도 private일 수 있음 (= AI Panel의 개인 스레드)
- `panel_owner` 필드가 필요한가? 아니면 `created_by`로 충분?

### 6. 프론트엔드 세션 목록 통합

**현재:**
- Sessions 탭: 내 세션 목록 (project_id 필터)
- Channel: room_messages
- AI Panel: 없음 (제안 중)

**통합 후:**
- Sessions 탭: 내 세션 + 공유된 세션 (visibility 필터)
- Channel: 팀 대화 + @ai 인라인 (변경 없음)
- AI Panel: 내 세션 중 room_id가 있는 것

**고민:**
- Sessions 탭에 "Shared with me" 섹션이 필요?
- 프로젝트 세션과 채널 세션을 어떻게 구분해서 보여줄지?

### 7. 권한 에스컬레이션 흐름

```
private → "프로젝트에 공유" → project visibility
private → "채널에 공유"    → room_messages에 ai_summary로 포스트 (세션 자체는 private 유지)
channel → "내 세션으로"    → Fork (새 private 세션 생성, 대화 복사)
```

**고민:**
- "채널에 공유"는 세션 visibility를 바꾸는 건지, 아니면 메시지만 복사하는 건지?
- 후자가 단순 (세션은 private 유지, 결과만 채널에 포스트)

---

## 구현 우선순위 제안

### Phase 1: 기반 (지금)
- sessions 테이블에 `visibility`, `room_id` 컬럼 추가
- 기존 동작 변경 없음 (모든 세션 visibility = 'private')

### Phase 2: AI Panel (다음)
- AI Panel UI 구현
- Panel 세션 = visibility:'private' + room_id 연결
- "채널에 공유" = room_messages에 ai_summary 포스트

### Phase 3: 세션 공유
- Sessions 탭에 visibility 필터
- "프로젝트에 공유" / "읽기 전용 공유" 기능
- 공유된 세션 읽기 전용 뷰

### Phase 4: @ai 세션화 (선택)
- @ai 답변을 기반으로 AI Panel 스레드 생성 옵션
- "이 대화 이어가기" 버튼

---

## 다음 세션에서 결정해야 할 것

1. visibility 레벨 확정 (private/project/channel/team)
2. "다른 사람 세션 접근" 권한 매트릭스
3. DB 스키마 최종안
4. AI Panel UI 와이어프레임
5. "채널에 공유" 구체적 UX 흐름
6. @ai 인라인을 세션화할지 여부

---

## 참고 파일

- `docs/plans/2026-03-16-ai-panel-design.md` — AI Panel 초기 설계 (이 문서로 대체됨)
- `docs/plans/2026-03-15-ai-task-split-default-models.md` — @ai/@task 분리 구현 플랜
- `packages/backend/services/ai-quick-reply.ts` — @ai 빠른 답변 구현
- `packages/backend/services/ai-dispatch.ts` — @ai/@task 멘션 파싱
- `packages/backend/engines/types.ts` — Engine.quickReply() 인터페이스
- `packages/backend/routes/ws-handler.ts` — 채널 메시지 → @ai/@task 디스패치
- `packages/frontend/src/components/rooms/RoomPanel.tsx` — 채널 UI
- `packages/frontend/src/stores/room-store.ts` — 채널 상태 관리
