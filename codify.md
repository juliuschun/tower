# Claude Code 원격 웹 접속 가이드

## 개요

원격 서버에서 Claude Code를 돌리고 브라우저로 접속하는 방법을 정리.

---

## 방법 1: ttyd (터미널 웹 노출 — 가장 안정적)

서버 터미널을 그대로 브라우저에 보여주는 범용 도구. Claude Code 전용이 아님.

### 설치
```bash
sudo apt-get install -y ttyd
```

### 실행
```bash
# CLAUDECODE 환경변수 제거 필수 (Claude Code 세션 안에서 실행할 경우)
env -i HOME=$HOME PATH=$PATH USER=$USER SHELL=$SHELL TERM=xterm-256color \
  ttyd --writable --port 32352 --credential user:비밀번호 bash
```

### 접속
로컬에서 SSH 터널:
```bash
ssh -L 32352:localhost:32352 azureuser@4.230.33.35
```
브라우저: http://localhost:32352 → 로그인 후 `claude` 입력

### 특징
- 진짜 터미널 그대로 (풀 컬러, 키보드 단축키)
- 단순하고 안정적
- 별도의 UI 없음

---

## 방법 2: claude-code-web (전용 웹 터미널 UI)

Claude Code 전용 웹 인터페이스. 멀티 세션, 탭 관리, ngrok 내장.

### 실행
```bash
# CLAUDECODE 환경변수가 있으면 중첩 세션 에러 발생
# env -i 로 깨끗한 환경에서 실행해야 함
nohup env -i HOME=$HOME PATH=$PATH USER=$USER SHELL=$SHELL TERM=xterm-256color \
  npx claude-code-web --port 32352 --no-open > /tmp/claude-code-web.log 2>&1 &
```

### 접속
- SSH 터널 후 http://localhost:32352
- 자동 생성된 토큰으로 인증 (로그에서 확인)
- ngrok 내장: `--ngrok-auth-token YOUR_TOKEN` 옵션으로 공개 URL 생성 가능

### 주요 옵션
```
--port <number>         포트 (기본: 32352)
--auth <token>          인증 토큰 직접 지정
--disable-auth          인증 비활성화
--https                 HTTPS 활성화
--ngrok-auth-token      ngrok 터널 자동 생성
--plan <type>           구독 플랜 (pro, max5, max20)
```

### 특징
- 여러 세션 동시 관리 (탭으로 전환)
- 세션 끊겨도 자동 복구
- VS Code 스타일 분할 뷰
- 인증 & HTTPS 내장

---

## 방법 3: claude-code-webui (채팅 스타일 UI, SDK 방식)

Claude Code SDK를 사용하는 채팅형 웹 UI. 터미널이 아닌 ChatGPT 같은 인터페이스.

### 실행
```bash
nohup env -i HOME=$HOME PATH=$PATH USER=$USER SHELL=$SHELL TERM=xterm-256color \
  npx claude-code-webui --port 32353 --claude-path /home/azureuser/.local/bin/claude \
  > /tmp/claude-code-webui.log 2>&1 &
```

### 접속
- SSH 터널 후 http://localhost:32353
- 인증 없음

### 주요 옵션
```
--port <port>           포트 (기본: 8080)
--host <host>           바인딩 주소 (0.0.0.0이면 외부 접속 가능)
--claude-path <path>    claude 실행파일 경로 직접 지정
```

### 특징
- ChatGPT 같은 채팅 UI
- 대화 히스토리 탐색
- 프로젝트 폴더 선택 UI
- 다크/라이트 테마
- SDK 방식이라 API 키 기반 사용에 유리

---

## 방법 4: Anthropic 공식 "Claude Code on the Web"

Anthropic이 제공하는 공식 웹 서비스. 네 서버가 아닌 Anthropic 클라우드에서 실행.

### 사용법
- 브라우저: https://claude.ai/code
- CLI에서 원격 작업 전송: `claude --remote "task description"`
- 웹 세션을 터미널로 가져오기: `claude --teleport`
- 세션 중 백그라운드 작업: `& fix the auth bug`

### 특징
- GitHub 연동 필수
- Anthropic 인프라에서 실행 (네 서버 아님)
- Pro, Max, Team, Enterprise 사용자

---

## 방법 5: Claude Desk (자체 플랫폼 — SDK 기반 채팅 UI)

리서치/분석 팀용 자체 웹 플랫폼. SDK 기반 채팅 + 파일 편집 + MD 렌더링.

### 서버 관리 (PM2 통일)
```bash
cd /home/azureuser/tunnelingcc/claude-desk

# 시작 (빌드 포함)
./start.sh start        # 또는 npm start

# 빌드 + 재시작
./start.sh restart      # 또는 npm run restart

# 중지 / 로그 / 상태
./start.sh stop
./start.sh logs
./start.sh status
```

