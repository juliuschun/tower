# Pi / Claude 채팅 UI 통일 작업 기록 (2026-04-10)

## 배경

Pi coding agent 경로와 Claude SDK 경로가 같은 채팅 화면을 사용하지만, 실제 체감은 달랐다.
특히 사용자가 메시지를 보낸 직후:

- 돌아가고 있다는 즉시 사인이 약함
- 첫 assistant 토큰이 오기 전까지 화면이 비어 보임
- 툴 실행 / 질문 대기 / 압축 같은 상태가 엔진별 리듬 차이에 따라 다르게 느껴짐

핵심 문제는 엔진보다 **프론트 상태 모델**이었다.
백엔드는 이미 `TowerMessage` 기반으로 상당 부분 통일돼 있지만, 프론트는 여전히 `sdk_message`, `sdk_done`, `parseSDKMessage()` 등 Claude 중심 legacy 흐름에 기대고 있었다.

## 이번 변경의 목표

스트리밍을 없애지 않고, 다음 원칙을 먼저 만족시키는 것:

1. 메시지 전송 직후 즉시 반응
2. 스트리밍이 늦어도 "일하는 중"이 보이게
3. queued / preparing / tool_running / awaiting_user / compacting / done / error 상태를 엔진과 무관하게 표시
4. Pi와 Claude가 같은 UX 리듬으로 보이게

## 구현 내용

### 1. session별 turn state 도입

파일: `packages/frontend/src/stores/chat-store.ts`

추가:

- `TurnPhase`
  - `idle`
  - `queued`
  - `preparing`
  - `streaming`
  - `tool_running`
  - `awaiting_user`
  - `compacting`
  - `done`
  - `error`
- `SessionTurnState`
- `turnStateBySession`
- `setTurnPhase()`
- `clearTurnState()`

그리고 queue 조작(`enqueueMessage`, `dequeueMessage`, `removeQueuedMessage`, `clearSessionQueue`)이 turn state를 함께 갱신하도록 변경했다.

### 2. active session turn state 훅 추가

파일: `packages/frontend/src/hooks/useActiveSessionTurnState.ts`

현재 보고 있는 세션의 turn state를 안전하게 읽는 공통 훅을 만들었다.

### 3. useClaudeChat에 turn phase 전이 로직 연결

파일: `packages/frontend/src/hooks/useClaudeChat.ts`

다음 이벤트에서 상태를 갱신하도록 연결했다.

- 메시지 전송 시 → `preparing`
- reconnect / active session restore 시 → `preparing`
- assistant 메시지 도착 시
  - tool_use 포함 → `tool_running`
  - 일반 텍스트 → `streaming`
- compact start → `compacting`
- compact end / assistant 복귀 → `streaming`
- ask_user → `awaiting_user`
- ask_user timeout → `preparing`
- sdk_done / idle sync → `done` 후 `idle`
- error / restart → `error`
- session busy queueing → `queued`

즉, 프론트가 "스트리밍 bool 하나"가 아니라 "이번 턴이 지금 어느 단계인지"를 추적하게 바꿨다.

### 4. ChatPanel placeholder assistant UI 추가

파일: `packages/frontend/src/components/chat/ChatPanel.tsx`

이전에는 assistant 첫 토큰이 오기 전까지 하단 점 3개 인디케이터가 제한적으로만 떴다.
이제는 active turn phase 기반으로 placeholder assistant bubble이 나타난다.

표시 예:

- `preparing` → `응답 준비 중…`
- `tool_running` → `도구 실행 중…`
- `awaiting_user` → `응답을 기다리는 중…`
- `compacting` → `컨텍스트 정리 중…`

이로써 Pi든 Claude든 첫 토큰 전 공백 구간이 훨씬 덜 불안하게 보인다.

### 5. InputBox 상태 문구 정리

파일: `packages/frontend/src/components/chat/InputBox.tsx`

입력창 위에 phase 기반 상태 바를 추가했다.

- queued → 대기열 안내
- preparing → 응답 준비 중
- streaming → 답변 작성 중
- tool_running → 도구 실행 중
- awaiting_user → AI가 답변 대기 중
- compacting → 컨텍스트 정리 중
- error → 이전 턴 오류

주의: 기존 테스트와의 호환성을 위해 textarea placeholder의 영어 문구(`Type a message...`, `Type a message to send on the next turn...`)는 유지했다.
실제 상태 설명은 placeholder 대신 상태 바에서 제공한다.

## 왜 이 접근이 맞는가

스트리밍을 없애면 구현은 쉬워질 수 있지만, Tower는 단순 챗봇이 아니라 도구 실행형 에이전트이기 때문에 과정 가시성이 중요하다.
따라서 방향은:

- 스트리밍 제거 ❌
- 상태 중심 UX 위에 스트리밍 추가 ⭕

즉 "스트리밍이 없어도 불안하지 않은 UX"를 먼저 만들고,
스트리밍은 그 위에서 체감 속도와 과정 투명성을 높이는 보너스로 쓰는 구조가 맞다.

## 검증 결과

실행:

- `npm test`

결과:

- 49 test files passed
- 465 tests passed

## 후속 진행 사항

이번 작업은 체감 문제를 우선 해결한 1차 통일이고, 이어서 일부 구조 정리도 바로 진행했다.

완료:

