# 이슈: 세션 전환 시 스트리밍 응답 소실

**상태**: ✅ 해결됨
**날짜**: 2026-02-23
**관련 파일**: ws-handler.ts, session-guards.ts, useClaudeChat.ts, App.tsx, ChatPanel.tsx

---

## 증상

1. **AI 응답 중 다른 세션으로 전환하면 응답이 소실됨**
   - 백엔드에서 SDK 쿼리가 abort 되면서 DB에도 응답이 저장되지 않음
   - 돌아와도 응답이 없음

2. **"AI가 타이핑 중" 인디케이터가 세션 전환 시 사라짐**
   - 프론트엔드가 세션 전환 시 명시적으로 `abort()` 호출
   - 돌아와도 스트리밍 상태를 복구하지 않음

3. **다른 탭에서 같은 세션을 보면 응답을 못 받음**
   - 초기 `sessionClients`가 1:1 매핑이어서, 세션당 하나의 클라이언트만 메시지를 받음

---

## 근본 원인 분석

### 원인 1: 프론트엔드 `handleSelectSession`에서 abort() 호출

**파일**: `frontend/src/App.tsx` (기존 ~line 201-204)

```typescript
// 기존 코드 (문제)
if (useChatStore.getState().isStreaming) {
  abort();  // ← 세션 전환 시 SDK 쿼리를 강제 중단!
}
```

세션 전환이라는 UI 동작이 백엔드의 SDK 쿼리를 죽이고 있었음. 사용자가 세션 A에서 대화 중 세션 B를 보러 가면, 세션 A의 쿼리가 완전히 중단됨.

### 원인 2: 백엔드 `handleSetActiveSession`의 epoch 범핑

**파일**: `backend/routes/ws-handler.ts`

기존 `handleSetActiveSession`이 `switchSession()`을 호출 → epoch이 증가됨 → 스트리밍 루프의 `isEpochStale()` 체크에서 루프가 종료되고 `abortSession()` 호출.

```typescript
// 기존 스트리밍 루프 내 epoch 가드
if (isEpochStale(client, myEpoch)) {
  abortSession(sessionId);  // ← epoch이 바뀌면 진행 중인 SDK 쿼리를 강제 중단!
  break;
}
```

즉, 세션 전환 → epoch 범핑 → 스트리밍 루프 감지 → SDK abort. 이게 "설계대로"였지만, 실제로는 사용자가 잠깐 다른 세션을 보러 갔을 뿐인데 진행 중인 대화가 죽는 결과를 초래.

### 원인 3: sessionClients 1:1 매핑

**파일**: `backend/routes/ws-handler.ts`

초기 구현에서 `sessionClients`가 `Map<string, string>` (세션 → 하나의 클라이언트)이었음. 같은 세션을 여러 탭에서 열면 마지막 탭만 메시지를 받음.

---

## 시도한 수정

### 수정 1: sessionClients 1:many 리팩토링 ✅ 완료

`sessionClients`를 `Map<string, Set<string>>`로 변경. 세션당 여러 클라이언트(탭)가 메시지를 받을 수 있게 함.

**변경 파일:**
- `backend/routes/session-guards.ts` — 전체 리라이트
  - `addSessionClient`, `removeSessionClient`, `findSessionClient` 등 새 API
- `backend/routes/session-guards.test.ts` — 17개 테스트 추가
- `backend/routes/ws-handler.ts` — `broadcastToSession()` 추가, 스트리밍 메시지를 모든 뷰어에게 전송

**결과**: 같은 세션을 보는 모든 탭이 실시간 스트리밍 메시지를 받음. 테스트 통과 (44개).

**배운 것**: 이 수정은 정확하지만, 실제 사용 패턴에서는 각 탭이 보통 다른 세션을 열기 때문에 핵심 문제를 직접 해결하진 않았음. 핵심은 "세션 전환 시 왜 SDK가 죽느냐"였음.

### 수정 2: 프론트엔드 abort() 제거 ✅ 완료

**변경 파일:** `frontend/src/App.tsx`

```typescript
// 수정 후
// DON'T abort streaming — let the SDK query run in the background and save to DB.
useChatStore.getState().setStreaming(false);
```