> **주의:** `npx tsx backend/index.ts` 직접 실행 금지.
> PM2와 포트 충돌하여 EADDRINUSE 크래시 루프 발생.

환경변수는 `ecosystem.config.cjs`에 선언되어 있음 (PORT, DEFAULT_CWD, WORKSPACE_ROOT 등).

### 접속
```bash
ssh -L 32354:localhost:32354 azureuser@4.230.33.35
# 브라우저: http://localhost:32354
# 인증: admin / admin123
```

### 아키텍처
```
브라우저 ←WebSocket→ Express(32354) ←SDK query()→ Claude CLI 바이너리
```

### 특징
- ChatGPT 스타일 채팅 UI + 마크다운 렌더링
- SDK `query()` 비동기 제너레이터로 스트리밍
- 도구 사용 카드 (Bash, Read, Write, Edit 등 시각화)
- 세션 관리 (SQLite), 세션 resume 지원
- 파일 트리 + 에디터 + MD 미리보기
- 메시지 큐 (스트리밍 중 다음 메시지 미리 입력)
- 슬래시 명령어 드롭다운
- JWT 인증 (비활성화 가능)

---

## Claude Code SDK 사용 핵심 교훈

### 1. CLAUDECODE 환경변수 반드시 제거
```ts
// 서버 엔트리 최상단에서
delete process.env.CLAUDECODE;
```
SDK가 내부적으로 Claude CLI를 spawn할 때, 부모 프로세스의 CLAUDECODE=1을 상속하면
"Cannot be launched inside another Claude Code session" 에러 발생.

### 2. SDK 메시지 플로우 (매 턴마다 반복)
```
system/init → assistant(tool_use) → rate_limit_event → user(tool_result) → assistant(text) → result → [done]
```
- `system/init`은 첫 턴만이 아니라 **매 턴마다** 재전송됨. 프론트엔드가 중복 초기화하지 않도록 주의.
- `rate_limit_event`의 실제 구조: `msg.data.rate_limit_info.status` (중첩 구조)
- tool 결과는 `user` 타입 메시지의 `tool_result` 블록으로 옴 (별도의 `tool_use_result` 필드도 있음)

### 3. SDK query() 옵션
```ts
// 신 SDK: @anthropic-ai/claude-agent-sdk (v0.2.50+)
import { query } from '@anthropic-ai/claude-agent-sdk';

const response = query({
  prompt: processedPrompt,
  options: {
    abortController,
    executable: 'node',
    executableArgs: [],
    pathToClaudeCodeExecutable: '/home/azureuser/.local/bin/claude',
    cwd: '/home/azureuser',
    permissionMode: 'bypassPermissions',
    settingSources: ['user', 'project'],  // Skills + CLAUDE.md 로딩에 필수!
    resume: sessionId, // 세션 이어하기
  },
});
```
- `resume`에 `session_id` (system init 메시지에서 획득)를 넣으면 세션 이어하기
- 슬래시 명령어: 앞의 `/`를 떼고 prompt로 전달하면 SDK가 처리
- `settingSources`: 미설정 시 `~/.claude/skills/`, `.claude/settings.json`, `CLAUDE.md` 로드 안 됨 (SDK 격리 모드)

### 4. WebSocket 프로토콜 설계 팁
- 클라이언트→서버: `{ type, ...payload }` 패턴
- SDK 메시지 래핑: `{ type: 'sdk_message', sessionId, data: sdkMessage }`
- 완료 시그널: `{ type: 'sdk_done', claudeSessionId }` — 프론트엔드가 스트리밍 상태 해제
- ping/pong: 30초 간격으로 연결 유지

### 5. 파일 시스템 보안
경로 검증 필수: `path.resolve(target).startsWith(path.resolve(root))`
- `/etc/passwd` 같은 외부 경로 접근 차단
- `.git`, `node_modules` 등 숨김 패턴 필터링

---

## Phase 2 교훈: 파일 시스템 + 세션 UX

### 1. WS 인증 — 토큰 전달 필수
프론트엔드에서 WebSocket 연결 시 `localStorage`의 JWT 토큰을 쿼리 파라미터로 전달해야 함:
```ts
const wsUrl = token ? `${wsBase}?token=${encodeURIComponent(token)}` : wsBase;
```
Phase 1에서 auth 없이 개발하다가 Phase 2에서 auth 활성화하면서 WS 401 에러 발생.

### 2. chokidar ignored 패턴 — 정확한 glob 사용
```ts
ignored: ['**/node_modules/**', '**/.git/**', '**/.claude/**', '**/.claude.json*']
```
- `.claude/` 디렉토리가 계속 변경되어 대량의 노이즈 이벤트 발생
- `depth: 3` + `ignoreInitial: true` 로 초기 로드 부하 제거