1. `useChatRuntime.ts` 추가 — 앱 진입점은 더 이상 `useClaudeChat` 이름을 직접 쓰지 않게 함
2. 문서와 테스트 설명에서 runtime 관점 명칭으로 정리 시작
3. `engineSessionId` alias 도입 — frontend shared/store 레벨에서 Claude 중심 명칭 일반화 시작
4. `tower_message` 직접 소비 경로 추가 — backend는 이제 TowerMessage를 그대로도 브로드캐스트하고, frontend는 legacy `sdk_message`와 병행 소비 가능
5. Pi 세션 응답 즉시 미표시 문제 수정 — direct `tower_message` 처리 시 active session 정렬을 먼저 수행하도록 보정

아직 남은 구조 작업:

1. `ws-handler.ts`의 `towerToLegacy()` 완전 제거
2. tool_running 시 active tool summary까지 상태바에 노출
3. backend / API payload에서도 `engineSessionId` 명칭으로 점진 이관

추가 진척:

- Session sidebar badge도 turn phase를 반영하기 시작했다.
  - `tool_running` → `tool`
  - `awaiting_user` → `ask`
  - `compacting` → `pack`
  - `queued` → `Q`
  - `error` → `err`
- `useClaudeChat.ts` 내부의 assistant / turn metrics / turn finish 처리를 공통 helper로 추출해 `tower_message`와 `sdk_message`가 같은 경로를 더 많이 공유하도록 정리했다.
- 툴 실행 UI가 스트리밍 중 흔들리던 원인 중 하나를 보정했다. assistant 업데이트마다 tool block이 재정규화되면서 기존 `toolUse.result`가 사라져 누적 툴 카드 / Todo 상태가 실행 중처럼 다시 흔들릴 수 있었는데, `normalizeContentBlocks(previousBlocks)`가 이전 tool result를 보존하도록 수정했다.
- queue UX를 단순화했다. 대기열 메시지를 InputBox 아래 별도 리스트로 반복 노출하지 않고, 채팅창의 user bubble 하나에 `queued` 상태를 붙이는 방식으로 정리했다. 상태바는 요약만 보여주고, 실제 내용은 메시지 버블이 단일 source of truth가 된다.
- 상태 표현도 한 단계 정리했다. queued / failed user bubble에 직접 액션을 붙여, queued는 bubble에서 바로 `취소`, failed는 바로 `다시 시도`할 수 있도록 했다.
- tool / thinking / agent 패널의 열림 상태가 스트리밍 중 재렌더에서 쉽게 초기화되던 문제를 줄이기 위해, 메시지/그룹/툴 id 기반의 작은 UI state cache를 도입했다. 이제 청크가 추가되어도 열린 chip/detail 패널이 더 안정적으로 유지된다.
- live running 표시도 한 단계 더 안정화했다. 단순히 `isStreaming && 마지막 카드`에 기대지 않고, runtime turn state의 `activeToolName` / `activeToolSummary`를 채워 현재 실제 활성 툴과 더 잘 맞도록 만들었다. Todo live 카드도 같은 turn phase를 참고해 덜 흔들리게 했다.
- 그 다음 보강으로 `activeToolId`도 turn state에 추가했다. summary 문자열은 사람이 보기엔 좋지만 식별자로는 약하므로, tool UI의 running 표시와 active 판단을 점점 `activeToolId` 우선으로 옮기고 summary 비교는 fallback으로만 남겼다.
- 마지막으로 가능하면 실제 `toolUse.id`를 그대로 쓰도록 `activeToolUseId`를 추가했다. 이제 tool chip/card는 런타임이 알려준 실제 tool call id를 우선 보고, `name:summary` 합성 id와 summary 비교는 호환용 보조 경로로만 남긴다.
- 배포/재시작 후 하드 리프레시 필요성을 줄이기 위해, 프론트는 chunk load 에러를 만나면 1회 자동 reload를 시도하고, 서버 `/api/config`의 `buildId`가 바뀐 것을 감지하면 현재 턴이 비어 있을 때만 안전하게 자동 reload 하도록 했다.
- 사용자가 작업 중이면 자동 reload 대신 상단 `UpdateBanner`로 새 버전 준비 상태를 안내하고 직접 새로고침할 수 있게 했다. 또한 PWA precache에서 `html`을 제외해, 오래된 app shell이 남아 하드 리프레시가 필요해지는 확률을 더 낮췄다.
- 여기에 더해 `virtual:pwa-register`를 연결해 service worker update lifecycle을 앱이 더 직접 제어하도록 만들었다. 이제 새 worker가 준비되면 앱이 `UpdateBanner`를 띄우고, 사용자는 `지금 새로고침` 또는 `현재 턴 끝나면 자동 업데이트`를 선택할 수 있다.

## 요약

이번 수정으로 Pi 경로와 Claude 경로의 차이를 없애는 첫 단계가 들어갔다.
핵심 변화는 "엔진별 이벤트"를 직접 믿는 대신, 프론트가 session별 turn phase를 명시적으로 갖게 만든 것이다.

그 결과:

- 전송 직후 응답 준비 상태가 보임
- 첫 토큰 전 공백이 덜 불안함
- 도구 실행 / 질문 대기 / 압축 상태가 더 자연스럽게 드러남
- 스트리밍은 유지하면서도, 스트리밍 의존도는 낮아짐
