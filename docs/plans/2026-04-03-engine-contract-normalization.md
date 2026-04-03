# Engine Contract Normalization Plan

> Date: 2026-04-03
> Status: Phase 1 + Phase 3 완료 (2026-04-03)
> Problem: Claude SDK와 Pi Coding Agent가 같은 Engine 인터페이스를 구현하지만, 프론트엔드에 전달하는 이벤트의 **완성도**가 다르다. 사용자가 엔진 차이를 느끼면 안 되는데 현재는 느낀다.

## 진단: 아키텍처 재설계 필요 여부

**결론: 전면 재설계 불필요. 타겟 정규화로 해결 가능.**

Engine 인터페이스(`types.ts`)와 TowerMessage 타입 시스템은 이미 잘 설계되어 있다.
문제는 **Pi 엔진이 약속한 이벤트를 덜 보내는 것** — 아키텍처 결함이 아니라 구현 완성도 차이.

```
현재 상태:
  Engine Interface (types.ts) ← 잘 정의됨
     ├── ClaudeEngine: 계약 95% 이행
     └── PiEngine: 계약 ~70% 이행 ← 여기가 문제
```

## 격차 목록

### 🔴 P0 — 사용자 경험 직접 영향

| # | 격차 | Claude | Pi | 영향 |
|---|------|--------|-----|------|
| G1 | tool_result 미broadcast | 별도 TowerToolResultMsg yield | DB 저장만, broadcast 안함 | Pi에서 도구 실행 결과 피드백 없음 |
| G2 | Context window 메트릭 부재 | contextInputTokens, contextWindowSize 제공 | 항상 0 | TurnMetricsBar 컨텍스트 % 부정확 |
| G3 | 세션 복원 실패 무경고 | engine_error + claimSessionId('') | console.warn만 | 사용자가 대화 끊김을 인지 못함 |

### 🟡 P1 — 기능 비대칭 (정보 표시 차이)

| # | 격차 | Claude | Pi | 영향 |
|---|------|--------|-----|------|
| G4 | costUsd 비대칭 | undefined (구독) | 항상 계산됨 | 프론트에서 비용 표시 일관성 없음 |
| G5 | numIterations 미제공 | SDK iterations 추적 | 미추적 | 멀티턴 도구 사용 횟수 안 보임 |
| G6 | Compaction 미지원 | autocompact + UI | 없음 | Pi 긴 세션에서 컨텍스트 넘침 |

### 🟢 P2 — 의도적 비대칭 (수용 가능)

| # | 격차 | 설명 | 이유 |
|---|------|------|------|
| G7 | 모델 핫스왑 | Pi만 mid-session 전환 지원 | SDK 설계 차이 (의도적) |
| G8 | 프로세스 복구 | Claude=외부 프로세스 / Pi=인메모리 | 런타임 아키텍처 차이 (수용) |

---

## Phase 1: Pi 이벤트 정규화 (P0)

### G1 Fix: Pi tool_result broadcast

**현재**: `tool_execution_end` → `callbacks.attachToolResult()` (DB만)
**목표**: tool_result도 TowerMessage로 yield하여 프론트에서 도구 결과 표시

```
파일: packages/backend/engines/pi-engine.ts
위치: subscribe() → case 'tool_execution_end' (line 201)
```

**변경사항:**
```typescript
case 'tool_execution_end': {
  const resultContent = event.result?.content;
  const resultText = Array.isArray(resultContent)
    ? resultContent.map((c: any) => c.text || '').join('\n')
    : JSON.stringify(event.result);

  if (event.toolCallId) {
    callbacks.attachToolResult(event.toolCallId, resultText);
  }

  // ★ NEW: Broadcast tool result so frontend can update ToolChip
  if (event.toolCallId) {
    eventQueue.push({
      type: 'tool_result',          // ← 새로 추가
      sessionId,
      msgId,                         // 현재 assistant message ID
      toolCallId: event.toolCallId,
      toolName: event.toolName || '',
      result: resultText,
      isError: event.result?.isError || false,
    } satisfies TowerToolResultMsg);   // ← 타입 임포트 필요
  }

  // ... editedFiles tracking (기존)
  resolveWait?.();
  break;
}
```