### 3. 서브디렉토리 lazy loading — 루트 vs 자식 구분
파일 트리 응답이 루트인지 서브디렉토리인지 판별 필요:
```ts
// 잘못된 방법 (항상 true):
currentTree.some(e => data.path !== e.path)

// 올바른 방법 — 재귀 탐색:
const findInTree = (entries, p) => {
  for (const e of entries) {
    if (e.path === p && e.isDirectory) return true;
    if (e.children && findInTree(e.children, p)) return true;
  }
  return false;
};
```

### 4. 세션 ID 이원화 문제
- `session-store.activeSessionId`: DB 세션 (사이드바 표시용)
- `chat-store.sessionId`: WS 채팅용 (서버에 전달되는 ID)
- `chat-store.claudeSessionId`: Claude SDK 내부 세션 (resume용)

이 3개가 동기화되지 않으면 세션 전환이 안 됨.
**핵심**: `handleSelectSession`에서 3개 모두 업데이트해야 함.

### 5. claudeSessionId는 connection-scoped가 아닌 session-scoped로
백엔드에서 `client.claudeSessionId`를 WS 연결 전체에 하나만 저장하면,
세션 A → B → A 전환 시 세션 B의 claudeSessionId로 resume 시도.
**해결**: 프론트에서 매 chat 메시지에 `claudeSessionId`를 같이 보냄:
```ts
send({ type: 'chat', message, sessionId, claudeSessionId, cwd });
```
백엔드: `const resumeSessionId = data.claudeSessionId || client.claudeSessionId;`

---

## Phase 3 교훈: 메시지 영속화 + DB 마이그레이션

### 1. DB 저장 vs SDK jsonl 파싱 — 설계 선택
메시지 영속화에 두 가지 접근법:
- **DB 저장 (채택)**: ws-handler에서 실시간 `saveMessage()`, 세션 전환 시 `SELECT`로 복원
- **SDK jsonl 파싱 (미채택)**: `~/.claude/projects/` jsonl을 역파싱

DB 방식 이유: SDK jsonl은 내부 스트리밍 포맷이라 구조 불안정. DB는 이미 파싱된 상태로 저장하니 복원이 단순.
트레이드오프: DB 테이블 부재 시 저장 자체가 안 됨 (try/catch 무시). SDK는 `resume: sessionId`로 대화 연속성 관리하므로 DB는 순수 UI 복원용.

### 2. CREATE TABLE IF NOT EXISTS가 적용 안 되는 경우
`initSchema()`에 `CREATE TABLE IF NOT EXISTS`를 넣어도 기존 DB에 반영 안 될 수 있음:
- 원인: `getDb()` 싱글턴이 이미 생성된 상태에서 DB 파일에 변경 없음
- 서버 재시작으로 `initSchema()` 재실행 필요
- **교훈**: DB 스키마 변경 후 반드시 서버 재시작 확인. `try {} catch {}`로 에러 무시하면 테이블 부재를 감지 못 함

### 3. ToolUseCard 칩 레이아웃 — 스크롤 절약
도구 사용이 많을 때 full-width 카드가 세로로 쌓이면 스크롤 폭증.
가로 칩(chip) + 클릭 시 세로 펼침 방식이 정보 밀도/접근성 모두 우수.
`ToolChip`은 export하여 `MessageBubble`의 `ToolChipGroup`에서 사용.

---

## Phase 5 교훈: 모델 셀렉터 + 세션 인텔리전스

### 1. SDK Options.model — 직접 지원 확인법
SDK `sdk.d.ts`에서 Options 타입을 직접 확인:
```ts
export type Options = {
  model?: string;  // ← 있음!
  // ...
};
```
환경변수 `ANTHROPIC_MODEL` 우회가 필요한지 먼저 타입 체크. SDK v2.1.50 기준 `model`은 직접 지원됨.

### 2. SDK Query 인터페이스 — 런타임 모델 변경도 가능
```ts
export interface Query extends AsyncGenerator<SDKMessage, void> {
  setModel(model?: string): Promise<void>;
  supportedModels(): Promise<ModelInfo[]>;
  // ...
}
```
`query.setModel()`, `query.supportedModels()`로 런타임에 모델 목록 조회/변경 가능.
다만 매 메시지마다 새 query를 시작하므로 Options.model로 설정하는 게 더 간단.

### 3. MAX 환경에서 Haiku 호출 — SDK query()로 우회
ANTHROPIC_API_KEY 없이 직접 `@anthropic-ai/sdk` 호출 불가.
Claude Code SDK `query()`에 `model: 'claude-haiku-4-5-20251001'`을 넣으면
MAX 구독 크레딧으로 Haiku 모델 사용 가능. 경량 프롬프트(이름 생성, 요약)에 적합.
```ts
query({
  prompt: '제목을 15자 내외로 생성해...',
  options: { model: 'claude-haiku-4-5-20251001', maxTurns: 1 }
});
```
주의: `maxTurns: 1`로 도구 사용 없이 한 턴에 끝나게 해야 비용 절약.

