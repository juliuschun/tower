# Proactive Agent — AI가 먼저 말을 거는 시스템

**Date**: 2026-04-12
**Status**: draft
**Origin**: heartbeat-notification Phase 2 확장 + 자율 에이전트 진화
**Depends on**: `2026-03-19-heartbeat-notification.md` (Phase 1 완료)

---

## 문제

Tower의 모든 대화는 "사용자가 먼저 말해야" 시작된다.
AI가 먼저 인사하고, 상황을 브리핑하고, 질문을 던지는 **proactive** 경험이 없다.

CronCreate(REPL 전용), RemoteTrigger(외부 클라우드)로는 Tower 세션에 메시지를
주입할 수 없다. Tower 자체 인프라로 해결해야 한다.

## 핵심 아이디어

> 서버가 세션을 만들고 → Claude를 실행해 첫 메시지를 받고 →
> 사용자에게 알림을 보낸다. 사용자가 알림을 클릭하면 세션이 열리고,
> Claude의 메시지가 이미 있다. 답장하면 일반 대화처럼 이어진다.

기존 인프라를 최대한 재사용한다:
- 세션 생성 → `session-manager.ts`의 `createSession()`
- Claude 실행 → `claude-engine.ts`의 `run()` (또는 `task-runner.ts`의 `spawnTask()`)
- 알림 전달 → `notification-hub.ts`의 `notify()`
- 실시간 푸시 → `ws-handler.ts`의 `broadcastToUser()`
- 외부 메시징 → `messaging/router.ts`의 `sendAny()`

---

## 아키텍처

### 전체 흐름

```
트리거 발동 (cron / heartbeat / task 완료 / 수동)
  │
  ▼
proactive-agent.ts :: fireProactive(userId, templateId, context)
  │
  ├─ 1. createSession(name, cwd, userId, projectId, 'claude', null, null, null, 'proactive')
  │     → sessionId 획득
  │
  ├─ 2. 프롬프트 조립
  │     template.prompt + context(진행 상황, 태스크 결과 등) 결합
  │     시스템 프롬프트: "너는 먼저 말을 거는 AI. 간결하고 자연스럽게."
  │
  ├─ 3. engine.run(sessionId, assembledPrompt, opts, callbacks)
  │     → Claude가 첫 assistant 메시지 생성
  │     → callbacks.saveMessage()로 DB 저장
  │     → engine_done 대기
  │
  ├─ 4. notify(userId, null, 'proactive', title, body, { sessionId })
  │     → NotificationBell에 표시 + WS 실시간 푸시
  │
  ├─ 5. messageRouter.sendAny(userId, title, { linkUrl, buttonTitle })
  │     → Telegram/Kakao 외부 푸시 (연결된 경우)
  │
  └─ 6. proactive_logs INSERT (추적용)
```

### 시퀀스 다이어그램

```
Trigger          ProactiveAgent      SessionMgr     ClaudeEngine    NotifHub       WS          User
  │                   │                  │               │              │           │            │
  │──fire(userId,─────▶                  │               │              │           │            │
  │   tmplId, ctx)    │                  │               │              │           │            │
  │                   │──createSession──▶│               │              │           │            │
  │                   │◀──sessionId──────│               │              │           │            │
  │                   │                  │               │              │           │            │
  │                   │──run(sessionId,──────────────────▶              │           │            │
  │                   │   prompt)        │               │              │           │            │
  │                   │                  │               │──saveMsg()──▶│           │            │
  │                   │◀──engine_done────────────────────│              │           │            │
  │                   │                  │               │              │           │            │
  │                   │──notify(userId, 'proactive',────────────────────▶           │            │
  │                   │   { sessionId }) │               │              │           │            │
  │                   │                  │               │              │──push()──▶│            │
  │                   │                  │               │              │           │──🔔 bell──▶│
  │                   │                  │               │              │           │            │
  │                   │                  │               │              │           │  click     │
  │                   │                  │               │              │           │◀───────────│
  │                   │                  │               │              │           │            │
  │                   │                  │          load session         │           │            │
  │                   │                  │          (Claude msg exists)  │           │            │
  │                   │                  │               │              │           │──session──▶│
  │                   │                  │               │              │           │            │
  │                   │                  │               │              │      user replies      │
  │                   │                  │               │              │           │◀───────────│
  │                   │                  │               │  normal chat continues   │            │
```