**ws-handler 영향**: `towerToLegacy()` 함수가 이미 `tool_result` 타입을 `tool_result_attached`로 변환하는 분기가 있어야 한다. 현재 ws-handler line 933에서 Claude의 callback으로 직접 broadcast하고 있는데, Pi는 TowerMessage yield 경로를 탈 것이므로 `towerToLegacy()`에 `tool_result` → legacy 변환 추가 필요.

**프론트엔드 영향**: 기존 `tool_result_attached` 핸들러가 이미 `useClaudeChat.ts`에 있으므로, ws-handler에서 동일 형태로 broadcast하면 프론트 변경 불필요.

### G2 Fix: Pi usage에 context 메트릭 추가

**현재**: Pi `message_end`에서 `usage.input`, `usage.output`만 수집
**목표**: Pi SDK가 제공하는 만큼 context 정보 추출. 없으면 추정값 사용.

```
파일: packages/backend/engines/pi-engine.ts
위치: message_end handler (line 223) + promptPromise.then() (line 258)
```

**접근:**
1. Pi SDK의 `message_end.message.usage`에서 사용 가능한 필드 확인
2. Pi가 context window 정보를 줄 수 없으면, `pi-models.json`의 `contextWindow` 값을 static으로 넘기기
3. `numIterations`: prompt 내에서 message_end가 여러 번 올 수 있음 → 카운터 추가

```typescript
// 추가할 상태 변수
let iterationCount = 0;
let cumulativeInput = 0;
let cumulativeOutput = 0;

// message_end에서:
iterationCount++;
cumulativeInput += usage.input || 0;
cumulativeOutput += usage.output || 0;

// promptPromise.then()에서 turn_done emit 시:
pendingTurnUsage = {
  inputTokens: cumulativeInput,
  outputTokens: cumulativeOutput,
  costUsd: lastCostUsd,
  durationMs: Date.now() - turnStartTime,
  stopReason,
  // ★ Context tracking
  contextInputTokens: lastIterationInput,  // 마지막 iteration의 input
  contextOutputTokens: lastIterationOutput,
  contextWindowSize: currentModel?.contextWindow || 200_000,
  numIterations: iterationCount,
};
```

### G3 Fix: Pi 세션 복원 실패 알림

**현재**: `console.warn` 후 새 세션 생성 (사용자 모름)
**목표**: 프론트에 `engine_error(recoverable: true)` yield

```
파일: packages/backend/engines/pi-engine.ts
위치: createSession() 내 resume 실패 catch (line 428)
```

**변경사항:**
```typescript
} catch (err: any) {
  console.warn(`[Pi] Resume failed (${err.message}), creating new session`);
  sessionMgr = SessionManager.create(opts.cwd, piSessionDir);
  // ★ NEW: Clear stale session ID + notify
  callbacks?.claimSessionId('');
  // Note: engine_error는 run()에서만 yield 가능 → createSession은 플래그만 세팅
  this._resumeFailedMessage = `Previous Pi conversation could not be restored: ${err.message}`;
}
```

그리고 `run()` 시작부에서:
```typescript
if (this._resumeFailedMessage) {
  yield {
    type: 'engine_error',
    sessionId,
    message: this._resumeFailedMessage,
    recoverable: true,
  };
  this._resumeFailedMessage = null;
}
```

---

## Phase 2: 프론트엔드 engine-aware 표시

### G4 Fix: 비용 표시 정규화

**현재 문제**: Claude는 costUsd가 없고(구독), Pi는 항상 있음.
TurnMetricsBar가 costUsd를 보여주면 Claude 세션은 비용 0, Pi 세션은 비용 표시 → 사용자 혼란.

**방안 A (권장)**: 세션의 engine 타입에 따라 비용 표시 분기
- Claude 세션: 비용 숨김 (또는 "Subscription" 라벨)
- Pi 세션: 비용 표시

**구현**: SessionMeta에 이미 `engine?: string` 필드가 있으므로 프론트에서 분기 가능.

```
파일: packages/frontend/src/components/chat/MessageBubble.tsx
위치: TurnMetricsBar 컴포넌트
```