### 4. SQLite ALTER TABLE 멱등성 — try/catch 패턴
```ts
const migrations = [
  `ALTER TABLE sessions ADD COLUMN model_used TEXT`,
  `ALTER TABLE sessions ADD COLUMN turn_count INTEGER DEFAULT 0`,
];
for (const sql of migrations) {
  try { db.exec(sql); } catch {} // 이미 존재하면 무시
}
```
better-sqlite3는 `IF NOT EXISTS`를 ALTER TABLE에서 지원 안 함.
컬럼이 이미 있으면 "duplicate column" 에러 발생 → try/catch로 무시.

### 5. 프론트 auto-trigger 타이밍 — sdk_done에서
자동 이름 생성처럼 "첫 응답 완료 후" 실행해야 하는 작업은 `sdk_done` 핸들러에서:
```ts
case 'sdk_done':
  // ... claudeSessionId 저장 ...
  // 세션 이름이 기본값이면 auto-name 호출
  if (isDefaultName && hasUserMsg && hasAssistantMsg) {
    fetch(`/api/sessions/${activeId}/auto-name`, { method: 'POST' })
  }
```
주의: `sdk_done`은 매 턴마다 발생. 조건 체크(기본 이름인지, 메시지 존재하는지)로 중복 호출 방지.

---

## Phase 4D 교훈: 드래그 앤 드롭 + 가상 경로 저장

### 1. HTML5 Drag & Drop — dragCounter 패턴
`onDragEnter`/`onDragLeave`는 자식 요소 진입/이탈마다 발생.
단순 boolean 토글이면 자식 진입 시 false로 돌아감.
```ts
const dragCounter = useRef(0);
const handleDragEnter = () => { dragCounter.current++; setIsDragOver(true); };
const handleDragLeave = () => { dragCounter.current--; if (dragCounter.current === 0) setIsDragOver(false); };
const handleDrop = () => { dragCounter.current = 0; setIsDragOver(false); };
```

### 2. dataTransfer 커스텀 MIME 타입
`application/x-attachment`처럼 커스텀 MIME으로 앱 내부 데이터 전달:
```ts
// 드래그 소스
e.dataTransfer.setData('application/x-attachment', JSON.stringify({ type, label, content }));
// 드롭 타겟
const raw = e.dataTransfer.getData('application/x-attachment');
```
표준 MIME(text/plain 등)과 충돌 없음.

### 3. 가상 경로 저장 — `prompt:제목` 패턴 함정
ContextPanel에서 프롬프트를 `prompt:제목` 가상 경로로 열면, "저장" 클릭 시 파일 시스템 API로 전달됨.
`handleSaveFile`에서 가상 경로 프리픽스를 감지하여 적절한 store 업데이트 필요:
```ts
if (path.startsWith('prompt:')) {
  // prompt store + API PATCH → 파일 시스템이 아닌 DB 저장
  return;
}
saveFile(path, content); // 일반 파일
```

### 4. SDK systemPrompt — 경량 프롬프트에 필수
auto-namer/summarizer 같은 경량 작업에서 Claude Code 기본 시스템 프롬프트("You are Claude Code...")가 포함되면 불필요한 도구 사용 시도.
`systemPrompt` + `disallowedTools`로 순수 텍스트 생성 강제:
```ts
// 신 SDK (@anthropic-ai/claude-agent-sdk)
query({ prompt, options: {
  systemPrompt: '너는 요약기다. 도구를 사용하지 마.',
  disallowedTools: ['Bash', 'Read', 'Write', ...],
  maxTurns: 1,
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,  // 신 SDK에서 필수
}});
```
**주의**: 구 SDK(`@anthropic-ai/claude-code`)의 `customSystemPrompt`는 신 SDK에서 `systemPrompt`로 변경됨.

---

## Phase 6A 교훈: WS 세션 복원력 (Session Resilience)

### 1. sendToSession 간접 전송 패턴
WS 직접 전송(`send(client.ws, data)`)은 연결 끊기면 끝. 세션 기반 간접 전송으로 교체:
```ts
const sessionClients = new Map<string, string>(); // sessionId → clientId

function sendToSession(sessionId: string, data: any) {
  const clientId = sessionClients.get(sessionId);
  if (!clientId) return;
  const c = clients.get(clientId);
  if (c && c.ws.readyState === WebSocket.OPEN) {
    c.ws.send(JSON.stringify(data));
  }
}
```
재연결 시 새 클라이언트가 맵에 등록되면 SDK for-await 루프가 자동으로 새 WS로 전달.

### 2. serverEpoch — 서버 재시작 감지
서버 시작 시 `Date.now().toString(36) + Math.random().toString(36).slice(2,6)` 생성.
프론트에서 이전 epoch과 비교하면 단순 WS 재연결 vs 서버 리부트 구분 가능.