---

## 구현 상세

### Phase 1: 핵심 파이프라인 (이번에 구현)

#### 1-1. 새 파일: `packages/backend/services/proactive-agent.ts`

```typescript
import { createSession } from './session-manager.js';
import { notify } from './notification-hub.js';
import { ClaudeEngine } from '../engines/claude-engine.js';
import { saveMessage } from './message-store.js';
import { messageRouter } from './messaging/index.js';
import { v4 as uuidv4 } from 'uuid';
import { BroadcastFn } from '../routes/ws-handler.js';

// ── 타입 ──

export interface ProactiveTemplate {
  id: string;
  name: string;             // "모닝 브리핑", "태스크 후속"
  prompt: string;           // Claude에게 줄 시스템 프롬프트
  model?: string;           // 기본: claude-sonnet-4-6 (비용 효율)
  maxTurns?: number;        // 기본: 1 (첫 메시지만)
  projectId?: string;
}

export interface ProactiveContext {
  /** 자유 형식 맥락. 프롬프트에 {context} 자리에 삽입 */
  summary?: string;
  /** 관련 파일 경로들 (Claude에게 읽기 힌트) */
  files?: string[];
  /** 트리거 소스 메타데이터 */
  triggerMeta?: Record<string, unknown>;
}

interface FireResult {
  sessionId: string;
  notificationId: string;
}

// ── 내장 프롬프트 래퍼 ──

const SYSTEM_WRAPPER = `\
당신은 Tower AI 어시스턴트입니다. 지금 사용자에게 **먼저 말을 거는** 상황입니다.
사용자가 아직 아무 말도 하지 않았습니다.

규칙:
- 자연스럽고 친근하게 인사하세요.
- 왜 말을 걸었는지 간결하게 설명하세요.
- 구체적인 정보나 제안을 포함하세요 (빈 인사만 하지 마세요).
- 사용자가 답장하고 싶도록 열린 질문으로 끝내세요.
- 3~5문장 이내로 짧게.

---

아래는 이 메시지를 보내는 맥락입니다:

`;

// ── 핵심 함수 ──

let broadcastFn: BroadcastFn | null = null;

export function initProactiveAgent(broadcast: BroadcastFn) {
  broadcastFn = broadcast;
}

/**
 * Proactive 세션을 생성하고 Claude의 첫 메시지를 받아 알림을 보낸다.
 */
export async function fireProactive(
  userId: number,
  template: ProactiveTemplate,
  context?: ProactiveContext,
): Promise<FireResult> {
  const cwd = template.projectId
    ? `${process.env.WORKSPACE_ROOT}/projects/${template.projectId}`
    : process.env.WORKSPACE_ROOT || '/home/enterpriseai/workspace';

  // 1. 세션 생성
  const session = await createSession(
    `💬 ${template.name}`,        // 세션 이름
    cwd,
    userId,
    template.projectId || null,
    'claude',                       // engine
    null,                           // roomId
    null,                           // sourceMessageId
    null,                           // parentSessionId
    'proactive',                    // label ← 프로액티브 세션 표시
  );

  // 2. 프롬프트 조립
  const contextBlock = context?.summary || '(특별한 맥락 없음)';
  const filesBlock = context?.files?.length
    ? `\n관련 파일:\n${context.files.map(f => `- ${f}`).join('\n')}`
    : '';
  const fullPrompt = SYSTEM_WRAPPER + template.prompt + '\n\n' + contextBlock + filesBlock;

  // 3. Claude 실행 — 첫 assistant 메시지 획득
  const engine = new ClaudeEngine();
  let firstMsgPreview = '';

  const callbacks = {
    saveMessage: async (msg: any) => {
      await saveMessage(session.id, msg);
    },
    updateMessageContent: async () => {},
    updateMessageMetrics: async () => {},
    claimSessionId: async () => {},
    askUser: async () => '',
    attachToolResult: async () => {},
  };

  const opts = {
    cwd,
    model: template.model || 'claude-sonnet-4-6',
    permissionMode: 'default' as const,
    maxTurns: template.maxTurns ?? 1,
  };

  for await (const towerMsg of engine.run(session.id, fullPrompt, opts, callbacks)) {
    if (towerMsg.type === 'assistant' && !firstMsgPreview) {
      // 첫 텍스트 블록 추출 (알림 미리보기용)
      const textBlock = towerMsg.content?.find((b: any) => b.type === 'text');
      if (textBlock) {
        firstMsgPreview = textBlock.text.slice(0, 120);
      }
    }
    // engine_done까지 소비
  }

  // 4. 알림 전송
  const notificationId = await notify(
    userId,
    null,
    'proactive',
    `💬 ${template.name}`,
    firstMsgPreview || 'AI가 먼저 대화를 시작했습니다.',
    { sessionId: session.id, templateId: template.id },
  );

  // 5. 외부 메시징 (Telegram/Kakao)
  try {
    await messageRouter.sendAny(userId, `💬 ${template.name}: ${firstMsgPreview}`, {
      title: 'Tower — AI가 말을 걸었습니다',
      linkUrl: 'https://tower.moatai.app',
      buttonTitle: 'Tower 열기',
    });
  } catch {
    // 외부 메시징 실패는 무시 (알림은 이미 전달됨)
  }

  return { sessionId: session.id, notificationId };
}
```

