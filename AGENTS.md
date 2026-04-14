# Project: Tower

AI command center for your team. Stack your own tower of AI and systems.

## Quick Start
- Dev: `npm run dev` (Vite HMR + tsx watch)
- Frontend changes → instant, Backend changes → ~2s auto-restart
- Ports: :32354 (Vite frontend) → proxy → :32355 (Backend)

## Dev / Prod 분리

| 환경 | 도메인 | 포트 | 프로세스 | 용도 |
|------|--------|------|---------|------|
| **Dev** | `desk-dev.moatai.app` | :32354/:32355 | tsx watch | 개발. 코드 수정 시 자동 재시작 |
| **Prod** | `tower.moatai.app` | :32364 | PM2 `tower-prod` | 사용자용. 배포 시에만 재시작 |
| **Redirect** | `desk.moatai.app` | — | Nginx 301 | → tower.moatai.app 으로 리다이렉트 |

- DB(PostgreSQL), workspace, `~/.claude/` (세션 .jsonl), API 키 모두 **공유**
- Dev에서 코드 수정 → tsx watch 재시작 → **Prod 영향 없음**
- Prod 배포: `./start.sh prod-restart` (빌드 + PM2 restart)
- DB 스키마 변경 시 Prod도 함께 배포 필요 (같은 DB 사용)
- Nginx 설정: `/etc/nginx/sites-available/{tower,desk,desk-dev}.moatai.app`

## Key Conventions
- Document learnings in `codify.md`
- Environment variables → `.env` (copy from `.env.example`)

## ⚠️ Dev Server Warnings
- **`npm run dev` is a single-instance command.** Running it multiple times (e.g., via `nohup npm run dev &` in different sessions) stacks zombie `tsx watch` processes that fight over port 32355 → streaming cuts off mid-response.
- Before starting, check: `pgrep -fa "tsx.*backend"` — if more than one, kill extras first.
- **Do NOT restart the backend while working on a task.** Restarting kills running tasks and loses context. Finish all current work first, then restart if needed.
- **Prod 재시작은 반드시 Dev 세션에서 실행.** Prod 세션(tower.moatai.app)에서 `./start.sh prod-restart`를 실행하면 세션 복구 루프가 발생한다 (서버 죽음 → PM2 재시작 → 세션 복구 → 또 restart → 무한 반복). Dev 세션(desk-dev)이나 SSH 터미널에서만 실행할 것.
- Full server ops guide → `devserver.md`
- Full warning history → `codify.md` (search "좀비" or "zombie")

## 링크 규칙

URL이나 파일 경로를 사용자에게 안내할 때 **반드시 클릭 가능한 전체 URL**로 제공한다.
- ✅ `https://desk-dev.moatai.app/automation-preview.html`
- ❌ `/automation-preview.html` (상대 경로만)
- ❌ `packages/frontend/public/automation-preview.html` (파일 시스템 경로만)

Dev 서버의 public 파일 → `https://desk-dev.moatai.app/<filename>`
Prod 서버의 public 파일 → `https://tower.moatai.app/<filename>`

## Workspace

Each deployment has a workspace directory (set via `WORKSPACE_ROOT` env var).

### Structure
```
workspace/
├── principles.md          # Team principles
├── decisions/             # Decision records (immutable, append-only)
├── docs/                  # Guides, SOPs, references
├── projects/              # Project folders (Tower auto-creates)
│   ├── kap/               # Each project = folder + AGENTS.md + CLAUDE.md
│   └── ...
└── published/             # Deployed outputs
```

### Project-Centric Architecture

Project is the center of everything. A project groups channels, sessions, files, and AI context.
Inviting someone to a project grants access to all of the above.

- Each project has a folder under `workspace/projects/` (auto-created on project creation)
- `AGENTS.md` + `CLAUDE.md` (symlink) define project-specific instructions
- Codebase projects can point to external paths (e.g., `~/tower/`) instead

### Claude Behavior Rules

**Documentation**: When decisions are made, suggest recording them.
- Decision record → `workspace/decisions/YYYY-MM-DD-title.md` (team-wide / cross-project)
- Project-scoped decision → `workspace/projects/<project>/.project/decisions/YYYY-MM-DD-title.md`
- Process/guide → `workspace/docs/title.md`

**Decision records**: Never delete files in `workspace/decisions/` or `.project/decisions/`. To change a decision, create a new file.

**Search**: When asked about past decisions or docs, search `workspace/decisions/`, `workspace/docs/`, and the relevant project's `.project/decisions/`, and answer with context.

## UI Navigation

Sidebar is the single navigation point. No header view toggle.

| Sidebar Tab | Internal `activeView` | Center Panel | Description |
|-------------|----------------------|--------------|-------------|
| **Sessions** | `chat` | `ChatPanel` | 1:1 AI conversation |
| **Channel** | `rooms` | `RoomPanel` | Team chat channels |
| **Files** | (no view change) | (file tree) | File browser |

Header has a **Task board icon** (kanban grid) that toggles `activeView = 'kanban'`.
Sidebar footer: Pins, History (toggle views), Settings.

## Dynamic Visual — 확장 포맷 (개발 참고)

> 기본 포맷(chart, mermaid, datatable, timeline, math, html-sandbox, map)은
> 시스템 프롬프트(`system-prompt.ts`)에서 모든 세션에 자동 주입됩니다.
> 확장 포맷(secure-input, steps, diff 등 11개)도 동일하게 시스템 프롬프트에 포함됩니다.
> 아래는 개발자용 참고 정보입니다.