### 3. WS close 시 sessionClients 정리 조건
SDK가 실행 중이면 sessionClients에서 제거하지 않음. 재연결 대기 상태 유지:
```ts
ws.on('close', () => {
  clients.delete(clientId);
  if (client.sessionId) {
    const sdkSession = getSDKSession(client.sessionId);
    if (!sdkSession?.isRunning) {
      sessionClients.delete(client.sessionId); // SDK idle → 정리
    }
    // SDK running → 맵 유지, 재연결 시 교체됨
  }
});
```

### 4. 프론트 안전 타이머 — isStreaming 영구 고착 방지
WS 끊김 + 스트리밍 중이면 15초 타이머 시작. 재연결 성공 시 취소, 실패 시 강제 리셋:
```ts
if (isStreaming && !safetyTimer.current) {
  safetyTimer.current = setTimeout(() => {
    store.setStreaming(false);
    toastError('연결 끊김으로 스트리밍 중단됨');
  }, 15_000);
}
```
핵심: useWebSocket이 store를 직접 참조하여 isStreaming 상태 확인.

### 5. reconnect 핸드셰이크 — 재연결 시 세션 복원
WS 재연결 → `connected` (serverEpoch 비교) → `reconnect` (sessionId 전송) → `reconnect_result` (streaming/idle).
idle인데 이전에 streaming이었으면 DB에서 메시지 복구. 타이밍: connected 처리 후 50ms 딜레이로 reconnect 전송.

---

## Phase 7 교훈: Git 자동 스냅샷 (홈 디렉토리 workspace)

### 1. 홈 디렉토리를 git workspace로 쓸 때 — `.gitignore` 전략
`/home/azureuser` 같은 홈 디렉토리를 git workspace로 쓰면 dotfiles, embedded git repos, 거대 디렉토리 문제 발생.
```
# 핵심: 모든 hidden 파일/디렉토리 기본 무시
.*
!.gitignore
```
그리고 `find -maxdepth 8 -name .git`으로 서브디렉토리의 embedded git repo를 자동 감지하여 `.gitignore`에 추가.

### 2. `git add -A` vs `--ignore-errors`
홈 디렉토리에 embedded git repo(submodule 아닌 일반 .git)가 있으면 `git add -A`가 fatal 에러로 실패.
```bash
git add -A --ignore-errors  # 에러 무시하고 가능한 파일만 stage
```
`--ignore-errors`는 exit 0으로 반환되므로 프로그래밍에서 안전하게 사용 가능.

### 3. Promise Mutex — 에러 전파 주의
```typescript
// ❌ 잘못된 패턴 — fn()이 reject되면 gitLock이 rejected 상태로 남아 이후 모든 호출이 실패
gitLock = gitLock.then(fn, fn);
return gitLock;

// ✅ 올바른 패턴 — 별도 Promise로 에러 격리
let resolve, reject;
const result = new Promise((res, rej) => { resolve = res; reject = rej; });
gitLock = gitLock.then(async () => {
  try { resolve(await fn()); }
  catch (e) { reject(e); }
}, async () => {
  try { resolve(await fn()); }
  catch (e) { reject(e); }
});
return result;
```

### 4. execFile vs exec — 보안
`child_process.exec`는 shell injection 취약. `execFile`은 인자를 배열로 받아서 안전:
```typescript
// 위험: exec(`git log --author="${userInput}"`)  // userInput에 ; rm -rf / 가능
// 안전: execFile('git', ['log', `--author=${userInput}`])
```
추가로 커밋 해시 입력은 반드시 `/^[a-f0-9]{4,40}$/i` 검증.

### 5. Mermaid 렌더링 — 코드블록 커스텀 렌더러 분기 패턴
ReactMarkdown의 `components.code()` 커스텀 렌더러에서 `className` 기반 분기로 특수 코드블록 처리:
```tsx
code({ children, className, ...props }) {
  const text = String(children).trim();
  if (className?.includes('language-mermaid')) {
    return <MermaidBlock code={text} />;  // rehype-highlight보다 먼저 실행
  }
  // ... 기타 처리
}
```
`pre()` 커스텀 렌더러도 함께 사용하면 코드블록 wrapper에 복사 버튼 등 부가 UI 배치 가능.
- mermaid 초기화: `startOnLoad: false` 필수 (수동 render 호출)
- `securityLevel: 'loose'` — click 이벤트 등 인터랙션 허용
- 고유 ID 필수: 여러 다이어그램이 동시에 있으면 ID 충돌 → `counter++` 패턴

### 6. group hover 패턴 — Tailwind CSS 중첩 hover
`group/{name}` + `group-hover/{name}:` 패턴으로 중첩 hover 영역 구현:
```tsx
// 외부 메시지 영역
<div className="group/message">
  <CopyButton className="opacity-0 group-hover/message:opacity-100" />
  // 내부 코드블록 영역
  <pre className="group/code">
    <CopyButton className="opacity-0 group-hover/code:opacity-100" />
  </pre>
</div>
```
이름이 다르므로 내부 hover가 외부 hover와 독립적으로 동작.

