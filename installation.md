# Claude Desk — 설치 가이드

## 전제 조건

- Ubuntu 22.04+ / Node.js 20+
- Claude Code CLI 설치됨 (`~/.local/bin/claude`)
- GitHub 접근 가능 (gh CLI 또는 토큰)

## 1단계: 기본 도구 설치

```bash
# PM2 (프로세스 매니저)
sudo npm install -g pm2

# cloudflared (Cloudflare Tunnel - 외부 접속용, 선택)
curl -L --output /tmp/cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i /tmp/cloudflared.deb
```

## 2단계: claude-desk 설치

```bash
gh repo clone doomoolmori/claude-desk ~/claude-desk
cd ~/claude-desk
npm ci
mkdir -p data
```

## 3단계: Skills 설치

claude-desk에 번들된 스킬을 `~/.claude/`에 설치:

```bash
cd ~/claude-desk
./install-skills.sh
```

설치되는 항목:
- **Skills** (`~/.claude/skills/`) — brainstorming, systematic-debugging, TDD 등 20+개
- **Commands** (`~/.claude/commands/`) — `/prime`, `/gmail` 등
- **Agents** (`~/.claude/agents/`) — rapid-web-researcher 등

## 4단계: 서비스 시작

### Dev Mode (권장)

```bash
cd ~/claude-desk
npm run dev
```

- Vite HMR(:32354) + tsx watch backend(:32355) 동시 실행
- 코드 수정 → 즉시 반영 (빌드 불필요)
- 원격 접속 OK (0.0.0.0 바인딩)
- 기본 인증: admin / admin123

### Production Mode

```bash
cd ~/claude-desk
npm run build
npm start          # PM2로 시작
```

## 5단계: 외부 접속 (택 1)

### A. SSH 터널 (가장 안전)
```bash
ssh -f -N -o ServerAliveInterval=60 \
  -L 32354:localhost:32354 user@서버IP
```
브라우저: http://localhost:32354

### B. Quick Tunnel (테스트용)
```bash
cloudflared tunnel --url http://localhost:32354
```

### C. Azure NSG 포트 개방 (직접 IP)
```bash
az vm open-port --resource-group <RG> --name <VM> --port 32354 --priority 1010
```

---

## 아키텍처

```
브라우저 ←WebSocket→ Vite(:32354) →proxy→ Express(:32355) ←SDK query()→ Claude CLI
```

### 핵심 의존성

| 패키지 | 역할 |
|--------|------|
| `@anthropic-ai/claude-agent-sdk` | Claude Code SDK — query() 비동기 제너레이터 |
| React 18 + Vite | 프론트엔드 |
| Express + ws | 백엔드 + WebSocket |
| better-sqlite3 | 세션/메시지 DB |
| zustand | 프론트엔드 상태 관리 |

### SDK 설정 (핵심)

`backend/services/claude-sdk.ts`에서 SDK를 사용:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const response = query({
  prompt: userMessage,
  options: {
    cwd: '/path/to/project',
    settingSources: ['user', 'project'],   // Skills + CLAUDE.md 로딩
    permissionMode: 'bypassPermissions',
    // ...
  },
});
```

**`settingSources`가 가장 중요한 설정:**
- `'user'` → `~/.claude/settings.json` + `~/.claude/skills/` 로드
- `'project'` → `.claude/settings.json` + `.claude/skills/` + `CLAUDE.md` 로드
- 미설정 시 → Skills, CLAUDE.md 전부 무시됨 (SDK 격리 모드)

이 옵션이 있어야 claude-desk에서 `Skill` 도구가 활성화되고, Claude가 `~/.claude/skills/`의 스킬(brainstorming, TDD, debugging 등)을 자동으로 사용할 수 있음.

---

## 주의사항

1. **CLAUDECODE 환경변수**: `backend/services/claude-sdk.ts`에서 `delete process.env.CLAUDECODE` 처리됨. Claude Code 세션 안에서 SDK를 실행할 때 중첩 세션 에러 방지
2. **DB**: `data/` 디렉토리에 SQLite 파일 자동 생성. 다른 서버의 DB 복사 금지 (경로 불일치)
3. **ESM**: `package.json`에 `"type": "module"` — CommonJS(require) 사용 불가
4. **PM2와 직접 실행 혼용 금지**: `npx tsx backend/index.ts` 직접 실행하면 PM2와 포트 충돌
5. **SDK 패키지**: 구 패키지(`@anthropic-ai/claude-code`)가 아닌 **신 패키지(`@anthropic-ai/claude-agent-sdk`)**를 사용해야 Skills 지원됨

---

## 트러블슈팅

### Skills가 작동하지 않을 때

```bash
# 1. 스킬 파일 확인
ls ~/.claude/skills/*/SKILL.md

# 2. SDK init 메시지에서 Skill 도구 확인 (백엔드 로그)
# tools 배열에 "Skill"이 포함되어야 함

# 3. settingSources 확인
# backend/services/claude-sdk.ts에 settingSources: ['user', 'project'] 필수
```

### WS 연결 안 될 때

```bash
curl -s -i --http1.1 \
  -H "Upgrade: websocket" -H "Connection: Upgrade" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  http://localhost:32354/ws 2>&1 | head -3
```
- 101 = 정상
- 401 = 인증 필요 (admin / admin123)
