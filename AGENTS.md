# Project: Tower

AI command center for your team. Stack your own tower of AI and systems.

## Quick Start
- Dev: `npm run dev` (Vite HMR + tsx watch)
- Frontend changes → instant, Backend changes → ~2s auto-restart
- Ports: :32354 (Vite frontend) → proxy → :32355 (Backend)

## Dev / Prod 분리
- Dev: `desk-dev.moatai.app` / ports `32354`, `32355` / tsx watch
- Prod: `tower.moatai.app` / port `32364` / PM2 `tower-prod`
- Redirect: `desk.moatai.app` → `tower.moatai.app`
- DB(PostgreSQL), workspace, `~/.claude/` 세션, API 키는 공유됩니다.
- Prod 배포: `./start.sh prod-restart`
- DB 스키마 변경 시 Prod도 함께 배포해야 합니다.

## 핵심 규칙
- Learnings는 `codify.md`에 기록합니다.
- 환경변수는 `.env`를 사용하고 `.env.example`을 기준으로 맞춥니다.
- URL이나 public 파일 안내 시 반드시 클릭 가능한 전체 URL로 제공합니다.
- 결정이 생기면 적절한 결정 문서/가이드 위치를 제안합니다.

## Dev 서버 주의
- `npm run dev`는 단일 인스턴스로만 실행합니다.
- 시작 전 `pgrep -fa "tsx.*backend"`로 중복 프로세스를 확인합니다.
- 작업 중 백엔드를 재시작하지 마세요. 실행 중 작업 컨텍스트가 사라집니다.
- Prod 재시작은 반드시 Dev 세션이나 SSH 터미널에서만 실행합니다.

## Workspace / 문서화
- 팀 공통 결정: `workspace/decisions/YYYY-MM-DD-title.md`
- 프로젝트 결정: `workspace/projects/<project>/.project/decisions/YYYY-MM-DD-title.md`
- 프로세스/가이드: `workspace/docs/title.md`
- **운영 에이전트**(상태·루프·PR 산출이 있는 메타 에이전트): `workspace/projects/<agent-name>/` — 일반 프로젝트와 같은 위치에 두되, `.project/MISSION.md` / `.project/NORTH_STAR.md` / `playbooks/` / `runs/` 구조로 테넌트 간 포터빌리티 확보. 첫 사례: `workspace/projects/publishing-steward/`.
- 프로젝트별 규칙은 `AGENTS.md` / `CLAUDE.md`를 우선합니다.

## Publishing (managed 고객 VM — okusystem 등)

managed 고객 VM에는 publishing hub가 켜져 있습니다.
사이트 한 개 = `~/workspace/published/sites/<name>/` 폴더 + `index.html`.

**접근 URL — 서브도메인이 정답:**
- ✅ `https://<name>.okusystem.moatai.app/` — 와일드카드 nginx가 폴더를 직접 서빙합니다.
- ❌ `https://okusystem.moatai.app/sites/<name>/` — 이 경로는 Tower 백엔드(SPA)로 프록시됩니다.
  현재 okusystem nginx에는 `/sites/*` location이 없어 사이트 파일이 노출되지 않습니다.
  사용자에게 절대 이 형태의 URL을 안내하지 마세요.

**사이트 만들기 / 수정 / 삭제:**
- 폴더만 만들면 즉시 서빙. nginx 재시작·DNS 변경 불필요.
- 이름 규칙: 소문자 영문 + 숫자 + 하이픈만 (`a-z`, `0-9`, `-`), 영문/숫자로 시작.
- 파일을 고치면 즉시 반영. 별도 배포 절차 없음.
- 삭제는 폴더 삭제 (사용자 확인 후).
- 외부 공개·동적 앱은 `~/workspace/scripts/deploy.sh` 사용 (Cloudflare Pages / Azure Container Apps).
- 상세: `docs/publishing-guide.md`

## 필요 시 추가 참고
상세 참고는 필요할 때만 아래 문서를 읽습니다.
- 에이전트 참고서: `docs/agents-reference.md`
- Dev 서버 운영 가이드: `devserver.md`
- 시각화 포맷/아키텍처: `docs/tower-guide/visual-formats.md`, `docs/tower-guide/architecture.md`
- 고객 서버/배포 문서: `docs/customer-servers.md`, `docs/azure-customer-deployment-runbook.md`, `docs/publishing-guide.md`

## Communication Style
When explaining architecture, systems, or technical decisions — use plain language and everyday analogies, as if explaining to a smart non-developer. Avoid jargon. If a technical term is necessary, explain it in one sentence right after. Default to the simplest possible explanation first, then add detail only if asked.