#### 1-2. notification-hub.ts 수정

기존 유효 타입에 `proactive` 추가:

```typescript
// 기존:
// mention, task_done, task_failed, room_invite, system, heartbeat
// 추가:
// proactive
```

#### 1-3. NotificationBell.tsx 수정 — proactive 알림 클릭 시 세션 열기

현재 `session_done` 타입만 세션 네비게이션을 지원한다.
`proactive` 타입도 동일한 로직을 타도록 확장:

```typescript
// 기존: if (n.type === 'session_done' && n.metadata?.sessionId)
// 변경: if (['session_done', 'proactive'].includes(n.type) && n.metadata?.sessionId)
```

#### 1-4. useClaudeChat.ts 수정 — proactive 알림 toast

```typescript
// notification 핸들러에 추가:
else if (notif.type === 'proactive') {
  toastInfo(`💬 ${notif.title}`, { description: notif.body });
}
```

#### 1-5. 수동 테스트 API

```typescript
// api.ts에 추가
// POST /api/proactive/fire
// Body: { templateName, prompt, context?, projectId?, model? }
// → fireProactive() 호출
// 인증: admin만 허용 (초기)

router.post('/proactive/fire', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });

  const { templateName, prompt, context, projectId, model } = req.body;
  if (!templateName || !prompt) return res.status(400).json({ error: 'templateName and prompt required' });

  const template: ProactiveTemplate = {
    id: uuidv4(),
    name: templateName,
    prompt,
    model,
    projectId,
  };

  const result = await fireProactive(req.user.id, template, context ? { summary: context } : undefined);
  res.json(result);
});
```

#### 1-6. index.ts 수정 — 초기화

```typescript
// 기존 initNotificationHub 뒤에:
import { initProactiveAgent } from './services/proactive-agent.js';
initProactiveAgent(notifBroadcast);
```

### Phase 1에서 만드는 파일 / 수정하는 파일

| 작업 | 파일 | 변경 내용 |
|------|------|-----------|
| **신규** | `services/proactive-agent.ts` | 핵심 서비스 (fireProactive) |
| 수정 | `services/notification-hub.ts` | `proactive` 타입 추가 |
| 수정 | `routes/api.ts` | `POST /api/proactive/fire` API |
| 수정 | `index.ts` | `initProactiveAgent()` 호출 |
| 수정 | `NotificationBell.tsx` | proactive 클릭 → 세션 열기 |
| 수정 | `useClaudeChat.ts` | proactive toast 추가 |

---

### Phase 2: 트리거 통합 + DB 영속화

#### 2-1. DB 스키마