### 7. rollback은 reset이 아닌 checkout + 새 commit
```bash
# ❌ 히스토리 파괴
git reset --hard <hash>

# ✅ 히스토리 보존
git checkout <hash> -- .
git add -A
git commit -m "rollback: reverted to <hash>"
```
공유 환경에서 히스토리 보존은 필수. 누가 언제 어디로 되돌렸는지 추적 가능.

### 6. autoCommit은 선택적 파일만, manualCommit은 전체
- `autoCommit`: Claude SDK의 Write/Edit 도구가 수정한 파일만 `git add -- <file>` → 커밋
- `manualCommit`: `git add -A --ignore-errors` → 전체 변경사항 커밋
- 이 구분이 중요한 이유: auto-commit에서 관계없는 파일까지 커밋되면 노이즈

---

## 세션 격리 교훈: 멀티 세션 WS 라우팅

### 1. sessionClients 1:1 매핑의 stale 문제
`sessionClients` (sessionId → clientId) 매핑은 세션 전환 시 old 매핑이 남아 메시지가 잘못된 세션으로 전달됨.
**해결**: 두 단계 방어
- `set_active_session` 핸들러에서 능동적으로 old 매핑 삭제
- `sendToSession`에서 수동적으로 `c.sessionId !== sessionId` 가드 (race condition 대비)

### 2. 프론트엔드 sessionId 필터 — null 허점
```ts
// ❌ data.sessionId가 null이면 필터 통과
if (_currentSid && data.sessionId && _currentSid !== data.sessionId) return;

// ✅ null이어도 현재 세션과 불일치면 드랍
if (_currentSid && _currentSid !== data.sessionId) return;
```

### 3. 세션 전환 시 반드시 abort 먼저
스트리밍 중 세션 전환하면 이전 세션의 SDK 루프가 계속 돌면서 메시지를 보냄.
프론트에서 `abort()` → 백엔드에서 `abortSession(oldSessionId)` 순서로 정리해야 깨끗한 전환.

### 4. activeSessions 메모리 누수 — 타이머 정리
SDK query 완료 후 `activeSessions` Map에 세션이 남아 메모리 누수. 5분 후 자동 정리 타이머로 해결.
동일 sessionId로 새 query가 시작된 경우 오삭제 방지를 위해 identity check (`current === session`) 필수.

### 5. JWT 토큰 만료 — 프론트엔드 자동 로그아웃
API 응답 401이면 localStorage 토큰 삭제 + setToken(null) → 로그인 페이지로 자동 이동:
```ts
fetch('/api/sessions', { headers })
  .then((r) => {
    if (r.status === 401) { localStorage.removeItem('token'); setToken(null); return []; }
    return r.ok ? r.json() : [];
  })
```

---

## 핵심 트러블슈팅

### 1. "Cannot be launched inside another Claude Code session" 에러
Claude Code 세션 안에서 또 Claude Code를 실행하면 발생.

**근본 원인:** Claude Code 바이너리가 실행될 때 자동으로 `CLAUDECODE=1` 환경변수를 설정함.
모든 자식 프로세스가 이를 상속하고, 새로운 Claude Code 인스턴스가 이 변수를 감지하면
중첩 세션으로 판단하고 실행을 거부함.

**해결 1 — 프로세스 실행 시 환경 초기화:**
```bash
env -i HOME=$HOME PATH=$PATH USER=$USER SHELL=$SHELL TERM=xterm-256color \
  npx claude-code-web --port 32352 --no-open
```
> `unset CLAUDECODE`나 `env -u CLAUDECODE`는 tmux 안에서 안 먹힘.
> tmux가 부모 프로세스 환경을 상속하기 때문. `env -i`로 완전 초기화 필요.

**해결 2 — claude-code-web 소스 패치 (env -i만으로 부족할 때):**
`env -i`로 메인 프로세스에서 제거해도, claude-code-web이 PTY로 claude를 spawn할 때
`...process.env`를 spread하면서 다시 상속될 수 있음.

패치 파일: `node_modules/claude-code-web/src/claude-bridge.js`
```js
// 변경 전 (70번째 줄 부근):
const claudeProcess = spawn(this.claudeCommand, args, {
  env: { ...process.env, TERM: 'xterm-256color', ... },
});

// 변경 후:
const spawnEnv = { ...process.env, TERM: 'xterm-256color', ... };
delete spawnEnv.CLAUDECODE;
const claudeProcess = spawn(this.claudeCommand, args, {
  env: spawnEnv,
});
```

**참고:** `CLAUDE_CODE_DONT_INHERIT_ENV` 환경변수를 설정하면 Claude가 부모 환경을
상속하지 않는 옵션도 있음 (바이너리 내부 코드에서 확인).