`abort()` 대신 `setStreaming(false)`만 호출. UI에서 "타이핑 중" 표시만 끄고, 백엔드의 SDK 쿼리는 계속 실행되게 함.

### 수정 3: handleSetActiveSession에서 epoch 범핑 제거 ✅ 완료

**변경 파일:** `backend/routes/ws-handler.ts`

`switchSession()` 호출 (epoch 범핑 포함)을 제거하고, 직접 viewer set만 조작:

```typescript
// 수정 후 — epoch 범핑 없음
if (oldSessionId && oldSessionId !== newSessionId) {
  removeSessionClient(sessionClients, oldSessionId, client.id);
}
client.sessionId = newSessionId;
addSessionClient(sessionClients, newSessionId, client.id);
```

추가로 `set_active_session_ack`에 `isStreaming` 플래그 포함:

```typescript
send(client.ws, {
  type: 'set_active_session_ack',
  sessionId: newSessionId,
  isStreaming: !!targetSdkSession?.isRunning,
});
```

### 수정 4: 스크롤 애니메이션 최적화 ✅ 완료

**변경 파일:** `frontend/src/components/chat/ChatPanel.tsx`

`scrollIntoView({ behavior: 'smooth' })` → `useLayoutEffect` + `el.scrollTop = el.scrollHeight`

브라우저 페인트 전에 스크롤 위치를 설정해서 시각적 애니메이션 없이 즉시 최하단에 위치.

---

## 추가 수정 (2차) ✅ 완료

### 수정 5: 스트리밍 루프에서 isEpochStale 가드 제거 ✅ 완료

**파일**: `backend/routes/ws-handler.ts`

**결정**: epoch은 per-client라서, 다른 세션에서 새 chat을 보내면 이전 세션의 루프까지 죽이는 문제 발견. 가드를 완전히 제거.

- 루프 내 `isEpochStale` 체크 및 `abortSession()` 호출 제거
- 루프 후 `isEpochStale` 체크 제거 (정상 완료 시 항상 `sdk_done` 전송)
- `isEpochStale`, `switchSession` import 제거

### 수정 6: claudeSessionId 교차 오염 방지 ✅ 완료

**파일**: `backend/routes/ws-handler.ts`

- `client.claudeSessionId` 대신 `loopClaudeSessionId` 로컬 변수로 추적
- 루프 후 `client.sessionId === sessionId`인 경우에만 client에 반영
- `sdk_done`에서 로컬 변수 사용 (다른 세션으로 전환해도 올바른 값 전송)

### 수정 7: 프론트엔드 set_active_session_ack 핸들러 ✅ 완료

**파일**: `frontend/src/hooks/useClaudeChat.ts`

```typescript
case 'set_active_session_ack': {
  if (data.isStreaming) {
    useChatStore.getState().setStreaming(true);
    currentAssistantMsg.current = null;
    if (data.sessionId) {
      mergeMessagesFromDb(data.sessionId);
    }
  }
  break;
}
```

### 수정 8: 테스트 업데이트 ✅ 완료

**파일**: `backend/routes/ws-handler.test.ts`

- "stops stale query loop" 테스트 → "streaming continues in background" 테스트로 교체
  - 2개 클라이언트: A가 chat 시작 후 세션 전환, B가 같은 세션에 남아 메시지 수신 확인
  - `abortSession`이 호출되지 않았음을 검증
  - 3개 메시지 모두 전달되고 `sdk_done` 수신됨을 검증
- "set_active_session_ack includes isStreaming flag" 테스트 추가
- 45개 테스트 모두 통과

---

## 배운 것들

### 1. 세션 전환 ≠ 대화 중단

초기 설계에서 세션 전환을 "이전 세션의 모든 것을 정리"하는 동작으로 취급. 실제 사용자 기대는 "다른 세션 보러 갔다가 돌아오면 대화가 계속 진행되어 있어야 함."

**원칙**: UI 네비게이션 동작이 백엔드 리소스(SDK 쿼리)의 생명주기를 제어하면 안 됨. 이 둘은 분리되어야 함.

### 2. Epoch 가드의 이중성