```sql
-- proactive_templates: 어떤 상황에서 어떤 말을 걸지
CREATE TABLE proactive_templates (
  id              TEXT PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id),
  project_id      TEXT,
  name            TEXT NOT NULL,
  prompt          TEXT NOT NULL,
  model           TEXT DEFAULT 'claude-sonnet-4-6',
  trigger_type    TEXT NOT NULL,       -- 'cron' | 'heartbeat' | 'task_event' | 'manual'
  trigger_config  TEXT,                -- JSON: { hour: 9, minute: 0, type: 'daily' } 등
  enabled         BOOLEAN DEFAULT true,
  max_turns       INTEGER DEFAULT 1,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- proactive_logs: 실행 로그 + 참여 추적
CREATE TABLE proactive_logs (
  id              TEXT PRIMARY KEY,
  template_id     TEXT REFERENCES proactive_templates(id),
  user_id         INTEGER REFERENCES users(id),
  session_id      TEXT REFERENCES sessions(id),
  notification_id TEXT,
  status          TEXT DEFAULT 'delivered',  -- delivered | opened | replied | ignored
  context_summary TEXT,                      -- 어떤 맥락으로 실행됐는지
  fired_at        TIMESTAMPTZ DEFAULT NOW(),
  opened_at       TIMESTAMPTZ,
  replied_at      TIMESTAMPTZ
);
```

#### 2-2. task-scheduler.ts 통합

기존 task-scheduler의 `tick()`에 proactive_templates 체크를 추가:

```typescript
async function tick() {
  // 기존: tasks 테이블 체크
  // 추가: proactive_templates 중 trigger_type = 'cron'이고 enabled = true인 것 체크
  const dueTemplates = await query(`
    SELECT * FROM proactive_templates
    WHERE enabled = true AND trigger_type = 'cron'
    -- + schedule 매칭 로직
  `);

  for (const tmpl of dueTemplates) {
    const users = await getTemplateTargetUsers(tmpl);  // user_id 또는 프로젝트 멤버
    for (const userId of users) {
      await fireProactive(userId, tmpl, { summary: '스케줄된 실행' });
    }
  }
}
```

#### 2-3. heartbeat.ts 통합

L1에서 Room에 게시하는 대신, proactive 세션을 생성하도록 옵션 추가:

```typescript
// heartbeat.ts - L1 모드에서 proactive 호출
if (config.proactiveEnabled && newLines >= threshold) {
  const template = {
    id: `heartbeat-${config.projectId}`,
    name: `🫀 ${config.projectName} 진화 알림`,
    prompt: `프로젝트 "${config.projectName}"에 새로운 진전이 있었습니다:\n${deltaContent}`,
    projectId: config.projectId,
  };
  await fireProactive(targetUserId, template, { summary: deltaContent });
}
```

#### 2-4. 프론트엔드 설정 UI

Settings 또는 NotificationBell 드롭다운에 "Proactive Agent" 탭:

- 템플릿 목록 (이름, 트리거, 마지막 실행, 토글)
- 템플릿 추가 폼 (이름, 프롬프트, 스케줄 타입, 프로젝트)
- 실행 로그 (언제 실행됐고, 사용자가 열었는지)

---

### Phase 3: 고도화

#### 3-1. 스마트 타이밍

사용자의 Tower 접속 패턴을 분석해 **활동 중일 때만** 알림 발송:

```typescript
// 예: 최근 7일간 접속 시간대 분석
// → 주로 9-12시, 14-18시에 접속
// → 그 시간대에만 proactive 실행
```

#### 3-2. 대화 품질 피드백

Proactive 세션에 "이 대화가 도움이 되었나요? 👍 👎" 위젯 추가.
feedback 기반으로 프롬프트 자동 개선 (meta-learning).

#### 3-3. 다자 Proactive (Room)

개인 세션이 아닌 Room에 Claude가 먼저 메시지를 보내는 시나리오:
- 매일 아침 팀 채널에 데일리 브리핑
- 프로젝트 마일스톤 달성 시 축하 메시지

#### 3-4. 연쇄 Proactive

첫 proactive 메시지에 사용자가 응답하지 않으면,
일정 시간 후 다른 채널(Telegram)로 팔로업.
응답하면 즉시 연쇄 중단.

---

## 설계 결정

### D1. 기존 세션에 주입 vs 새 세션 생성