### 2. SSH 터널 포트 충돌
```
bind [127.0.0.1]:32352: Address already in use
```

**해결 (Mac/Linux):**
```bash
lsof -ti:32352 | xargs kill -9
```

### 3. 브라우저 빈 화면 (ttyd)
ttyd의 WebSocket이 서버 포트로 연결 시도하는데, SSH 터널 로컬 포트가 다르면 실패.

**해결:** 로컬 포트와 서버 포트를 동일하게:
```bash
ssh -L 32352:localhost:32352 user@server   # OK
ssh -L 9999:localhost:32352 user@server    # 빈 화면
```

### 4. claude-code-webui SDK 버전 불일치
번들된 Claude CLI (1.0.x)와 서버 설치 버전 (2.x)이 다를 때 발생.

**해결:** `--claude-path`로 직접 지정:
```bash
npx claude-code-webui --claude-path /home/azureuser/.local/bin/claude
```

---

## 여러 포트 동시 터널링
```bash
ssh -L 32352:localhost:32352 -L 32353:localhost:32353 azureuser@4.230.33.35
```

## 프로세스 관리
```bash
# 실행 중인 서비스 확인
ss -tlnp | grep -E '32352|32353'

# nohup으로 띄운 프로세스 종료
kill $(lsof -ti:32352)

# tmux 세션 관리
tmux list-sessions
tmux attach -t session-name
tmux kill-session -t session-name

# 로그 확인
cat /tmp/claude-code-web.log
cat /tmp/claude-code-webui.log
```

---

## 운영: PM2 통일 관리

### 근본 문제 — 이중 실행 방식의 포트 충돌
`start.sh`(`npx tsx backend/index.ts`)와 PM2(`node dist/backend/index.js`)가 공존하면, 하나가 포트를 잡은 채 고아 프로세스로 남아 다른 쪽이 `EADDRINUSE`로 크래시 루프에 빠짐. PM2 재시작 1344회 기록.

### 해결 — ecosystem.config.cjs로 선언형 관리
```js
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'claude-desk',
    script: 'dist/backend/index.js',
    cwd: '/home/azureuser/tunnelingcc/claude-desk',
    env: {
      NODE_ENV: 'production',
      PORT: 32354,
      DEFAULT_CWD: '/home/azureuser',
      WORKSPACE_ROOT: '/home/azureuser',
      GIT_AUTO_COMMIT: 'true',
    },
    autorestart: true,
    max_restarts: 10,
    min_uptime: '5s',
    restart_delay: 3000,
  }],
};
```

### 운영 명령어
```bash
cd ~/tunnelingcc/claude-desk

./start.sh start      # 빌드 + PM2 시작
./start.sh restart    # 빌드 + PM2 재시작
./start.sh stop       # 중지
./start.sh logs       # 로그
./start.sh status     # 상태

# 또는 npm scripts
npm run restart       # = npm run build && pm2 restart claude-desk
npm run logs
```

### 절대 하지 말 것
- `npx tsx backend/index.ts` — PM2와 포트 충돌
- `node dist/backend/index.js` — 환경변수 누락 + 포트 충돌
- 환경변수를 커맨드라인으로 전달 — ecosystem.config.cjs에 선언된 것 사용

### 고아 프로세스 발생 시 복구
```bash
# 1. 포트 점유 프로세스 확인
lsof -i :32354
# 2. PM2 PID와 비교
pm2 pid claude-desk
# 3. 고아 프로세스 kill
kill <orphan-pid>
# 4. PM2 재시작
pm2 restart claude-desk
```

### WS 연결 안 될 때 빠른 진단
```bash
# WS 핸드셰이크 테스트 (101=정상, 401=인증 문제)
curl -s -i --http1.1 -H "Upgrade: websocket" -H "Connection: Upgrade" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Sec-WebSocket-Version: 13" \
  http://localhost:32354/ws 2>&1 | head -3
```
401이면 인증이 켜져 있는 정상 상태. 브라우저에서 `admin / admin123`으로 로그인 필요.

---

## 새 VM 클린 설치 가이드

### 전제 조건
- Ubuntu 22.04+ / Node.js 18+
- Claude Code CLI 설치됨 (`~/.local/bin/claude`)
- GitHub 접근 가능 (gh CLI 또는 토큰)

### 1단계: 기본 도구 설치
```bash
# PM2 (프로세스 매니저)
sudo npm install -g pm2

# cloudflared (Cloudflare Tunnel - 외부 접속용)
curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i /tmp/cloudflared.deb
```

### 2단계: claude-desk 설치
```bash
# gh CLI로 clone (private repo)
gh repo clone doomoolmori/claude-desk ~/claude-desk

# 또는 git clone (credential 설정 필요)
# git clone https://github.com/doomoolmori/claude-desk.git ~/claude-desk

cd ~/claude-desk
npm ci
npm run build
mkdir -p data
```

