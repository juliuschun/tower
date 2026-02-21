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

### 실행
```bash
cd /home/azureuser/tunnelingcc/claude-desk
./start.sh
# 또는
NO_AUTH=true DEFAULT_CWD=/home/azureuser WORKSPACE_ROOT=/home/azureuser npx tsx backend/index.ts
```

### 접속
```bash
ssh -L 32354:localhost:32354 azureuser@4.230.33.35
# 브라우저: http://localhost:32354
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
const response = query({
  prompt: processedPrompt,
  options: {
    abortController,
    executable: 'node',
    executableArgs: [],
    pathToClaudeCodeExecutable: '/home/azureuser/.local/bin/claude',
    cwd: '/home/azureuser',
    permissionMode: 'bypassPermissions',
    resume: sessionId, // 세션 이어하기
  },
});
```
- `resume`에 `session_id` (system init 메시지에서 획득)를 넣으면 세션 이어하기
- 슬래시 명령어: 앞의 `/`를 떼고 prompt로 전달하면 SDK가 처리

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