**결정: 둘 다 지원 (기본값은 새 세션)**

`fireProactive()`에 `targetSessionId` 옵션을 받는다.

| 옵션 | 사용 시점 | 구현 |
|------|-----------|------|
| **새 세션 생성** (기본) | 브리핑, 정기 알림 등 독립적 대화 | `createSession()` → `engine.run()` |
| **기존 세션 주입** | 후속 질문, 태스크 결과 전달 등 맥락 연속 | 기존 `claudeSessionId`로 resume → `engine.run()` |

기존 세션 주입 시 주의점:
- `getSession(targetSessionId)`로 `claudeSessionId` 확인 (resume용)
- 세션이 현재 streaming 중이면 abort하지 않고 대기 or 스킵
- 프롬프트에 "[시스템 자동 메시지]" 접두사로 사용자에게 맥락 표시

### D2. Claude 실행 방식 — engine.run() 직접 vs spawnTask()

**결정: engine.run() 직접 호출 (Phase 1), spawnTask() 래핑 검토 (Phase 2)**

- `spawnTask()`는 task DB + 칸반 보드 연동 포함 → 오버헤드
- Phase 1에서는 가볍게 engine.run()만 호출
- Phase 2에서 스케줄 + 로그 필요하면 spawnTask() 래핑 고려

### D3. 프롬프트 모델 — sonnet vs haiku

**결정: sonnet (기본값), 템플릿별 override 가능**

- Proactive 메시지는 "첫인상" → 품질이 중요
- 비용은 1턴이라 미미 (input ~2K, output ~200 토큰)
- Heartbeat 등 빈도 높은 트리거는 haiku로 override 가능

### D4. 알림 타입 — 기존 타입 재사용 vs 전용 타입

**결정: 전용 `proactive` 타입 신설**

- 기존 `system`이나 `heartbeat`에 끼워넣으면 필터링 불가
- 사용자가 proactive 알림만 끄고 싶을 수 있음
- 클릭 시 세션 열기 동작이 다른 타입과 다름

### D5. 실패 처리

- Claude 실행 실패 → 세션 삭제, 알림 미발송, 에러 로그만
- 알림 발송 실패 → 세션은 유지 (수동 접근 가능), 에러 로그
- 외부 메시징 실패 → 무시 (인앱 알림이 primary)

---

## 리스크 및 완화

| 리스크 | 심각도 | 완화 |
|--------|--------|------|
| Claude 실행 비용 누적 | 중 | 일 최대 실행 횟수 제한 (기본 5회/일) |
| 사용자가 알림을 스팸으로 느낌 | 높 | Opt-in, 빈도 제한, DND 시간대 |
| Claude가 무의미한 인사만 함 | 중 | 프롬프트 품질 관리, 맥락 필수 주입 |
| 동시 다발 실행 시 서버 부하 | 중 | 큐잉 + 순차 실행 (Phase 2) |
| dev 서버 재시작 중 실행 충돌 | 낮 | engine_done 대기 + graceful abort |

---

## 시연 시나리오 (Phase 1 완료 후)

1. `POST /api/proactive/fire` 호출:
   ```json
   {
     "templateName": "인사 테스트",
     "prompt": "사용자에게 오후 인사를 하면서, 오늘 뭘 도와줄 수 있을지 물어봐.",
     "context": "현재 시각은 오후 4시, 일요일이다."
   }
   ```
2. 서버가 세션 생성 → Claude 실행 → 첫 메시지 생성
3. 🔔 벨 알림 + toast 표시: "💬 인사 테스트"
4. 사용자가 클릭 → 세션 열림 → Claude의 메시지가 보임
5. 사용자가 답장 → 일반 대화 계속

---

## 참고

- Heartbeat 설계: `docs/plans/2026-03-19-heartbeat-notification.md`
- 스트리밍 아키텍처: `2026-04-11-streaming-ws-dedup.md`
- Notification DB: `packages/backend/db/migrations/004_notifications.sql`
- Session DB: `packages/backend/db/migrations/008_sessions.sql`
- 유효 notif_type 확장: mention, task_done, task_failed, room_invite, system, heartbeat, **proactive**