### 3단계: 서비스 시작 (Dev Mode)
```bash
cd ~/claude-desk
npm run dev
```
- Vite HMR(:32354) + tsx watch backend(:32355) 동시 실행
- 코드 수정 → 즉시 반영 (빌드 불필요)
- 원격 접속 OK (0.0.0.0 바인딩)
- 기본 인증: admin / admin123

### 4단계: 외부 접속 (택 1)

#### A. Quick Tunnel (테스트용, 즉시 사용)
```bash
cloudflared tunnel --url http://localhost:32354
```
- 임시 URL 발급 (예: https://xxx-xxx.trycloudflare.com)
- 서버 재시작 시 URL 변경됨
- 인증/계정 불필요

#### B. SSH 터널 (로컬 PC에서만 접속)
```bash
ssh -f -N -o ServerAliveInterval=60 \
  -L 32354:localhost:32354 user@서버IP
```
브라우저: http://localhost:32354

#### C. Named Tunnel (운영용, 고정 도메인)
```bash
cloudflared login  # 브라우저 인증 필요
cloudflared tunnel create claude-desk
# config.yml 작성 후
cloudflared service install
```

#### D. Azure NSG 포트 개방 (직접 IP 접속)
```bash
az vm open-port --resource-group <RG> --name <VM> --port 32354 --priority 1010
```
- HTTP 비암호화이므로 내부용으로만 권장

### 주의사항

1. **claude 바이너리 PATH**: zsh 사용 시 `~/.zprofile`에 `source ~/.profile` 추가 필요
2. **파일 권한**: Docker 등으로 `~/.claude/` 소유자가 바뀌면 `sudo chown -R $(whoami) ~/.claude/`
3. **DB 복사 금지**: 다른 서버의 SQLite DB를 복사하면 경로 불일치 에러 발생. 항상 빈 DB로 시작
4. **ESM 모듈**: package.json에 `"type": "module"` → CommonJS 문법(require) 사용 불가
5. **PROJECT_ROOT dev/prod 차이**: `backend/config.ts`의 `__dirname` 기준 경로가 다름
   - dev (tsx): `backend/config.ts` → `..` = `claude-desk/`
   - prod (dist): `dist/backend/config.js` → `../..` = `claude-desk/`
   - 코드에서 `__dirname.includes('dist')` 분기로 처리됨
6. **Dev Mode 환경변수**: `ecosystem.config.cjs`의 env를 `package.json` dev:backend 스크립트에도 동일하게 선언해야 함 (PORT, HOST, GIT_AUTO_COMMIT, WORKSPACE_ROOT)

---

## SDK 마이그레이션: claude-code → claude-agent-sdk

### 패키지 차이
| | `@anthropic-ai/claude-code` (구) | `@anthropic-ai/claude-agent-sdk` (신) |
|---|---|---|
| 버전 체계 | v1.0.x ~ v2.1.x | v0.2.x |
| `settingSources` | 없음 | `['user', 'project', 'local']` |
| `Skill` 도구 | 비활성 (로드 안 됨) | `settingSources` 설정 시 활성 |
| `customSystemPrompt` | 있음 | **제거** → `systemPrompt` 사용 |
| `bypassPermissions` | 단독 사용 가능 | `allowDangerouslySkipPermissions: true` 필수 |
| `agents` 옵션 | 없음 | 커스텀 서브에이전트 정의 가능 |
| `tools` 옵션 | 없음 | 빌트인 도구 제한 가능 |
| `outputFormat` | 없음 | JSON 스키마 구조화 응답 |
| `effort` | 없음 | `'low' \| 'medium' \| 'high' \| 'max'` |

### settingSources가 제어하는 것
- `'user'` → `~/.claude/settings.json` + `~/.claude/skills/`
- `'project'` → `.claude/settings.json` + `.claude/skills/` + `CLAUDE.md`
- `'local'` → `.claude/settings.local.json`
- 미설정(기본값) → **아무것도 로드 안 됨** (SDK 격리 모드)

### 마이그레이션 체크리스트
1. `package.json`: `@anthropic-ai/claude-code` → `@anthropic-ai/claude-agent-sdk`
2. 모든 import 경로 변경
3. `customSystemPrompt` → `systemPrompt`
4. `bypassPermissions` 사용 시 `allowDangerouslySkipPermissions: true` 추가
5. 메인 query에 `settingSources: ['user', 'project']` 추가
6. `npm install` 후 타입 체크 (`npx tsc --noEmit`)

### 참고
- 공식 문서: https://platform.claude.com/docs/en/agent-sdk/skills
- Skills는 `SKILL.md` frontmatter의 `allowed-tools`가 SDK에서는 무시됨 → `allowedTools` 옵션으로 제어