```typescript
// useSessionStore에서 현재 세션의 engine 타입 가져오기
const engine = useSessionStore((s) => {
  const session = s.sessions.find(ses => ses.id === s.activeSessionId);
  return session?.engine || 'claude';
});

// 비용 표시 분기
const showCost = engine !== 'claude'; // Claude Max는 비용 의미 없음
```

### G5 Fix: numIterations 표시

Phase 1의 G2에서 Pi가 numIterations를 제공하면 자동 해결.
프론트에서 추가 변경 없음 (TurnMetricsBar가 이미 numIterations 표시 로직 보유).

### G6: Compaction은 수용

Pi SDK가 자체 compaction을 지원 (`settingsManager: { compaction: { enabled: true } }`).
다만 Pi의 compaction은 SDK 내부 처리 → Tower UI에 피드백 없음.
이건 Pi SDK 한계이므로 당장은 수용. 향후 Pi SDK가 이벤트를 노출하면 연동.

---

## Phase 3: Engine Contract 문서화 + 테스트

### 3-1. types.ts에 필수/선택 명시

```typescript
export interface TowerUsage {
  // ── REQUIRED: 모든 엔진 필수 ──
  inputTokens: number;       // @required
  outputTokens: number;      // @required
  durationMs: number;        // @required

  // ── RECOMMENDED: 가능하면 제공 ──
  costUsd?: number;                // Pi: 제공, Claude: undefined (구독)
  stopReason?: string;
  contextInputTokens?: number;     // 마지막 iteration input
  contextOutputTokens?: number;
  contextWindowSize?: number;      // 모델 context window
  numIterations?: number;

  // ── OPTIONAL: 엔진별 특성 ──
  cacheReadTokens?: number;        // Claude 전용
  cacheCreationTokens?: number;    // Claude 전용
}
```

### 3-2. Engine Compliance 테스트

```
파일: packages/shared/__tests__/engine-contract.test.ts (신규)
```

각 엔진이 정해진 이벤트 시퀀스를 지키는지 source contract 테스트:

```typescript
describe('Engine contract compliance', () => {
  it('Pi engine emits tool_result TowerMessage after tool_execution_end', () => {
    const src = readSource('packages/backend/engines/pi-engine.ts');
    expect(src).toMatch(/tool_execution_end[\s\S]*?type:\s*['"]tool_result['"]/);
  });

  it('both engines emit engine_done with engineSessionId', () => {
    for (const file of [CLAUDE_PATH, PI_PATH]) {
      const src = readSource(file);
      expect(src).toMatch(/type:\s*['"]engine_done['"][\s\S]*?engineSessionId/);
    }
  });

  it('Pi engine includes context metrics in turn_done', () => {
    const src = readSource('packages/backend/engines/pi-engine.ts');
    expect(src).toMatch(/contextInputTokens/);
    expect(src).toMatch(/contextWindowSize/);
    expect(src).toMatch(/numIterations/);
  });
});
```

---

## 실행 순서

```
Phase 1 (백엔드 정규화) ─ 작업량: ~2시간
  ├── G1: Pi tool_result emit + ws-handler legacy 변환
  ├── G2: Pi usage context 메트릭 추가
  └── G3: Pi 세션 복원 실패 알림

Phase 2 (프론트 정리) ─ 작업량: ~1시간
  ├── G4: 비용 표시 engine-aware 분기
  └── G5: numIterations 자동 해결 (Phase 1 의존)

Phase 3 (문서화 + 테스트) ─ 작업량: ~1시간
  ├── types.ts 주석 보강
  └── engine-contract.test.ts 추가
```

## 변경하지 않는 것 (의도적)

- **Engine 인터페이스 자체** — 현재 설계 유지
- **모델 핫스왑 비대칭** — Pi 전용 기능으로 수용
- **프로세스 모델 차이** — Claude=외부 프로세스, Pi=인메모리 (런타임 특성)
- **Compaction UI** — Pi SDK가 이벤트 미노출 → 향후 대응

## 성공 기준

1. Pi 세션에서 도구 실행 시 ToolChip에 결과 체크마크 표시됨
2. Pi 세션 TurnMetricsBar에 context % 표시됨 (추정치라도)
3. Pi 세션 복원 실패 시 사용자에게 토스트 알림
4. Claude/Pi 세션 전환 시 비용 표시가 자연스러움
5. engine-contract.test.ts 전부 통과
