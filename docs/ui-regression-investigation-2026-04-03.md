# UI Regression Investigation — 2026-04-03

## 배경

최근 며칠 동안 `pi coding agent` 연동과 `claude code` 연동 주변에서 수정이 많이 들어간 뒤,
다음과 같은 UI 문제가 관찰되었다.

1. **pi 쪽 ToolChip이 기대대로 보이지 않거나, 안 보이는 것처럼 느껴지는 문제**
2. **웹앱 채팅 기록에서 누가 대화했는지(화자 정보)가 예전보다 잘 안 보이는 문제**

이 문서는 해당 현상을 코드 기준으로 추적한 결과를 정리한 것이다.

---

## 결론 요약

이번 이슈는 하나의 단일 버그라기보다, 최근 들어간 몇 개의 UI/성능 개선 커밋이 서로 맞물리면서 생긴 **회귀(regression)** 로 보는 것이 가장 적절하다.

### 핵심 결론

- **ToolChip 문제**는 최근 Tool UI 통합 과정에서 요약(summary) 로직의 중요도가 커졌고,
  그 과정에서 **pi 입력 포맷(`path`)과 기존 가정(`file_path`)의 차이**가 충분히 반영되지 않아 발생한 회귀다.
- **화자 표시 문제**는 메시지 페이지네이션/복구 최적화 과정에서,
  과거 user 메시지의 username을 메시지 단위가 아니라 **세션 ownerUsername으로 단순화**한 것이 직접 계기다.
- 다만 화자 문제는 프론트만의 문제가 아니라,
  **백엔드 messages 스키마 자체에 username 컬럼이 없다는 구조적 한계**가 함께 존재한다.

---

## 조사 범위

추적 대상으로 확인한 주요 파일:

- `packages/frontend/src/components/chat/MessageBubble.tsx`
- `packages/frontend/src/components/chat/ToolUseCard.tsx`
- `packages/frontend/src/utils/message-parser.ts`
- `packages/frontend/src/hooks/useClaudeChat.ts`
- `packages/frontend/src/components/sessions/SessionItem.tsx`
- `packages/backend/routes/ws-handler.ts`
- `packages/backend/services/message-store.ts`
- `packages/backend/db/migrations/008_sessions.sql`

참고한 주요 git 커밋:

- `d7fe557f` — Show thinking titles and inline tool chips
- `1f20fd5c` — unify tool/agent chip display + fix sub-agent message isolation
- `ee01cbc7` — paginated message loading + session switch performance optimization
- `0147ab39` — unify SQLite → PostgreSQL — single DB for multi-instance support

---

## 증상 1: pi ToolChip이 잘 안 보이거나 이상하게 보임

## 관찰 내용

최근 채팅 UI는 assistant 메시지 안의 tool use를 다음 두 층으로 표현한다.

1. **collapsed summary bar**
2. 펼쳤을 때 나오는 **개별 ToolChip / ToolUseCard**

즉 사용자가 처음 보는 정보는 개별 상세 카드가 아니라,
"몇 개의 툴이 실행되었고 어떤 툴이었는지"를 요약하는 한 줄짜리 UI다.

이 구조에서는 각 툴의 summary 생성 로직이 매우 중요하다.

## 관련 커밋 흐름

### `d7fe557f` — Show thinking titles and inline tool chips
이 커밋에서 thinking block과 tool chip이 assistant 메시지 안에서 더 적극적으로 노출되기 시작했다.
즉 "툴이 있었다"는 정보가 UI에서 더 전면으로 나왔다.

### `1f20fd5c` — unify tool/agent chip display + fix sub-agent message isolation
이 커밋에서 ToolChipGroup collapsed bar가 AgentCard 스타일과 맞춰지며,
다음과 같은 표시 방식이 도입되었다.

- `N tools · summary`
- streaming 중에는 마지막 tool summary를 표시
- done 상태에서는 tool type summary를 표시

이 변경은 UX 상으론 자연스럽지만,
동시에 **summary 값이 정확해야만 UI가 자연스럽게 보이는 구조**로 만들었다.

## 직접 원인

`packages/frontend/src/utils/message-parser.ts`의 `getToolSummary()`는 원래 다음처럼 동작했다.

- `Read` → `input.file_path`
- `Write` → `input.file_path`
- `Edit` → `input.file_path`

하지만 pi 쪽 tool input은 상황에 따라 `file_path`가 아니라 `path`를 사용한다.

즉 기존 가정은 다음과 같았다.

- "파일 계열 tool은 file_path를 가진다"