epoch은 "stale query 감지"를 위한 메커니즘이었지만, 세션 전환에도 epoch을 범핑하면서 의도치 않게 "세션 전환 = 쿼리 중단" 정책이 됨.

**배운 것**: 하나의 메커니즘(epoch)이 두 가지 다른 의미(새 쿼리 시작 vs 세션 전환)를 가지면 버그가 숨어들기 쉬움. 각 의미에 명확히 분리된 메커니즘을 사용해야 함.

### 3. 1:1 vs 1:many는 부수 문제

`sessionClients`를 1:many로 바꾸는 것은 정확했지만 핵심 문제가 아니었음. 핵심은 epoch 범핑과 프론트엔드 abort였음. 실제 사용 패턴을 먼저 확인했으면 더 빨리 핵심에 집중할 수 있었음.

### 4. DB 증거 확인의 중요성

DB에서 user 메시지만 있고 assistant 응답이 없는 패턴을 발견해서 "SDK 쿼리가 abort되고 있다"를 확인. 로그나 추측이 아닌 데이터 증거로 문제를 특정.

### 5. 스크롤 성능은 API 선택 문제

`scrollIntoView({ behavior: 'smooth' })`가 메시지가 많을 때 무거움. `useLayoutEffect` + `scrollTop` 직접 설정이 훨씬 빠르고 시각적으로도 자연스러움 (페인트 전 위치 설정).

---

## 아키텍처 인사이트

### 현재 구조의 한계

```
[탭 A: 세션 s1] ──WS──→ [백엔드 WsClient A]
[탭 B: 세션 s2] ──WS──→ [백엔드 WsClient B]
```

각 탭이 하나의 WsClient를 가지고, WsClient는 현재 활성 세션(`sessionId`)을 가짐. 세션 전환 시 같은 WsClient의 `sessionId`가 바뀜.

스트리밍 루프는 `client`를 캡처하고 있어서, 클라이언트가 세션을 전환하면 루프가 참조하는 `client.sessionId`도 바뀜. 하지만 루프는 자체적으로 `sessionId`를 로컬 변수로 캡처하므로 broadcast 대상 세션은 올바름.

**핵심 결정**: SDK 쿼리의 생명주기를 WsClient(탭)에 묶을 것인가, 세션에 묶을 것인가?
- 현재: 클라이언트에 묶여 있음 (epoch이 client 레벨)
- 이상적: 세션에 묶여야 함 (abort는 명시적 사용자 동작에만)

---

## 추가 수정 (3차) — 진범 발견 ✅ 완료

### 수정 9: `handleNewSession` / `handleNewSessionInFolder`의 abort() 제거 ✅ 완료

**파일**: `frontend/src/App.tsx`

**발견 경위**: 디버그 로깅(`handleChat START/END`, `handleAbort`, `sdk.abortSession` 스택 트레이스)을 추가한 후 재현.

**로그 증거**:
```
01:49:58: handleChat START session=0094f2d7  ← "tell me a joke" 보냄
01:50:00: handleAbort session=0094f2d7       ← 프론트엔드가 abort 보냄!
01:50:00: [sdk] abortSession session=0094f2d7 (from handleAbort)
01:50:00: setActiveSession new=0277681f      ← 새 세션으로 전환
01:50:01: handleChat ERROR: Claude Code process aborted by user
01:50:03: handleChat START session=0277681f  ← "tell me two jokes" 보냄 (성공)
```

**근본 원인**: `handleSelectSession`에서 `abort()` 제거는 완료했지만, **`handleNewSession`과 `handleNewSessionInFolder`에도 동일한 `abort()` 호출이 남아있었음**. 사용자가 "+" 버튼으로 새 세션을 만들 때 기존 스트리밍을 죽이고 있었음.

**수정**: 세 함수 모두 동일한 패턴으로 통일:
```typescript
// Before (세 함수 모두 이 패턴이었음):
if (useChatStore.getState().isStreaming) {
  abort();  // ← 백엔드 SDK 쿼리를 강제 중단!
}

// After (abort() → setStreaming(false)):
useChatStore.getState().setStreaming(false);
// 백엔드 쿼리는 계속 실행되어 DB에 저장됨
```