| 포맷 | 코드블록 | 설명 |
|------|---------|------|
| 보안 입력 | ` ```secure-input ` | 민감 데이터 입력 위젯 → .env 직접 저장 |
| 스텝 가이드 | ` ```steps ` | JSON: `{ "steps": [{ "title", "status" }], "current": 2 }` |
| 코드 비교 | ` ```diff ` | JSON: `{ "before": "...", "after": "...", "mode": "split" }` |
| 폼 | ` ```form ` | JSON: `{ "fields": [{ "key", "type", "options" }] }` |
| 칸반 | ` ```kanban ` | JSON: `{ "columns": [...], "cards": [{ "title", "column" }] }` |
| 터미널 | ` ```terminal ` | JSON: `{ "commands": [{ "cmd", "output", "status" }] }` |
| 비교 카드 | ` ```comparison ` | JSON: `{ "items": [{ "name", "pros", "cons", "score" }] }` |
| 승인 위젯 | ` ```approval ` | JSON: `{ "action", "description", "confirmLabel" }` |
| 트리맵 | ` ```treemap ` | JSON: `{ "data": [{ "name", "value", "children" }] }` |
| 갤러리 | ` ```gallery ` | JSON: `{ "images": [{ "src", "caption" }], "columns": 3 }` |
| 오디오 | ` ```audio ` | JSON: `{ "src": "...", "title": "..." }` |

**렌더링 인프라**:
- 코드블록이 닫히면 즉시 렌더 (스트리밍 중에도)
- JSON 파싱 실패 시 원본 코드블록 폴백 (크래시 없음)
- `React.lazy` 코드 스플릿 — 사용 안 하는 시각화는 로드 안 됨
- 인프라: `shared/RichContent.tsx` → `splitDynamicBlocks` → 블록별 컴포넌트

**PRD**: `docs/plans/dynamic-visual.md`

## Secure Input — 민감 데이터 입력

API 키, 토큰, 시크릿 등 민감 데이터가 필요할 때 사용자에게 직접 알려달라고 하지 말 것.
대신 `secure-input` 코드블록을 출력하면 채팅 안에 보안 입력 위젯이 렌더링된다.

**사용 시점**:
- 사용자가 API 연동을 요청했는데 필요한 키가 .env에 없을 때
- "API 키 설정해줘", "환경변수 추가해줘" 등의 요청
- 새로운 외부 서비스 연동 시 credential이 필요할 때

**출력 포맷**:
````
```secure-input
{
  "target": ".env",
  "fields": [
    { "key": "NAVER_CLIENT_ID", "label": "네이버 Client ID", "required": true },
    { "key": "NAVER_CLIENT_SECRET", "label": "네이버 Client Secret", "required": true }
  ]
}
```
````

**규칙**:
- `target`은 `.env`만 허용 (생략 시 기본값 `.env`)
- `key`는 `[A-Za-z_][A-Za-z0-9_]*` 패턴만 허용
- 값은 채팅 히스토리에 절대 저장되지 않음 (프론트→백엔드 직통)
- 이미 존재하는 키는 업데이트, 새 키는 append
- 위젯 출력 전후로 간단한 설명을 함께 제공할 것 (왜 이 키가 필요한지)

## Customer Server Management — 고객 서버 관리

Tower를 고객 전용 Azure VM에 배포·운영한다. 서버 추가/업데이트/장애 대응 시 아래 문서를 참조.

| 문서 | 위치 | 내용 |
|------|------|------|
| **서버 레지스트리 & 운영 로그** | `docs/customer-servers.md` | 전체 서버 목록, 버전, 배포 이력, 장애 기록 |
| **배포 런북** | `docs/azure-customer-deployment-runbook.md` | 신규 고객 배포 step-by-step (VM 생성 → 인증 → 스킬) |
| **배포 가이드 (요약)** | `docs/azure-prod-deployment.md` | 배포 아키텍처 + 스크립트 사용법 |
| **스킬 프로필** | `claude-skills/skills/library/library.yaml` | 고객별 스킬 세트 (customer-basic / customer-full) |
| **Publishing 가이드** | `docs/publishing-guide.md` | 사이트 배포 + 도메인 + 고객 안내 전체 가이드 |
| **Publishing 재설계** | `docs/plans/arch_0413_publish-gateway-redesign.md` | TOWER_ROLE 기반 배포 아키텍처 (Hub→Backend 통합, Gateway) |
| **배포 엔진 (기존)** | `docs/deploy-engine.md` | Cloudflare Pages + Azure Container Apps 배포 흐름 |

**업데이트 배포 절차** (기존 고객 서버):
```bash
ssh toweradmin@<IP> "cd ~/tower && git pull origin main && npm install && ./start.sh prod-restart"
```

**규칙**:
- 서버 추가/변경 시 반드시 `docs/customer-servers.md`에 기록
- 배포 후 버전과 날짜를 운영 로그에 추가
- 장애 발생 시 원인·해결을 로그에 남겨 다음에 재발 방지

## Communication Style

When explaining architecture, systems, or technical decisions — use plain language and everyday analogies, as if explaining to a smart non-developer. Avoid jargon. If a technical term is necessary, explain it in one sentence right after. Default to the simplest possible explanation first, then add detail only if asked.