하지만 pi 현실은 다음과 같았다.

- "파일 계열 tool은 file_path일 수도 있고 path일 수도 있다"

이 차이 때문에 summary가 빈약해지거나,
collapsed 상태에서 기대한 정보가 보이지 않아 사용자가
**"toolchip이 안 나온다" 혹은 "tool UI가 깨졌다"** 고 느끼기 쉬운 상태가 되었다.

## 해석

이건 단순히 CSS가 깨진 문제라기보다,
**표시 구조가 summary 중심으로 바뀐 뒤 summary 데이터 가정이 깨진 문제**다.

즉, 이전에는 detail 레이어에서만 노출되던 정보가
이제는 collapsed 1차 UI로 올라왔는데,
그 1차 UI를 만드는 데이터 정규화가 pi 포맷을 완전히 흡수하지 못했다.

---

## 증상 2: 웹앱 채팅 기록에서 누가 대화했는지 잘 안 보임

## 관찰 내용

최근 사용자가 느낀 문제는 단순히 "이름 텍스트가 사라졌다"가 아니라,
**예전엔 누가 말했는지 더 분명했는데, 지금은 그 정보가 덜 보인다**는 종류의 문제다.

이 문제는 메시지 렌더 자체보다,
**과거 메시지를 DB에서 복구해서 ChatMessage로 매핑하는 과정**과 연결되어 있었다.

## 관련 커밋 흐름

### `ee01cbc7` — paginated message loading + session switch performance optimization
이 커밋은 성능 관점에서 중요한 개선이었다.

주요 변경:
- 최근 500개 메시지만 로드
- 페이지네이션 도입
- 세션 전환 시 더 빠른 복구
- 메시지 매핑 로직 정리 (`mapStoredToChat`)

문제는 이 정리 과정에서 과거 user 메시지의 username 처리 방식이 지나치게 단순화된 점이다.

## 직접 원인

`packages/frontend/src/hooks/useClaudeChat.ts`에서 DB 메시지를 `ChatMessage`로 변환할 때,
기존 로직은 사실상 다음과 같았다.

- user 메시지면 `username = ownerUsername`

즉 메시지에 실제 username이 따로 있더라도,
혹은 세션 안에서 발화 주체가 owner와 달라질 수 있더라도,
복구 시점에서는 세션 owner 기준으로 정리해버렸다.

이 방식은 아래 상황에서 특히 문제가 된다.

- 프로젝트 공유 세션
- 여러 사람이 관여한 세션 맥락
- side panel / AI panel / thread 성격이 섞인 기록
- 이후 owner가 아닌 실제 발화자 구분이 필요한 UI

결과적으로 사용자는
**"누가 말했는지 구분이 약해졌다"**
혹은
**"이전보다 화자 정보가 사라진 느낌"**
을 받게 된다.

## 해석

이건 페이지네이션 자체의 문제는 아니다.
오히려 페이지네이션과 성능 최적화를 하면서,
복구 매핑 로직이 **정확성보다 단순성 쪽으로 기울어진 결과**라고 보는 편이 정확하다.

---

## 더 깊은 원인: 백엔드 저장 구조의 한계

프론트 문제를 추적하던 중,
화자 표시 이슈는 백엔드 구조적 한계와도 연결되어 있음을 확인했다.

## messages 테이블 구조

`packages/backend/db/migrations/008_sessions.sql` 기준 `messages` 테이블 컬럼:

- `id`
- `session_id`
- `role`
- `content`
- `parent_tool_use_id`
- `duration_ms`
- `input_tokens`
- `output_tokens`
- `created_at`

여기에는 **`username` 컬럼이 없다.**

## saveMessage 경로

`packages/backend/routes/ws-handler.ts`에서 user 메시지를 저장할 때도,
실질적으로는 다음 정보만 저장한다.

- id
- role
- content

`packages/backend/services/message-store.ts`의 `saveMessage()`도 동일하게
username을 저장하지 않는다.

## 의미

이 구조에서는 과거 메시지를 다시 불러올 때,
메시지마다 "누가 실제로 말했는가"를 정확히 복원할 수 없다.

즉 현재 시스템은 과거 히스토리에서 화자를 복원할 때,
정확한 원본 데이터가 아니라 주변 정보(세션 owner 등)에 기대는 구조다.

이 구조에서는 프론트가 아무리 잘 해도 한계가 있다.

### 비유

택배 상자에 보낸 사람 이름을 아예 적지 않은 뒤,
나중에 "아마 이 집 주인이 보낸 거겠지" 하고 추정하는 방식과 비슷하다.