| 함수 | abort 제거 시점 |
|------|----------------|
| `handleSelectSession` | 2차 수정에서 제거 |
| `handleNewSession` | **3차 수정에서 제거** |
| `handleNewSessionInFolder` | **3차 수정에서 제거** |

**교훈**: `abort()` 호출을 하나만 제거하면 안 됨. **모든 세션 네비게이션 경로**에서 일관되게 제거해야 함. `grep 'abort()'`로 전체 검색해서 한꺼번에 처리했어야 했음.

### 수정 10: 디버그 로깅 추가 ✅ 완료

**파일**: `backend/routes/ws-handler.ts`, `backend/services/claude-sdk.ts`

- `handleChat`: START/END/ERROR 로깅 (세션ID, 클라이언트ID, activeSDK 수)
- `handleAbort`: 호출 시점 로깅
- `handleSetActiveSession`: old/new 세션 로깅
- `abortSession`: 스택 트레이스 포함 (누가 abort를 호출했는지 추적)
- `cleanupSession`: running 상태에서 cleanup 시 경고 로깅

### 수정 11: Footer에 session ID 표시 ✅ 완료

**파일**: `frontend/src/App.tsx`

- 오른쪽 끝에 세션 ID 앞 8자리 표시
- 클릭하면 전체 ID 클립보드 복사
- hover 시 전체 ID 표시 (title 속성)

---

## 배운 것들 (추가)

### 6. 하나의 abort() 제거로는 부족 — 모든 네비게이션 경로를 확인

`abort()`가 `handleSelectSession`, `handleNewSession`, `handleNewSessionInFolder` 세 곳에 있었음. 하나만 제거하고 "고쳤다"고 생각했지만 실제로는 사용자가 **새 세션 만들기** 경로를 사용하면 여전히 abort가 발생.

**원칙**: 동작을 변경할 때는 해당 동작을 호출하는 **모든 코드 경로**를 찾아야 함. `grep`으로 전체 검색 필수.

### 7. 디버그 로깅이 결정적

`handleChat START/END` + `handleAbort` + `sdk.abortSession` 스택 트레이스를 추가한 후 **1번의 재현으로 정확한 원인 특정**. 로그 없이 코드만 보고는 `handleNewSession`의 abort가 범인이라는 걸 발견하기 어려웠음.

**원칙**: 재현 가능한 버그에는 추측보다 관측(로그, DB 증거)이 빠름.

---

## 현재 상태

**abort() 호출 경로 (최종)**:
- ~~`handleSelectSession`~~ → `setStreaming(false)` (제거됨)
- ~~`handleNewSession`~~ → `setStreaming(false)` (제거됨)
- ~~`handleNewSessionInFolder`~~ → `setStreaming(false)` (제거됨)
- `onAbort` 버튼 → `abort()` (유지 — 사용자의 명시적 중단 동작)

**불변식**: SDK 쿼리는 사용자가 명시적으로 중단 버튼을 누를 때만 abort된다. 세션 네비게이션(전환, 생성)은 쿼리에 영향을 주지 않는다.

## 최종 검증 (02:11) ✅

3개 세션에 동시에 메시지를 보내 검증 완료:
```
02:11:48: handleChat START session=531a6151  activeSDK=0
02:11:52: handleChat START session=3041f058  activeSDK=1  ← 동시 실행
02:11:56: handleChat START session=7ef9b0e9  activeSDK=2  ← 3개 동시
02:12:00: handleChat END session=531a6151  ← 완료
02:12:00: handleChat END session=3041f058  ← 완료
02:12:06: handleChat END session=7ef9b0e9  ← 완료
```
- handleAbort 0회 — abort 단 한 번도 호출되지 않음
- 3개 세션 모두 정상 완료
- 이전 테스트 실패는 브라우저 JS 캐싱 (하드 리프레시로 해결)

## 다음 단계

1. ~~수동 테스트: 두 세션 동시 질문 → 양쪽 모두 응답 확인~~ ✅ 완료
2. 왼쪽 패널 세션 상태 표시 (active/done) 구현 검토
3. 디버그 로깅은 당분간 유지 (문제 없으면 추후 제거)