작은 범위에서는 대충 맞을 수 있지만,
공유/협업/패널 맥락이 섞이면 정확도가 무너진다.

---

## 실제 원인 체인 정리

### ToolChip 회귀 체인

1. thinking/tool chip UI가 더 전면화됨
2. tool/agent collapsed summary bar가 도입/강화됨
3. summary 생성 로직의 중요도가 커짐
4. 파일계 툴 요약이 `file_path` 중심 가정에 묶여 있었음
5. pi 쪽 입력은 `path`를 사용할 수 있음
6. 결과적으로 collapsed UI에서 정보가 빈약하거나 부정확해짐
7. 사용자는 toolchip이 안 나오거나 이상하다고 체감함

### 화자 표시 회귀 체인

1. 메시지 페이지네이션/복구 최적화 도입
2. `mapStoredToChat()` 중심으로 복구 로직 정리
3. user 메시지 username을 실제 메시지 기반이 아니라 ownerUsername으로 단순화
4. 협업/공유/패널 맥락에서 화자 구분 정확도 하락
5. 웹앱에서 "누가 대화했는지" 정보가 약해졌다고 체감
6. 근본적으로 DB messages 스키마에 username이 없어 장기 정확도도 부족

---

## 확인한 수정 사항

이번 조사 과정에서 다음 프론트 수정은 이미 적용했다.

### 1) Tool summary에서 `path` 지원
파일:
- `packages/frontend/src/utils/message-parser.ts`

변경:
- `Read` / `Write` / `Edit` summary 생성 시
  `input.file_path || input.path` 모두 지원

효과:
- pi 입력 포맷도 정상적으로 요약 가능

### 2) DB 복구 시 stored username 우선 사용
파일:
- `packages/frontend/src/hooks/useClaudeChat.ts`

변경:
- DB message에 username이 있으면 그 값을 우선 사용
- 없을 때만 ownerUsername fallback 사용

효과:
- 이미 username을 보유한 레코드나 향후 확장된 응답에서
  화자 정보 보존 가능

### 3) 테스트 추가/수정
관련 테스트:
- `packages/frontend/src/components/chat/ToolUseCard.test.tsx`
- `packages/frontend/src/components/chat/MessageBubble.test.tsx`
- `packages/frontend/src/hooks/useClaudeChat.test.ts`

---

## 아직 남아 있는 과제

이번에 확인된 내용 중, 장기적으로는 아래를 정리해야 한다.

### A. 메시지 스키마에 username 저장 여부 결정
가장 근본적인 해결책은 `messages` 테이블에 username을 추가하는 것이다.

예상 작업:
- migration 추가
- `saveMessage()` 시 username 저장
- 조회 API에서 username 반환
- 프론트는 `message.username` 우선 사용

이렇게 하면 공유 세션/협업 세션에서도 과거 화자 표시가 훨씬 안정된다.

### B. Tool input 정규화 전략 일원화
현재는 화면 요약 단계에서 `file_path || path`를 처리하고 있다.
장기적으로는 다음 둘 중 하나가 더 바람직하다.

1. 프론트 normalize 단계에서 tool input shape를 일관화
2. backend/engine bridge에서 공통 포맷으로 변환

즉 렌더 직전에 예외 처리하기보다,
조금 더 앞단에서 데이터 형태를 통일하는 편이 안전하다.

### C. 회귀 방지 테스트 보강
다음 시나리오를 테스트로 고정할 필요가 있다.

- pi tool input에서 `path`만 오는 경우
- shared/project session에서 ownerUsername과 message.username이 다른 경우
- paginated recover / merge 경로 모두에서 화자 정보가 유지되는지
- collapsed tool summary가 tool 상세와 일관된지

---

## 추천 후속 작업

우선순위 기준으로 보면 다음 순서가 합리적이다.

1. **문제 재현 케이스를 작은 fixture로 고정**
2. **messages.username 저장 여부 결정**
3. **tool input normalization layer 정리**
4. **회귀 테스트 보강**

즉 단순히 이번 버그를 고치는 데서 끝내기보다,
"UI가 보여주는 의미"와 "저장되는 원본 데이터"의 관계를 다시 맞추는 작업이 필요하다.

---

## 한 줄 요약

이번 UI 문제는 최근 개선 작업 자체가 나빴다기보다,
**표현 방식이 더 똑똑해진 만큼 입력 데이터 가정과 복구 로직의 정확성도 같이 올라갔어야 했는데,
그 간극이 회귀로 드러난 사례**라고 볼 수 있다.
